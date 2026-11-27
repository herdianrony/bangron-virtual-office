import { api } from '../core/api.js';
import { EmptyState, EmptyStatePresets } from '../core/empty-state.js';

export class ActivitiesView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-base-content/10">
          <div>
            <h2 class="text-2xl font-bold tracking-tight text-base-content flex items-center gap-2.5">
              <i class="fi fi-rr-bolt text-warning text-xl"></i>
              Immutable Activity & Audit Stream
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Full chronological event timeline: agent thoughts, tool dispatches, state migrations, and director governance.</p>
          </div>
          <button class="btn btn-ghost btn-sm gap-2 text-base-content/70 hover:text-base-content" id="act-refresh-btn">
            <i class="fi fi-rr-refresh text-xs"></i>
            <span>Refresh Stream</span>
          </button>
        </div>

        <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
          <div class="card-body p-5">
            <ul class="timeline timeline-vertical timeline-compact" id="activities-timeline">
              <li><div class="timeline-start text-xs text-base-content/60"><span class="loading loading-dots loading-sm"></span></div></li>
            </ul>
          </div>
        </div>
      </div>
    `;

    document.getElementById('act-refresh-btn')?.addEventListener('click', () => this.loadActivities());
    await this.loadActivities();
  }

  async loadActivities() {
    try {
      const data = await api.get('/api/activities?limit=100');
      const tbody = document.getElementById('activities-timeline');
      if (!tbody) return;

      if (!data || data.length === 0) {
        tbody.innerHTML = `<li><div class="alert alert-info text-xs">No activities recorded yet.</div></li>`;
        return;
      }

      tbody.innerHTML = data.slice(0, 50).map((item) => `
        <li>
          <div class="timeline-start text-[10px] font-mono text-base-content/60 whitespace-nowrap">
            ${item.occurred_at ? new Date(item.occurred_at).toLocaleTimeString() : '-'}
          </div>
          <div class="timeline-middle">
            <i class="fi fi-rr-circle-small text-primary text-xs"></i>
          </div>
          <div class="timeline-end timeline-box bg-base-100/70 border-base-content/10 text-xs">
            <div class="flex flex-wrap items-center gap-2">
              <div class="avatar placeholder">
                <div class="bg-primary/10 text-primary rounded-full w-6 h-6"><i class="fi fi-rr-user-robot text-[10px]"></i></div>
              </div>
              <strong class="text-base-content">${item.agent_name || 'System Orchestrator'}</strong>
              ${item.department ? `<span class="badge badge-ghost badge-xs">${item.department}</span>` : ''}
              ${(() => { const et = item.activity_type || item.event_type || 'unknown'; return `<span class="badge badge-xs font-mono uppercase ${this.getEventBadge(et)}">${et.replace(/_/g, ' ')}</span>`; })()}
              <span class="text-base-content/60">${item.room_name || 'Office Floor'}</span>
            </div>
            <div class="mt-1 text-base-content/80">${item.description}</div>
          </div>
          <hr />
        </li>
      `).join('');
    } catch (err) {
      console.error('Failed to load activities:', err);
    }
  }

  getEventBadge(type) {
    if (!type) return 'badge-ghost';
    if (type.includes('task')) return 'badge-primary';
    if (type.includes('approval') || type.includes('security')) return 'badge-warning';
    if (type.includes('move')) return 'badge-info';
    if (type.includes('error') || type.includes('fail')) return 'badge-error';
    return 'badge-ghost';
  }

  destroy() {}
}

export default ActivitiesView;
