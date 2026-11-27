export class ToastService {
  constructor() {
    this.container = null;
    this.toastCount = 0;
    this.maxVisible = 3;
    // Don't init container at construction - do it lazily
  }

  ensureContainer() {
    if (this.container) return this.container;
    if (typeof document === 'undefined') return null;
    if (document.getElementById('toast-root')) {
      this.container = document.getElementById('toast-root');
      this.container.className = 'fixed top-20 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm sm:max-w-md pointer-events-none';
      return this.container;
    }
    this.container = document.createElement('div');
    this.container.id = 'toast-root';
    this.container.className = 'fixed top-20 right-4 z-[100] flex flex-col gap-2 w-full max-w-sm sm:max-w-md pointer-events-none';
    document.body.appendChild(this.container);
    return this.container;
  }

  createToast(type, message, options = {}) {
    const { persistent = false, action = null, duration = 5000 } = options;

    const container = this.ensureContainer();
    if (!container) return null;

    const bgClass = {
      success: 'bg-success/90 text-success-content',
      error: 'bg-error/90 text-error-content',
      warning: 'bg-warning/90 text-warning-content',
      info: 'bg-info/90 text-info-content'
    }[type] || 'bg-base-200/90 text-base-content';

    const icon = {
      success: 'fi fi-rr-check-circle',
      error: 'fi fi-rr-cross-circle',
      warning: 'fi fi-rr-alert-triangle',
      info: 'fi fi-rr-info'
    }[type] || 'fi fi-rr-bell';

    const toast = document.createElement('div');
    toast.className = `alert ${bgClass} shadow-lg rounded-box border border-base-content/10 flex items-start gap-3 p-3 pointer-events-auto animate-slide-in`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', persistent ? 'assertive' : 'polite');

    toast.innerHTML = `
      <i class="${icon} text-lg flex-shrink-0 mt-0.5"></i>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium">${message}</div>
        ${action ? `<button class="btn btn-xs btn-ghost mt-2 text-xs" id="toast-action-${this.toastCount}">${action.label}</button>` : ''}
      </div>
      ${!persistent ? `<button class="btn btn-ghost btn-xs text-base-content/60 flex-shrink-0" aria-label="Dismiss"><i class="fi fi-rr-cross text-xs"></i></button>` : ''}
    `;

    const dismissBtn = toast.querySelector('[aria-label="Dismiss"]');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => this.dismiss(toast));
    }

    if (action) {
      const actionBtn = toast.querySelector(`#toast-action-${this.toastCount}`);
      actionBtn.addEventListener('click', () => {
        action.onClick?.();
        if (!persistent) this.dismiss(toast);
      });
    }

    container.appendChild(toast);
    this.toastCount++;

    this.enforceMaxVisible();

    if (!persistent && duration > 0) {
      setTimeout(() => this.dismiss(toast), duration);
    }

    return toast;
  }

  enforceMaxVisible() {
    const container = this.ensureContainer();
    if (!container) return;
    const toasts = Array.from(container.children);
    while (toasts.length > this.maxVisible) {
      this.dismiss(toasts.shift());
    }
  }

  dismiss(toast) {
    toast.classList.add('animate-fade-out', 'opacity-0', 'transition-opacity', 'duration-300');
    setTimeout(() => toast.remove(), 300);
  }

  clear() {
    const container = this.ensureContainer();
    if (!container) return;
    [...container.children].forEach((t) => this.dismiss(t));
  }

  success(message, options) { return this.createToast('success', message, options); }
  error(message, options) { return this.createToast('error', message, options); }
  warning(message, options) { return this.createToast('warning', message, options); }
  info(message, options) { return this.createToast('info', message, options); }
}

export const toast = new ToastService();
export default toast;

// Convenience named export for views that import showToast directly
export function showToast(type, message, options = {}) {
  return toast.createToast(type, message, options);
}