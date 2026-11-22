import { api } from '../core/api.js';
import { EmptyState, EmptyStatePresets } from '../core/empty-state.js';

export class DeliverablesView {
  constructor(container) {
    this.container = container;
  }

  async render() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-base-content/10">
          <div>
            <h2 class="text-2xl font-bold tracking-tight text-base-content flex items-center gap-2.5">
              <i class="fi fi-rr-box-open text-primary text-xl"></i>
              Digital Studio Deliverables & Asset Vault
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Generated code repositories, design prototypes, research briefs, and marketing collateral.</p>
          </div>
        </div>

        <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm w-full text-xs">
              <thead>
                <tr class="bg-base-300/50 text-base-content/70 border-b border-base-content/10">
                  <th>Deliverable Name</th>
                  <th>Category</th>
                  <th>Project / Task</th>
                  <th>Author Specialist</th>
                  <th>Version</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="deliverables-table-body">
                <tr><td colspan="7" class="text-center text-base-content/50 py-6">Loading studio assets...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    await this.loadDeliverables();
  }

  async loadDeliverables() {
    try {
      const items = await api.get('/api/deliverables');
      const tbody = document.getElementById('deliverables-table-body');
      if (!tbody) return;

      if (items.length === 0) {
        const container = document.getElementById('deliverables-table-body');
        EmptyState.show(container.parentElement, EmptyStatePresets.noDeliverables);
        return;
      }

      tbody.innerHTML = items.map((item) => `
        <tr class="hover:bg-base-300/40">
          <td>
            <div class="font-bold text-base-content flex items-center gap-2">
              <i class="fi ${this.getTypeIcon(item.file_type || item.category)} text-primary"></i>
              <span>${item.title || item.name}</span>
            </div>
            <div class="text-[11px] text-base-content/60 mt-0.5 truncate max-w-xs">${item.description || item.file_path || ''}</div>
          </td>
          <td>
            <span class="badge badge-xs badge-neutral font-mono uppercase">${item.category || 'asset'}</span>
          </td>
          <td>
            <div class="text-base-content font-medium">${item.project_name || 'Studio General'}</div>
            <div class="text-[11px] text-base-content/50 truncate max-w-xs">${item.task_title || '-'}</div>
          </td>
          <td>
            <span class="badge badge-sm badge-neutral text-base-content">${item.creator_agent_name || 'Autonomous Agent'}</span>
          </td>
          <td>
            <span class="badge badge-xs badge-info font-mono">v${item.version || '1.0'}</span>
          </td>
          <td class="text-base-content/60 font-mono text-[11px]">
            ${item.created_at ? new Date(item.created_at).toLocaleDateString() : '-'}
          </td>
          <td>
            ${item.download_url || item.file_path ? `
              <a href="${item.download_url || item.file_path}" target="_blank" class="btn btn-ghost btn-xs text-primary hover:bg-primary/10 gap-1">
                <i class="fi fi-rr-download text-xs"></i>
                <span>Download</span>
              </a>
            ` : '<span class="text-base-content/40 italic">Virtual</span>'}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      console.error('Failed to load deliverables:', err);
    }
  }

  getTypeIcon(type) {
    if (!type) return 'fi-rr-document';
    const t = type.toLowerCase();
    if (t.includes('code') || t.includes('git') || t.includes('js') || t.includes('py')) return 'fi-rr-code-branch';
    if (t.includes('design') || t.includes('figma') || t.includes('svg') || t.includes('png')) return 'fi-rr-palette';
    if (t.includes('doc') || t.includes('report') || t.includes('brief') || t.includes('md')) return 'fi-rr-document-signed';
    return 'fi-rr-box-open';
  }

  destroy() {}
}

export default DeliverablesView;
