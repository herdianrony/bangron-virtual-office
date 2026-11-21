/**
 * Unified Empty State Component
 * Consistent empty state pattern across all views
 */

export class EmptyState {
  constructor(options = {}) {
    this.icon = options.icon || 'fi fi-rr-inbox';
    this.title = options.title || 'Tidak ada data';
    this.description = options.description || 'Belum ada item yang tersedia.';
    this.actionLabel = options.actionLabel || null;
    this.actionHref = options.actionHref || null;
    this.actionOnClick = options.actionOnClick || null;
    this.size = options.size || 'md'; // sm, md, lg
  }

  render() {
    const sizeClasses = {
      sm: 'p-4',
      md: 'p-8',
      lg: 'p-12'
    };

    const iconSizes = {
      sm: 'w-12 h-12 text-2xl',
      md: 'w-16 h-16 text-3xl',
      lg: 'w-20 h-20 text-4xl'
    };

    const textSizes = {
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg'
    };

    return `
      <div class="card bg-base-200/50 border border-base-content/10 shadow-sm ${sizeClasses[this.size]}">
        <div class="card-body text-center space-y-4">
          <div class="inline-flex items-center justify-center rounded-full bg-base-300/50 text-base-content/50 ${iconSizes[this.size]}">
            <i class="${this.icon}"></i>
          </div>
          <div class="space-y-1">
            <h3 class="font-semibold text-base-content ${textSizes[this.size]}">${this.title}</h3>
            <p class="text-base-content/60 ${textSizes[this.size]}">${this.description}</p>
          </div>
          ${this.actionLabel && (this.actionHref || this.actionOnClick) ? `
            <div class="pt-2">
              ${this.actionHref ? 
                `<a href="${this.actionHref}" class="btn btn-primary btn-${this.size === 'sm' ? 'sm' : this.size === 'lg' ? 'lg' : ''} gap-2">${this.actionLabel}</a>` :
                `<button type="button" class="btn btn-primary btn-${this.size === 'sm' ? 'sm' : this.size === 'lg' ? 'lg' : ''} gap-2" data-empty-action="${this.actionOnClick}">${this.actionLabel}</button>`
              }
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  static show(container, options) {
    const emptyState = new EmptyState(options);
    container.innerHTML = emptyState.render();
    
    // Handle action click if using onClick
    if (options.actionOnClick && !options.actionHref) {
      const btn = container.querySelector('[data-empty-action]');
      if (btn) {
        btn.addEventListener('click', () => {
          options.actionOnClick();
        });
      }
    }
    
    return emptyState;
  }

  static hide(container) {
    container.innerHTML = '';
  }
}

// Predefined empty state configurations for common use cases
export const EmptyStatePresets = {
  noTasks: {
    icon: 'fi fi-rr-list-check',
    title: 'Tidak ada task aktif',
    description: 'Semua task sudah selesai atau belum ada task yang dibuat.',
    actionLabel: 'Buat Task Baru',
    actionHref: '#/tasks'
  },
  noProjects: {
    icon: 'fi fi-rr-folder',
    title: 'Belum ada project',
    description: 'Mulai project baru untuk mengorganisir kerja tim.',
    actionLabel: 'Buat Project',
    actionHref: '#/projects'
  },
  noAgents: {
    icon: 'fi fi-rr-user-robot',
    title: 'Belum ada agent terdaftar',
    description: 'Daftarkan profile agent pertama untuk memulai.',
    actionLabel: 'Register Agent',
    actionHref: '#/agents'
  },
  noActivities: {
    icon: 'fi fi-rr-history',
    title: 'Belum ada aktivitas',
    description: 'Aktivitas akan muncul di sini saat agent mulai bekerja.',
    actionLabel: null
  },
  noApprovals: {
    icon: 'fi fi-rr-clipboard-check',
    title: 'Tidak ada persetujuan pending',
    description: 'Semua permintaan sudah ditindaklanjuti.',
    actionLabel: null
  },
  noDeliverables: {
    icon: 'fi fi-rr-download',
    title: 'Belum ada deliverable',
    description: 'Hasil kerja agent akan tersedia di sini setelah task selesai.',
    actionLabel: null
  },
  noSearchResults: {
    icon: 'fi fi-rr-search',
    title: 'Tidak ada hasil',
    description: 'Coba ubah kata kunci atau filter pencarian.',
    actionLabel: null
  },
  generic: {
    icon: 'fi fi-rr-inbox',
    title: 'Tidak ada data',
    description: 'Belum ada item yang tersedia.',
    actionLabel: null
  }
};

export default EmptyState;