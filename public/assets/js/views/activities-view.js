import { api } from '../core/api.js';

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
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm w-full text-xs">
              <thead>
                <tr class="bg-base-300/50 text-base-content/70 border-b border-base-content/10">
                  <th>Timestamp</th>
                  <th>Agent / Actor</th>
                  <th>Event Type</th>
                  <th>Room Location</th>
                  <th>Activity Description</th>
                </tr>
              </thead>
              <tbody id="activities-table-body">
                <tr><td colspan="5" class="text-center text-base-content/50 py-6">Loading audit stream...</td></tr>
              </tbody>
            </table>
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
      const tbody = document.getElementById('activities-table-body');
      if (!tbody) return;

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center text-base-content/50 py-6">No activities recorded yet.</td></tr>`;
        return;
      }

      tbody.innerHTML = data.map((item) => `
        <tr class="hover:bg-base-300/40">
          <td class="font-mono text-primary text-[11px] whitespace-nowrap">
            ${item.occurred_at ? new Date(item.occurred_at).toLocaleTimeString() : '-'}
          </td>
          <td>
            <div class="font-bold text-base-content flex items-center gap-1.5">
              <i class="fi fi-rr-user-robot text-base-content/40 text-xs"></i>
              <span>${item.agent_name || 'System Orchestrator'}</span>
            </div>
            ${item.department ? `<div class="text-[10px] text-base-content/50">${item.department}</div>` : ''}
          </td>
          <td>
            <span class="badge badge-xs font-mono uppercase ${this.getEventBadge(item.event_type)}">
              ${item.event_type}
            </span>
          </td>
          <td class="text-base-content/70">
            ${item.room_name || '<span class="text-base-content/40 italic">Office Floor</span>'}
          </td>
          <td class="text-base-content/90">
            ${item.description}
          </td>
        </tr>
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
