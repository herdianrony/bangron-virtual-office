/**
 * Command Palette - Cmd/Ctrl+K for navigation, actions, and quick commands
 * DaisyUI-based modal overlay with fuzzy search
 */

export class CommandPalette {
  constructor() {
    this.commands = [];
    this.isOpen = false;
    this.modalId = 'command-palette';
    this.searchId = 'cmd-search';
    this.resultsId = 'cmd-results';
    this.onClose = null;
  }

  register(commands) {
    this.commands = commands;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;

    const modal = document.createElement('div');
    modal.id = this.modalId;
    modal.className = 'modal modal-open';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Command Palette');

    modal.innerHTML = `
      <form method="dialog" class="modal-box w-full max-w-md z-[100]">
        <header class="pb-4 border-b border-base-content/10">
          <h3 class="font-bold text-lg text-base-content flex items-center gap-2">
            <i class="fi fi-rr-keyboard text-primary"></i>
            Command Palette
          </h3>
          <p class="text-xs text-base-content/60">Cmd/Ctrl+K to open · Enter to execute · Esc to close</p>
        </header>

        <div class="form-control w-full mt-4">
          <label class="label">
            <span class="label-text text-base-content/60">Cari aksi, halaman, atau agent...</span>
          </label>
          <input type="text" id="${this.searchId}" class="input input-bordered input-lg w-full bg-base-100 text-base-content border-base-content/20 focus:ring-2 focus:ring-primary" placeholder="Contoh: buka tasks, buat task, lihat agents..." autocomplete="off" autofocus />
        </div>

        <div id="${this.resultsId}" class="overflow-y-auto max-h-[60vh] p-2 space-y-1">
          <!-- Results rendered here -->
        </div>

        <footer class="pt-4 border-t border-base-content/10 text-xs text-base-content/40">
          Ketik untuk mencari · Pilih dengan panah · Enter eksekusi
        </footer>
      </form>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    `;

    document.body.appendChild(modal);

    const searchInput = document.getElementById(this.searchId);
    const resultsContainer = document.getElementById(this.resultsId);

    // Render all commands initially
    this.renderResults(this.commands, resultsContainer);

    // Search filter
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        this.renderResults(this.commands.slice(0, 10), resultsContainer);
        return;
      }

      const filtered = this.commands
        .filter((cmd) => {
          const haystack = `${cmd.label} ${cmd.description || ''} ${cmd.keywords || ''}`.toLowerCase();
          return this.fuzzyMatch(query, haystack);
        })
        .sort((a, b) => {
          // Exact match first, then starts-with, then contains
          const aLabel = a.label.toLowerCase();
          const bLabel = b.label.toLowerCase();
          if (aLabel.startsWith(query) && !bLabel.startsWith(query)) return -1;
          if (!aLabel.startsWith(query) && bLabel.startsWith(query)) return 1;
          return 0;
        })
        .slice(0, 10);

      this.renderResults(filtered, resultsContainer);
    });

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        modal.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    modal.addEventListener('close', () => {
      this.isOpen = false;
      document.removeEventListener('keydown', escHandler);
      if (this.onClose) this.onClose();
      setTimeout(() => modal.remove(), 100);
    });

    searchInput.focus();
  }

  fuzzyMatch(query, text) {
    let qi = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  renderResults(commands, container) {
    if (!container) return;

    if (!commands || commands.length === 0) {
      container.innerHTML = `
        <div class="flex items-center justify-center py-8 text-base-content/50 text-sm">
          <i class="fi fi-rr-search mr-2"></i>
          Tidak ditemukan hasil yang cocok
        </div>
      `;
      return;
    }

    container.innerHTML = commands.map((cmd) => `
      <button type="button" class="cmd-item w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm text-base-content hover:bg-base-300/50 transition-colors cursor-pointer border border-transparent hover:border-base-content/20" data-cmd="${cmd.id}">
        <div class="flex items-center gap-3 flex-1 min-w-0">
          <span class="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] font-bold bg-base-content/10 text-base-content/60">${cmd.icon || '?'}</span>
          <div class="min-w-0">
            <div class="font-medium text-base-content truncate">${cmd.label}</div>
            ${cmd.description ? `<div class="text-[11px] text-base-content/50 truncate">${cmd.description}</div>` : ''}
          </div>
        </div>
        <kbd class="text-xs text-base-content/40 bg-base-200/50 px-1.5 py-0.5 rounded">${cmd.shortcut || ''}</kbd>
      </button>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.cmd-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cmdId = btn.dataset.cmd;
        const cmd = this.commands.find((c) => c.id === cmdId);
        if (cmd && cmd.action) {
          cmd.action();
        }
        const modal = document.getElementById(this.modalId);
        if (modal) modal.close();
      });
    });
  }

  close() {
    const modal = document.getElementById(this.modalId);
    if (modal) modal.close();
  }
}

// Global singleton
export const commandPalette = new CommandPalette();

// Global keyboard listener for Cmd/Ctrl+K
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      commandPalette.open();
    }
  });
}

export default commandPalette;