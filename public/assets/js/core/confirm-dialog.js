/**
 * Confirmation Dialog Component
 * DaisyUI-based confirmation dialog for high-risk actions
 */

export class ConfirmDialog {
  constructor(options = {}) {
    this.title = options.title || 'Konfirmasi Tindakan';
    this.message = options.message || 'Apakah Anda yakin ingin melanjutkan?';
    this.confirmLabel = options.confirmLabel || 'Ya, Lanjutkan';
    this.cancelLabel = options.cancelLabel || 'Batal';
    this.confirmType = options.confirmType || 'error'; // success, error, warning, info
    this.onConfirm = options.onConfirm || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this.dialogId = options.dialogId || 'confirm-dialog';
  }

  render() {
    return `
      <dialog id="${this.dialogId}" class="modal modal-bottom sm:modal-middle">
        <div class="modal-box bg-base-200 border border-base-content/10 text-base-content">
          <h3 class="font-bold text-lg text-base-content mb-4 flex items-center gap-2">
            <i class="fi fi-rr-warning-triangle text-warning text-xl"></i>
            ${this.title}
          </h3>
          <p class="text-base-content/80 mb-6">${this.message}</p>
          <div class="modal-action flex justify-end gap-3">
            <button class="btn btn-ghost btn-sm" id="${this.dialogId}-cancel">${this.cancelLabel}</button>
            <button class="btn btn-${this.confirmType} btn-sm gap-2 shadow" id="${this.dialogId}-confirm">
              ${this.confirmLabel}
            </button>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    `;
  }

  show(container) {
    // Remove existing dialog if any
    const existing = document.getElementById(this.dialogId);
    if (existing) existing.remove();

    container.insertAdjacentHTML('beforeend', this.render());

    const dialog = document.getElementById(this.dialogId);
    const cancelBtn = document.getElementById(`${this.dialogId}-cancel`);
    const confirmBtn = document.getElementById(`${this.dialogId}-confirm`);

    const cleanup = () => {
      dialog?.close();
      cancelBtn?.removeEventListener('click', cleanup);
      confirmBtn?.removeEventListener('click', handleConfirm);
      dialog?.remove();
    };

    const handleConfirm = () => {
      this.onConfirm();
      cleanup();
    };

    cancelBtn?.addEventListener('click', cleanup);
    confirmBtn?.addEventListener('click', handleConfirm);

    dialog?.showModal();
  }

  static async ask(options) {
    return new Promise((resolve) => {
      const dialog = new ConfirmDialog({
        ...options,
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false)
      });
      dialog.show(document.body);
    });
  }
}

export default ConfirmDialog;