import { api } from '../core/api.js';
import { EmptyState, EmptyStatePresets } from '../core/empty-state.js';
import { showToast } from '../core/toast.js';

export class ProjectsView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-base-content/10">
          <div>
            <h2 class="text-2xl font-bold tracking-tight text-base-content flex items-center gap-2.5">
              <i class="fi fi-rr-briefcase text-primary text-xl"></i>
              Digital Studio Projects Portfolio
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Multi-agent milestone tracking, campaign pipelines, and deliverable packages.</p>
          </div>
          <button class="btn btn-primary btn-sm gap-2 shadow" id="btn-create-project">
            <i class="fi fi-rr-folder-add text-xs"></i>
            <span>New Project</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" id="projects-grid">
          <div class="text-base-content/50 text-xs py-8 text-center col-span-full">Loading studio projects...</div>
        </div>
      </div>

      <!-- Create Project Modal (DaisyUI Standard Component) -->
      <dialog id="project-modal" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box bg-base-200 border border-base-content/10 text-base-content">
          <div class="flex justify-between items-center pb-3 border-b border-base-content/10">
            <h3 class="font-bold text-base text-base-content flex items-center gap-2">
              <i class="fi fi-rr-folder-add text-primary"></i>
              Launch New Studio Project
            </h3>
            <button class="btn btn-sm btn-circle btn-ghost text-base-content/60 hover:text-base-content" id="proj-modal-close">✕</button>
          </div>

          <form id="project-form" class="space-y-4 pt-4">
            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Project Name</label>
              <input type="text" class="input input-bordered input-sm w-full bg-base-100 text-base-content border-base-content/20" id="proj-name" placeholder="e.g. Bangron Brand Relaunch" required />
            </div>
            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Project Description</label>
              <textarea class="textarea textarea-bordered textarea-sm w-full bg-base-100 text-base-content border-base-content/20" id="proj-desc" rows="3" placeholder="Core objectives, targets, and expected assets..."></textarea>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Target Deadline</label>
                <input type="date" class="input input-bordered input-sm w-full bg-base-100 text-base-content border-base-content/20" id="proj-deadline" />
              </div>
              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Initial Status</label>
                <select class="select select-bordered select-sm w-full bg-base-100 text-base-content border-base-content/20" id="proj-status">
                  <option value="active">Active</option>
                  <option value="planning">Planning</option>
                  <option value="on_hold">On Hold</option>
                </select>
              </div>
            </div>
            <div class="modal-action border-t border-base-content/10 pt-3">
              <button type="button" class="btn btn-ghost btn-sm" id="proj-modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary btn-sm gap-1.5 shadow">
                <i class="fi fi-rr-rocket-lunch text-xs"></i>
                <span>Create Project</span>
              </button>
            </div>
          </form>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    `;

    this.initEvents();
    await this.loadProjects();
  }

  async loadProjects() {
    try {
      const projects = await api.get('/api/projects');
      const grid = document.getElementById('projects-grid');
      if (!grid) return;

      if (projects.length === 0) {
        EmptyState.show(grid, EmptyStatePresets.noProjects);
        return;
      }

      grid.innerHTML = projects.map((p) => {
        const total = p.total_tasks || 0;
        const comp = p.completed_tasks || 0;
        const pct = total > 0 ? Math.round((comp / total) * 100) : 0;

        return `
          <div class="card bg-base-200 border border-base-content/10 shadow-lg hover:border-primary/40 hover:shadow-xl transition-all duration-200 rounded-box overflow-hidden">
            <div class="card-body p-5 space-y-3">
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2">
                  <div class="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                    <i class="fi fi-rr-box-alt text-sm"></i>
                  </div>
                  <div>
                    <h3 class="font-bold text-sm text-base-content">${p.name}</h3>
                    <span class="text-[11px] text-base-content/50 font-mono">${p.deadline ? `Target: ${new Date(p.deadline).toLocaleDateString()}` : 'No deadline set'}</span>
                  </div>
                </div>
                <span class="badge badge-xs font-semibold ${p.status === 'active' ? 'badge-primary' : p.status === 'completed' ? 'badge-success' : 'badge-ghost'}">
                  ${p.status}
                </span>
              </div>

              <p class="text-xs text-base-content/80 min-h-[36px] line-clamp-2">${p.description || 'Active digital studio operational initiative.'}</p>

              <div class="space-y-1.5 pt-2">
                <div class="flex justify-between text-xs">
                  <span class="text-base-content/60">Milestone Progress</span>
                  <span class="font-mono text-primary font-bold">${pct}% (${comp}/${total} tasks)</span>
                </div>
                <progress class="progress progress-primary w-full h-2" value="${pct}" max="100"></progress>
              </div>

              <div class="flex justify-between items-center pt-3 border-t border-base-content/10 text-xs">
                <div class="flex items-center gap-2 text-base-content/60">
                  <i class="fi fi-rr-box-open text-xs"></i>
                  <span>${p.deliverables_count || 0} Assets</span>
                </div>
                <a href="#/tasks" class="btn btn-ghost btn-xs text-primary hover:text-primary-focus gap-1">
                  <span>View Tasks</span>
                  <i class="fi fi-rr-arrow-right text-xs"></i>
                </a>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }

  initEvents() {
    const modal = document.getElementById('project-modal');
    document.getElementById('btn-create-project')?.addEventListener('click', () => modal?.showModal());
    document.getElementById('proj-modal-close')?.addEventListener('click', () => modal?.close());
    document.getElementById('proj-modal-cancel')?.addEventListener('click', () => modal?.close());

    document.getElementById('project-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/projects', {
          name: document.getElementById('proj-name').value,
          description: document.getElementById('proj-desc').value,
          deadline: document.getElementById('proj-deadline').value || null,
          status: document.getElementById('proj-status').value
        });

        modal?.close();
        if (typeof showToast !== 'undefined') showToast('success', 'Project launched!', 'Studio project created successfully.'); else alert('Project launched successfully!');
        await this.loadProjects();
      } catch (err) {
        if (typeof showToast !== 'undefined') showToast('error', 'Project Failed', err.message); else alert('Failed to create project: ' + err.message);
      }
    });
  }

  destroy() {}
}

export default ProjectsView;
