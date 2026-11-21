/**
 * Bulk Action Manager - Multi-select on tasks/agents grid
 * Supports select-all, individual select, bulk operations via toolbar
 */

export class BulkActionManager {
  constructor(options = {}) {
    this.containerId = options.containerId || 'bulk-action-toolbar';
    this.itemSelector = options.itemSelector || '.bulk-select-item';
    this.selectAllSelector = options.selectAllSelector || '#bulk-select-all';
    this.toolbarSelector = options.toolbarSelector || '#bulk-action-toolbar';
    this.onBulkAction = options.onBulkAction || (() => {});
    this.selectedIds = new Set();
    this.items = []; // { id, element, checkbox }
    this.isMultiSelectMode = false;
  }

  init(container) {
    this.container = container;
    this.renderToolbar();
    this.bindEvents();
  }

  renderToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = this.containerId;
    toolbar.className = 'flex items-center gap-2 px-3 py-2 bg-base-200/50 border border-base-content/10 rounded-lg hidden transition-all duration-200';
    toolbar.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="text-xs font-semibold text-base-content/70 uppercase tracking-wider">${this.selectedIds.size} dipilih</span>
        <button type="button" id="bulk-cancel-select" class="btn btn-ghost btn-xs text-base-content/60 hover:bg-base-content/10">
          <i class="fi fi-rr-times text-xs"></i>
          <span class="ml-1">Batal</span>
        </button>
      </div>
      <div class="flex items-center gap-2 ml-2" id="bulk-actions-group">
        <!-- Bulk action buttons injected by onBulkAction -->
      </div>
    `;
    this.container.parentNode.insertBefore(toolbar, this.container.nextSibling);
    this.toolbar = document.getElementById(this.containerId);
    this.cancelBtn = document.getElementById('bulk-cancel-select');
    this.actionsGroup = document.getElementById('bulk-actions-group');
    this.countEl = this.toolbar.querySelector('span');
  }

  bindEvents() {
    // Select all checkbox
    const selectAll = document.getElementById(this.selectAllSelector);
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        this.toggleAll(e.target.checked);
      });
    }

    // Cancel selection
    this.cancelBtn?.addEventListener('click', () => {
      this.clearSelection();
    });

    // Individual item checkboxes (delegated)
    this.container.addEventListener('change', (e) => {
      if (e.target.classList.contains('bulk-checkbox')) {
        const id = e.target.dataset.id;
        // Guard against undefined/null IDs entering selectedIds
        if (!id || id === 'undefined') return;
        if (e.target.checked) {
          this.selectedIds.add(id);
          e.target.closest(this.itemSelector)?.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
        } else {
          this.selectedIds.delete(id);
          e.target.closest(this.itemSelector)?.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
        }
        this.updateToolbar();
      }
    });
  }

  toggleAll(checked) {
    this.container.querySelectorAll('.bulk-checkbox').forEach((cb) => {
      cb.checked = checked;
      const id = cb.dataset.id;
      // Guard against undefined/null IDs entering selectedIds
      if (!id || id === 'undefined') return;
      if (checked) {
        this.selectedIds.add(id);
        cb.closest(this.itemSelector)?.classList.add('ring-2', 'ring-primary', 'ring-offset-1');
      } else {
        this.selectedIds.delete(id);
        cb.closest(this.itemSelector)?.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
      }
    });
    this.updateToolbar();
    // Update select-all indeterminate state
    const selectAll = document.getElementById(this.selectAllSelector);
    if (selectAll) {
      selectAll.checked = checked;
      selectAll.indeterminate = false;
    }
  }

  clearSelection() {
    this.selectedIds.clear();
    this.container.querySelectorAll('.bulk-checkbox').forEach((cb) => {
      cb.checked = false;
      cb.closest(this.itemSelector)?.classList.remove('ring-2', 'ring-primary', 'ring-offset-1');
    });
    const selectAll = document.getElementById(this.selectAllSelector);
    if (selectAll) selectAll.checked = false;
    this.updateToolbar();
  }

  updateToolbar() {
    if (!this.toolbar) return;

    const count = this.selectedIds.size;
    const selectAll = document.getElementById(this.selectAllSelector);

    // Update select-all state
    if (selectAll) {
      const total = this.container.querySelectorAll('.bulk-checkbox').length;
      if (count === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
      } else if (count === total) {
        selectAll.checked = true;
        selectAll.indeterminate = false;
      } else {
        selectAll.indeterminate = true;
      }
    }

    // Show/hide toolbar
    if (count > 0) {
      this.toolbar.classList.remove('hidden');
      if (this.countEl) this.countEl.innerText = `${count} dipilih`;
    } else {
      this.toolbar.classList.add('hidden');
    }

    // Render bulk action buttons
    if (this.actionsGroup && typeof this.onBulkAction === 'function') {
      this.actionsGroup.innerHTML = '';
      const actions = this.onBulkAction(Array.from(this.selectedIds));
      actions.forEach((action) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn btn-${action.type || 'primary'} btn-xs gap-1.5 ${action.disabled ? 'opacity-50 cursor-not-allowed' : ''}`;
        btn.disabled = action.disabled || false;
        btn.title = action.title || action.label;
        btn.innerHTML = `<i class="${action.icon || 'fi fi-rr-dot'} text-xs"></i> <span>${action.label}</span>`;
        btn.addEventListener('click', () => {
          if (action.disabled) return;
          action.handler(Array.from(this.selectedIds));
          this.clearSelection();
        });
        this.actionsGroup.appendChild(btn);
      });
    }
  }

  // Register items after rendering (call this after list is rendered)
  registerItems() {
    // Checkboxes are added dynamically; event delegation handles changes
    // But we need to ensure select-all state reflects current checkboxes
    this.updateToolbar();
  }

  destroy() {
    this.selectedIds.clear();
    this.toolbar?.remove();
    this.toolbar = null;
  }
}

export default BulkActionManager;