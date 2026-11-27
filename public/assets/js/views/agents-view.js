import { api } from '../core/api.js';
import { store } from '../core/store.js';
import { SkeletonLoader } from '../core/skeleton.js';
import { EmptyState, EmptyStatePresets } from '../core/empty-state.js';
import { showToast } from '../core/toast.js';

export class AgentsView {
  constructor(container) {
    this.container = container;
    this.filterDept = 'all';
    this.unsubscribe = null;
    this.refreshTimer = null;
  }

  // Realtime: kartu agents mengikuti event WebSocket (status/position/created)
  // tanpa perlu pindah halaman. Debounce menghindari fetch beruntun saat SSE
  // memancarkan puluhan event dalam satu run.
  subscribeRealtime() {
    this.unsubscribe = store.subscribe((key) => {
      if (!['agent_updated', 'agents_loaded', 'state_updated', 'runtime_status_changed'].includes(key)) return;
      if (!document.getElementById('agents-grid')) return;
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.loadAgents(this.filterDept), 150);
    });
  }

  showSkeleton() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div class="stats stats-vertical lg:stats-horizontal shadow-xl bg-base-200 border border-base-content/10 w-full">
          ${SkeletonLoader.skeletonStat()}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" id="agents-grid">
          ${SkeletonLoader.skeletonCard()}
        </div>
      </div>
    `;
  }

  async render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-base-content/10">
          <div>
            <h2 class="text-2xl font-bold tracking-tight text-base-content flex items-center gap-2.5">
              <i class="fi fi-rr-user-robot text-primary text-xl"></i>
              Specialist Agent Roster & Profiles
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Manage specialist agent definitions, system roles, tool authorization, and live runtime instances.</p>
          </div>
          <button class="btn btn-primary btn-sm gap-2 shadow" id="btn-create-profile">
            <i class="fi fi-rr-user-add text-xs"></i>
            <span>Register Profile</span>
          </button>
          <button class="btn btn-outline btn-sm gap-2" id="btn-sync-hermes" title="Sinkronkan daftar profil dari ~/.hermes/profiles">
            <i class="fi fi-rr-refresh text-xs"></i>
            <span>Sync Hermes</span>
          </button>
        </div>

        <!-- Filter Bar with DaisyUI Join Component -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-base-content/60 font-bold uppercase tracking-wider mr-2">Department:</span>
          <div class="join flex-wrap shadow-sm border border-base-content/10 bg-base-200 p-1">
            <button class="btn btn-xs join-item dept-filter-btn active btn-primary" data-dept="all">All Departments</button>
            <button class="btn btn-xs join-item dept-filter-btn btn-ghost" data-dept="Operations">Operations</button>
            <button class="btn btn-xs join-item dept-filter-btn btn-ghost" data-dept="Development">Development</button>
            <button class="btn btn-xs join-item dept-filter-btn btn-ghost" data-dept="UI/UX">UI/UX</button>
            <button class="btn btn-xs join-item dept-filter-btn btn-ghost" data-dept="Creative Studio">Creative</button>
            <button class="btn btn-xs join-item dept-filter-btn btn-ghost" data-dept="Quality Assurance">QA</button>
            <button class="btn btn-xs join-item dept-filter-btn btn-ghost" data-dept="Research">Research</button>
            <button class="btn btn-xs join-item dept-filter-btn btn-ghost" data-dept="Marketing">Marketing</button>
          </div>
        </div>

        <!-- Agent Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" id="agents-grid">
          <div class="text-base-content/50 text-xs py-8 text-center col-span-full">Loading agents roster...</div>
        </div>
      </div>

      <!-- Register Agent Profile Modal (DaisyUI Standard Component) -->
      <dialog id="agent-modal" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box bg-base-200 border border-base-content/10 text-base-content">
          <div class="flex justify-between items-center pb-3 border-b border-base-content/10">
            <h3 class="font-bold text-base text-base-content flex items-center gap-2">
              <i class="fi fi-rr-user-add text-primary"></i>
              Register Specialist Agent Profile
            </h3>
            <button class="btn btn-sm btn-circle btn-ghost text-base-content/60 hover:text-base-content" id="modal-close-btn">✕</button>
          </div>

          <form id="agent-profile-form" class="space-y-4 pt-4">
            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Profile Name</label>
              <input type="text" class="input input-bordered input-sm w-full bg-base-100 text-base-content border-base-content/20" id="prof-name" placeholder="e.g. Lead Cloud Architect" required />
            </div>
            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Identifier Slug</label>
              <input type="text" class="input input-bordered input-sm w-full bg-base-100 text-base-content border-base-content/20" id="prof-slug" placeholder="e.g. cloud-architect" required />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Department</label>
                <select class="select select-bordered select-sm w-full bg-base-100 text-base-content border-base-content/20" id="prof-dept" required>
                  <option value="Development">Development</option>
                  <option value="Operations">Operations</option>
                  <option value="UI/UX">UI/UX</option>
                  <option value="Creative Studio">Creative Studio</option>
                  <option value="Quality Assurance">Quality Assurance</option>
                  <option value="Research">Research</option>
                  <option value="Marketing">Marketing</option>
                </select>
              </div>
              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Default Room</label>
                <select class="select select-bordered select-sm w-full bg-base-100 text-base-content border-base-content/20" id="prof-room" required>
                  <option value="room_dev">Development Room</option>
                  <option value="room_ops">Operations Room</option>
                  <option value="room_uiux">UI/UX Lab</option>
                  <option value="room_creative">Creative Studio</option>
                  <option value="room_qa">QA Laboratory</option>
                  <option value="room_research">Research Lab</option>
                  <option value="room_marketing">Marketing Room</option>
                  <option value="room_server">Server Room</option>
                </select>
              </div>
            </div>
            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Description / System Role</label>
              <textarea class="textarea textarea-bordered textarea-sm w-full bg-base-100 text-base-content border-base-content/20" id="prof-desc" rows="3" placeholder="Primary responsibility and execution guidelines..."></textarea>
            </div>
            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Capabilities (comma separated)</label>
              <input type="text" class="input input-bordered input-sm w-full bg-base-100 text-base-content border-base-content/20" id="prof-caps" placeholder="e.g. kubernetes, terraform, ci_cd" />
            </div>
            <div class="modal-action border-t border-base-content/10 pt-3">
              <button type="button" class="btn btn-ghost btn-sm" id="modal-cancel-btn">Cancel</button>
              <button type="submit" class="btn btn-primary btn-sm gap-1.5 shadow">
                <i class="fi fi-rr-disk text-xs"></i>
                <span>Save Profile</span>
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
    this.subscribeRealtime();
    await this.loadAgents(this.filterDept);
  }

  async loadAgents(filterDept = this.filterDept) {
    this.filterDept = filterDept;
    try {
      const data = await api.get('/api/agents');
      const { instances } = data;
      const grid = document.getElementById('agents-grid');
      if (!grid) return;

      const filtered = filterDept === 'all'
        ? instances
        : instances.filter((i) => i.department === filterDept);

      if (filtered.length === 0) {
        grid.innerHTML = `<div class="text-base-content/50 text-xs py-8 text-center col-span-full">No agent instances found for department: ${filterDept}</div>`;
        return;
      }

      grid.innerHTML = filtered.map((agent) => {
        let caps = [];
        try { caps = JSON.parse(agent.capabilities_json || '[]'); } catch {}

        return `
          <div class="card bg-base-200 border border-base-content/10 shadow-lg hover:border-primary/40 hover:shadow-xl transition-all duration-200 rounded-box overflow-hidden">
            <div class="card-body p-5 space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                  <div class="avatar placeholder">
                    <div class="rounded-xl w-10 text-white font-bold text-xs" style="background: ${this.getDeptColor(agent.department)};">
                      <i class="${this.getDeptIcon(agent.department)} text-base"></i>
                    </div>
                  </div>
                  <div>
                    <h3 class="font-bold text-sm text-base-content">${agent.display_name}</h3>
                    <p class="text-xs text-base-content/60">${agent.profile_name}</p>
                  </div>
                </div>
                <span class="badge badge-xs font-mono font-semibold ${agent.status === 'working' ? 'badge-primary' : agent.status === 'waiting' ? 'badge-warning' : agent.status === 'completed' ? 'badge-success' : 'badge-ghost'}">
                  ${agent.status}
                </span>
              </div>

              <div class="text-xs text-base-content/80 min-h-[36px] line-clamp-2">
                ${agent.active_task_title ? `<strong class="text-info">Working:</strong> ${agent.active_task_title}` : '<span class="text-base-content/70 italic">Idle — available for task assignment.</span>'}
              </div>

              <div class="flex flex-wrap gap-1">
                ${caps.slice(0, 4).map((c) => `<span class="badge badge-neutral badge-xs">${c}</span>`).join('')}
              </div>

              <div class="flex justify-between items-center pt-3 border-t border-base-content/10 text-xs text-base-content/60">
                <div class="flex items-center gap-1.5">
                  <i class="fi fi-rr-marker text-[11px] text-base-content/40"></i>
                  <span>${agent.room_name || 'Floor'}</span>
                </div>
                ${(() => {
                  const terminalStatuses = ['completed', 'failed', 'cancelled', 'idle', 'offline'];
                  const isTerminal = terminalStatuses.includes(agent.status);
                  const isWaiting = agent.status === 'waiting';
                  if (isTerminal) {
                    return `<button class="btn btn-ghost btn-xs text-base-content/40 btn-cmd-pause gap-1" data-id="${agent.id}" data-status="${agent.status}" disabled title="Terminal status: cannot pause/resume"><i class="fi fi-rr-pause text-xs text-base-content/40"></i><span>N/A</span></button>`;
                  }
                  return `<button class="btn btn-ghost btn-xs text-base-content hover:text-primary btn-cmd-pause gap-1" data-id="${agent.id}" data-status="${agent.status}"><i class="${isWaiting ? 'fi fi-rr-play text-xs text-success' : 'fi fi-rr-pause text-xs text-warning'}"></i><span>${isWaiting ? 'Resume' : 'Pause'}</span></button>`;
                })()}
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load agents:', err);
    }
  }

  getDeptColor(dept) {
    const map = {
      Operations: '#3b82f6',
      Development: '#10b981',
      'UI/UX': '#06b6d4',
      'Creative Studio': '#ec4899',
      'Quality Assurance': '#f59e0b',
      Research: '#8b5cf6',
      Marketing: '#f97316'
    };
    return map[dept] || '#475569';
  }

  getDeptIcon(dept) {
    const map = {
      Operations: 'fi fi-rr-brain',
      Development: 'fi fi-rr-code-branch',
      'UI/UX': 'fi fi-rr-layout-fluid',
      'Creative Studio': 'fi fi-rr-palette',
      'Quality Assurance': 'fi fi-rr-shield-check',
      Research: 'fi fi-rr-search-alt',
      Marketing: 'fi fi-rr-bullhorn'
    };
    return map[dept] || 'fi fi-rr-user-robot';
  }

  initEvents() {
    // Dept filters
    document.querySelectorAll('.dept-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.dept-filter-btn').forEach((b) => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-ghost');
        });
        e.target.classList.add('active', 'btn-primary');
        e.target.classList.remove('btn-ghost');
        this.loadAgents(e.target.dataset.dept);
      });
    });

    // Pause/Resume command buttons
    this.container.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-cmd-pause');
      if (btn) {
        const id = btn.dataset.id;
        const status = btn.dataset.status;
        // Only allow pause/resume for active statuses
        const pausableStatuses = ['working', 'thinking', 'collaborating', 'walking'];
        const resumableStatuses = ['waiting'];
        if (!pausableStatuses.includes(status) && !resumableStatuses.includes(status)) {
          toast.warning(`${status.charAt(0).toUpperCase() + status.slice(1)} agent cannot be paused or resumed`);
          return;
        }
        const cmd = status === 'waiting' ? 'resume' : 'pause';
        await api.post(`/api/agents/${id}/commands`, { command: cmd });
        await this.loadAgents();
      }
    });

    // Modal controls
    const modal = document.getElementById('agent-modal');
    document.getElementById('btn-create-profile')?.addEventListener('click', () => modal?.showModal());
    document.getElementById('btn-sync-hermes')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const res = await api.post('/api/agents/sync-hermes');
        showToast('success', `Hermes sync: ${res.created.length} baru, ${res.existing.length} sudah ada`);
        await this.loadAgents(this.filterDept);
      } catch (err) {
        showToast('error', `Gagal sync Hermes: ${err.message}`);
      } finally {
        btn.disabled = false;
      }
    });
    document.getElementById('modal-close-btn')?.addEventListener('click', () => modal?.close());
    document.getElementById('modal-cancel-btn')?.addEventListener('click', () => modal?.close());

    // Profile form submission
    document.getElementById('agent-profile-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const caps = document.getElementById('prof-caps').value.split(',').map((s) => s.trim()).filter(Boolean);
        await api.post('/api/agents', {
          name: document.getElementById('prof-name').value,
          slug: document.getElementById('prof-slug').value,
          department: document.getElementById('prof-dept').value,
          systemRole: 'specialist',
          defaultRoomId: document.getElementById('prof-room').value,
          description: document.getElementById('prof-desc').value,
          capabilities: caps,
          allowedTools: []
        });

        modal?.close();
        alert('Agent profile registered successfully!');
        await this.loadAgents();
      } catch (err) {
        alert('Failed to create profile: ' + err.message);
      }
    });
  }

  destroy() {
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    clearTimeout(this.refreshTimer);
  }
}

export default AgentsView;
