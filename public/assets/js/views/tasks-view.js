import { api } from '../core/api.js';
import { SkeletonLoader } from '../core/skeleton.js';
import { EmptyState, EmptyStatePresets } from '../core/empty-state.js';
import { showToast } from '../core/toast.js';
import { ConfirmDialog } from '../core/confirm-dialog.js';
import { BulkActionManager } from '../core/bulk-action.js';
import { VirtualScroll } from '../core/virtual-scroll.js';

export class TasksView {
  constructor(container) {
    this.container = container;
    this.capabilities = [];
    this.agents = [];
    this.bulkManager = null;
    this.virtualScroll = null;
  }

  showSkeleton() {
    this.container.innerHTML = `
      <div class="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
        <div class="stats stats-vertical lg:stats-horizontal shadow-xl bg-base-200 border border-base-content/10 w-full">
          ${SkeletonLoader.skeletonStat()}
        </div>
        <div class="overflow-x-auto">
          ${SkeletonLoader.skeletonTable(6, 5)}
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
              <i class="fi fi-rr-list-check text-primary text-xl"></i>
              Multi-Agent Task Orchestration Board
            </h2>
            <p class="text-xs text-base-content/60 mt-1">Supervise parent objectives, delegated specialist subtasks, and DAG dependencies.</p>
          </div>
          <button class="btn btn-primary btn-sm gap-2 shadow" id="btn-create-task">
            <i class="fi fi-rr-plus text-xs"></i>
            <span>Create Task</span>
          </button>
        </div>

        <!-- Filter bar with DaisyUI Join Component -->
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-xs text-base-content/60 font-bold uppercase tracking-wider mr-2">Filter by Status:</span>
          <div class="join shadow-sm border border-base-content/10 bg-base-200 p-1">
            <button class="btn btn-xs join-item task-filter-btn active btn-primary" data-status="all">All</button>
            <button class="btn btn-xs join-item task-filter-btn btn-ghost" data-status="running">Running</button>
            <button class="btn btn-xs join-item task-filter-btn btn-ghost" data-status="waiting">Waiting</button>
            <button class="btn btn-xs join-item task-filter-btn btn-ghost" data-status="completed">Completed</button>
            <button class="btn btn-xs join-item task-filter-btn btn-ghost" data-status="failed">Failed</button>
          </div>
        </div>

        <!-- DaisyUI Table Card -->
        <div class="card bg-base-200 border border-base-content/10 shadow-xl rounded-box overflow-hidden">
          <div class="overflow-x-auto">
            <table class="table table-zebra table-sm w-full text-xs">
              <thead>
                <tr class="bg-base-300/50 text-base-content/70 border-b border-base-content/10">
                  <th class="w-8"><input type="checkbox" id="bulk-select-all" class="bulk-select-all checkbox checkbox-sm checkbox-primary" /></th>
                  <th>Task Title</th>
                  <th>Type / Subtasks</th>
                  <th>Assigned Specialist</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Result / Timeline</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="tasks-table-body">
                <tr><td colspan="7" class="text-center text-base-content/50 py-6">Loading tasks board...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Create Task Modal (DaisyUI Standard Component) -->
      <dialog id="task-modal" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box bg-base-200 border border-base-content/10 text-base-content">
          <div class="flex justify-between items-center pb-3 border-b border-base-content/10">
            <h3 class="font-bold text-base text-base-content flex items-center gap-2">
              <i class="fi fi-rr-plus-circle text-primary"></i>
              Create Operational Task
            </h3>
            <button class="btn btn-sm btn-circle btn-ghost text-base-content/60 hover:text-base-content" id="task-modal-close">✕</button>
          </div>

          <form id="create-task-form" class="space-y-4 pt-4">
            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Task Title</label>
              <input type="text" class="input input-bordered input-sm w-full bg-base-100 text-base-content border-base-content/20" id="task-title" placeholder="e.g. Audit JWT Security Policy" required />
            </div>

            <div>
              <label class="label text-xs font-semibold text-base-content/80 pb-1">Description & Deliverable Specs</label>
              <textarea class="textarea textarea-bordered textarea-sm w-full bg-base-100 text-base-content border-base-content/20" id="task-desc" rows="3" placeholder="Detailed prompt or execution guidelines..."></textarea>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Priority</label>
                <select class="select select-bordered select-sm w-full bg-base-100 text-base-content border-base-content/20" id="task-priority">
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Filter by Capability</label>
                <select class="select select-bordered select-sm w-full bg-base-100 text-base-content border-base-content/20" id="task-capability-filter">
                  <option value="">All Capabilities</option>
                </select>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="col-span-full">
                <label class="label text-xs font-semibold text-base-content/80 pb-1">Assign Specialist</label>
                <select class="select select-bordered select-sm w-full bg-base-100 text-base-content border-base-content/20" id="task-agent">
                  <option value="">-- Let Hermes Assign --</option>
                </select>
                <span class="text-[11px] text-base-content/40 block mt-1" id="task-agent-cap-hint">Hermes auto-assigns best-matched specialist based on task description and capabilities.</span>
              </div>
            </div>

            <div class="form-control">
              <label class="cursor-pointer label justify-start gap-2.5">
                <input type="checkbox" class="checkbox checkbox-primary checkbox-sm" id="task-requires-approval" />
                <span class="label-text text-xs text-base-content/80">Require Director Approval before sensitive operations</span>
              </label>
            </div>

            <div class="modal-action border-t border-base-content/10 pt-3">
              <button type="button" class="btn btn-ghost btn-sm" id="task-modal-cancel">Cancel</button>
              <button type="submit" class="btn btn-primary btn-sm gap-1.5 shadow">
                <i class="fi fi-rr-paper-plane text-xs"></i>
                <span>Dispatch Task</span>
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
    await this.loadAgentsOptions();
    await this.loadTasks();
  }

  async loadAgentsOptions() {
    try {
      const [agentsResult, capabilitiesResult] = await Promise.allSettled([
        api.get('/api/agents'),
        api.get('/api/agents/capabilities')
      ]);

      if (agentsResult.status === 'rejected') {
        throw agentsResult.reason;
      }
      this.agents = agentsResult.value?.instances || [];
      this.capabilities = capabilitiesResult.status === 'fulfilled'
        ? (capabilitiesResult.value?.capabilities || [])
        : [];

      if (capabilitiesResult.status === 'rejected') {
        // Agent assignment remains usable even if the optional capability
        // catalogue is temporarily unavailable.
        console.warn('Capabilities unavailable; showing all agents:', capabilitiesResult.reason);
      }

      const select = document.getElementById('task-agent');
      const capFilter = document.getElementById('task-capability-filter');
      if (select) {
        select.innerHTML = '<option value="">-- Let Hermes Assign --</option>' +
          this.agents.map((i) => `<option value="${i.id}" data-cap="${i.capabilities ? i.capabilities.join(',') : ''}">${i.display_name} (${i.department})</option>`).join('');
      }
      if (capFilter) {
        capFilter.innerHTML = '<option value="">All Capabilities</option>' +
          this.capabilities.map((c) => `<option value="${c}">${c}</option>`).join('');
      }
    } catch (err) {
      console.error('Failed to load agents/capabilities:', err);
    }
  }

  filterAgentsByCapability() {
    const capFilter = document.getElementById('task-capability-filter');
    const agentSelect = document.getElementById('task-agent');
    const hint = document.getElementById('task-agent-cap-hint');
    if (!capFilter || !agentSelect) return;

    const selectedCap = capFilter.value;
    agentSelect.innerHTML = '<option value="">-- Let Hermes Assign --</option>' +
      this.agents
        .filter((i) => !selectedCap || (i.capabilities && i.capabilities.includes(selectedCap)))
        .map((i) => `<option value="${i.id}" data-cap="${i.capabilities ? i.capabilities.join(',') : ''}">${i.display_name} (${i.department})</option>`).join('');

    if (hint) {
      hint.innerText = selectedCap
        ? `Showing agents with capability: ${selectedCap}`
        : 'Hermes auto-assigns best-matched specialist based on task description and capabilities.';
    }
  }

  async loadTasks(statusFilter = 'all') {
    try {
      const tasksResponse = await api.get('/api/tasks');
      const tasks = Array.isArray(tasksResponse)
        ? tasksResponse
        : (Array.isArray(tasksResponse?.tasks) ? tasksResponse.tasks : []);
      const tbody = document.getElementById('tasks-table-body');
      if (!tbody) return;

      const filteredTasks = statusFilter === 'all'
        ? tasks
        : tasks.filter((task) => task.status === statusFilter);

      if (filteredTasks.length === 0) {
        const container = document.getElementById('tasks-table-body').parentElement;
        EmptyState.show(container, {
          icon: 'fi fi-rr-list',
          title: 'Tidak ada task',
          description: statusFilter === 'all' ? 'Tidak ada task yang tersedia saat ini.' : `Tidak ada task dengan status: ${statusFilter}`,
          actionLabel: 'Buat Task Baru',
          actionOnClick: () => { document.getElementById('btn-create-task')?.click(); }
        });
        return;
      }

      tbody.innerHTML = filteredTasks.map((t) => {
        const isParent = !t.parent_task_id && t.subtask_count > 0;
        return `
          <tr class="hover:bg-base-300/40 bulk-select-item">
            <td class="w-8">
              <input type="checkbox" class="bulk-checkbox checkbox checkbox-sm checkbox-primary" data-id="${t.id}" />
            </td>
            <td>
              <div class="font-bold text-base-content flex items-center gap-1.5">
                ${t.parent_task_id ? '<span class="text-info font-mono">↳</span>' : ''}
                ${t.title}
              </div>
              <div class="text-[11px] text-base-content/60 mt-0.5 truncate max-w-xs">${t.description || ''}</div>
            </td>
            <td>
              ${isParent ? `<span class="badge badge-info badge-xs font-mono font-semibold">${t.subtasks_completed_count}/${t.subtask_count} subtasks</span>` : '<span class="text-base-content/40 text-[11px]">Single Task</span>'}
            </td>
            <td>
              ${t.assigned_agent_name ? `<span class="badge badge-neutral badge-sm">${t.assigned_agent_name}</span>` : '<span class="text-base-content/40 italic">Unassigned</span>'}
            </td>
            <td>
              <span class="badge badge-xs font-semibold ${t.priority === 'critical' ? 'badge-error' : t.priority === 'high' ? 'badge-warning' : 'badge-ghost'}">
                ${t.priority}
              </span>
            </td>
            <td>
              <span class="badge badge-xs font-medium ${t.status === 'running' ? 'badge-primary' : t.status === 'waiting' ? 'badge-warning' : t.status === 'completed' ? 'badge-success' : t.status === 'failed' ? 'badge-error' : t.status === 'cancelled' ? 'badge-neutral' : t.status === 'on_hold' ? 'badge-info' : t.status === 'planning' ? 'badge-secondary' : 'badge-ghost'}">
                ${t.status}
              </span>
            </td>
            <td>
              <div class="text-xs text-base-content/80">
                ${t.result_summary || (t.status === 'running' ? '<span class="text-info flex items-center gap-1"><span class="loading loading-spinner loading-xs"></span> Executing step...</span>' : '-')}
              </div>
            </td>
            <td>
              <div class="flex items-center gap-1.5">
                ${t.status === 'failed' || t.status === 'cancelled' ? `
                  <button class="btn btn-ghost btn-xs text-warning hover:bg-warning/10 btn-retry gap-1" data-id="${t.id}" title="Retry Task">
                    <i class="fi fi-rr-refresh text-xs"></i>
                    <span>Retry</span>
                  </button>
                ` : ''}
                ${t.status === 'running' || t.status === 'waiting' || t.status === 'pending' ? `
                  <button class="btn btn-ghost btn-xs text-error hover:bg-error/10 btn-cancel gap-1" data-id="${t.id}" title="Cancel Task">
                    <i class="fi fi-rr-cross-circle text-xs"></i>
                    <span>Cancel</span>
                  </button>
                ` : ''}
              </div>
            </td>
          </tr>
        `;
      }).join('');

      // Initialize virtual scroll for large lists (100+ items)
      if (!this.virtualScroll && filteredTasks.length > 50) {
        const tbody = document.getElementById('tasks-table-body');
        if (tbody) {
          this.virtualScroll = new VirtualScroll({
            container: tbody.parentElement,
            itemHeight: 52,
            data: filteredTasks,
            renderItem: (task, index) => this.renderTaskRow(task)
          });
        }
      }
    } catch (err) {
      console.error('Failed to load tasks:', err);
    }
  }

  renderTaskRow(task, index) {
    const isParent = !task.parent_task_id && task.subtask_count > 0;
    return `
      <tr class="hover:bg-base-300/40 bulk-select-item">
        <td class="w-8">
          <input type="checkbox" class="bulk-checkbox checkbox checkbox-sm checkbox-primary" data-id="${task.id}" />
        </td>
        <td>
          <div class="font-bold text-base-content flex items-center gap-1.5">
            ${task.parent_task_id ? '<span class="text-info font-mono">↳</span>' : ''}
            ${task.title}
          </div>
          <div class="text-[11px] text-base-content/60 mt-0.5 truncate max-w-xs">${task.description || ''}</div>
        </td>
        <td>
          ${isParent ? `<span class="badge badge-info badge-xs font-mono font-semibold">${task.subtasks_completed_count}/${task.subtask_count} subtasks</span>` : '<span class="text-base-content/40 text-[11px]">Single Task</span>'}
        </td>
        <td>
          ${task.assigned_agent_name ? `<span class="badge badge-neutral badge-sm">${task.assigned_agent_name}</span>` : '<span class="text-base-content/40 italic">Unassigned</span>'}
        </td>
        <td>
          <span class="badge badge-xs font-semibold ${task.priority === 'critical' ? 'badge-error' : task.priority === 'high' ? 'badge-warning' : 'badge-ghost'}">
            ${task.priority}
          </span>
        </td>
        <td>
          <span class="badge badge-xs font-medium ${task.status === 'running' ? 'badge-primary' : task.status === 'waiting' ? 'badge-warning' : task.status === 'completed' ? 'badge-success' : task.status === 'failed' ? 'badge-error' : task.status === 'cancelled' ? 'badge-neutral' : task.status === 'on_hold' ? 'badge-info' : task.status === 'planning' ? 'badge-secondary' : 'badge-ghost'}">
            ${task.status}
          </span>
        </td>
        <td>
          <div class="text-xs text-base-content/80">
            ${task.result_summary || (task.status === 'running' ? '<span class="text-info flex items-center gap-1"><span class="loading loading-spinner loading-xs"></span> Executing step...</span>' : '-')}
          </div>
        </td>
        <td>
          <div class="flex items-center gap-1.5">
            ${task.status === 'failed' || task.status === 'cancelled' ? `<button class="btn btn-ghost btn-xs text-warning hover:bg-warning/10 btn-retry gap-1" data-id="${task.id}" title="Retry Task"><i class="fi fi-rr-refresh text-xs"></i><span>Retry</span></button>` : ''}
            ${task.status === 'running' || task.status === 'waiting' || task.status === 'pending' ? `<button class="btn btn-ghost btn-xs text-error hover:bg-error/10 btn-cancel gap-1" data-id="${task.id}" title="Cancel Task"><i class="fi fi-rr-cross-circle text-xs"></i><span>Cancel</span></button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }

  initEvents() {
    // Filters
    document.querySelectorAll('.task-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.task-filter-btn').forEach((b) => {
          b.classList.remove('active', 'btn-primary');
          b.classList.add('btn-ghost');
        });
        e.target.classList.add('active', 'btn-primary');
        e.target.classList.remove('btn-ghost');
        this.loadTasks(e.target.dataset.status);
      });
    });

    // Capability filter
    document.getElementById('task-capability-filter')?.addEventListener('change', () => {
      this.filterAgentsByCapability();
    });

    // Modal
    const modal = document.getElementById('task-modal');
    document.getElementById('btn-create-task')?.addEventListener('click', () => modal?.showModal());
    document.getElementById('task-modal-close')?.addEventListener('click', () => modal?.close());
    document.getElementById('task-modal-cancel')?.addEventListener('click', () => modal?.close());

    // Create Form
    document.getElementById('create-task-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const title = document.getElementById('task-title').value;
        const description = document.getElementById('task-desc').value;
        const priority = document.getElementById('task-priority').value;
        const assignedAgentId = document.getElementById('task-agent').value || null;
        const requiresApproval = document.getElementById('task-requires-approval').checked;

        await api.post('/api/tasks', {
          title,
          description,
          priority,
          assignedAgentId,
          requiresApproval
        });

        modal?.close();
        showToast('success', 'Task Created!', 'Operational task dispatched to Hermes pipeline.');
        await this.loadTasks();
      } catch (err) {
        showToast('error', 'Task Failed', err.message);
      }
    });

    // Bulk Action Manager
    this.bulkManager = new BulkActionManager({
      container: this.container,
      onBulkAction: (ids) => [
        { id: 'bulk-cancel', label: 'Batalkan Terpilih', icon: 'fi fi-rr-cross-small', type: 'error', handler: (selIds) => this.bulkCancel(selIds) },
        { id: 'bulk-retry', label: 'Coba Lagi Semua', icon: 'fi fi-rr-refresh', type: 'warning', handler: (selIds) => this.bulkRetry(selIds) }
      ]
    });
    this.bulkManager.init(document.getElementById('tasks-table-body'));

    // Table actions (retry, cancel)
    this.container.addEventListener('click', async (e) => {
      const retryBtn = e.target.closest('.btn-retry');
      if (retryBtn) {
        const id = retryBtn.dataset.id;
        await api.post(`/api/tasks/${id}/retry`);
        await this.loadTasks();
      }

      const cancelBtn = e.target.closest('.btn-cancel');
      if (cancelBtn) {
        const id = cancelBtn.dataset.id;
        const confirmed = await ConfirmDialog.ask({
          title: 'Cancel Task',
          message: 'Apakah Anda yakin ingin membatalkan task ini? Tindakan tidak dapat dibatalkan.',
          confirmLabel: 'Ya, Batalkan Task',
          cancelLabel: 'Batal',
          confirmType: 'error',
          onConfirm: async () => {
            await api.post(`/api/tasks/${id}/cancel`, { reason: 'Cancelled by Director from task board' });
            await this.loadTasks();
            showToast('warning', 'Task Dibatalkan', 'Task telah dibatalkan oleh Director.');
          }
        });
      }

      // Retry works for failed AND cancelled tasks
      const retryBtn2 = e.target.closest('.btn-retry');
      if (retryBtn2 && !retryBtn2.closest('.btn-retry')) {
        // handled above
      }
    });
  }

  async bulkCancel(ids) {
    const confirmed = await ConfirmDialog.ask({
      title: 'Batalkan Beberapa Task',
      message: `Yakin membatalkan ${ids.length} task yang dipilih? Tindakan tidak dapat diurungkan.`,
      confirmLabel: 'Ya, Batalkan Semua',
      cancelLabel: 'Batal',
      confirmType: 'error',
      onConfirm: async () => {
        const results = await Promise.allSettled(
          ids.map((id) => api.post(`/api/tasks/${id}/cancel`, { reason: 'Bulk cancel by Director' }))
        );
        const failed = results.filter((r) => r.status === 'rejected').length;
        await this.loadTasks();
        if (failed > 0) {
          showToast('warning', 'Bulk Cancel Partial', `${ids.length - failed}/${ids.length} task dibatalkan. ${failed} gagal.`);
        } else {
          showToast('warning', 'Task Dibatalkan', `${ids.length} task telah dibatalkan.`);
        }
      }
    });
  }

  async bulkRetry(ids) {
    const results = await Promise.allSettled(
      ids.map((id) => api.post(`/api/tasks/${id}/retry`))
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    await this.loadTasks();
    if (failed > 0) {
      showToast('warning', 'Bulk Retry Partial', `${ids.length - failed}/${ids.length} task dikirim ulang. ${failed} gagal.`);
    } else {
      showToast('info', 'Task Diretry', `${ids.length} task dikirim ulang untuk dieksekusi.`);
    }
  }

  destroy() {
    this.bulkManager?.destroy();
  }
}

export default TasksView;
