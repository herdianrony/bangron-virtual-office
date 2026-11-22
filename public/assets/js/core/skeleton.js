/**
 * Skeleton Loader Components for DaisyUI
 * Provides consistent loading states across all views
 */

export class SkeletonLoader {
  static skeletonRow(cols = 4) {
    return `
      <div class="loading loading-row">
        ${Array(cols).fill('<td></td>').join('')}
      </div>
    `.repeat(3);
  }

  static skeletonCard() {
    return `
      <div class="card bg-base-200 border border-base-content/10 shadow-lg">
        <div class="card-body">
          <div class="loading loading-bar h-4 w-3/4 mb-3"></div>
          <div class="loading loading-bar h-4 w-1/2 mb-2"></div>
          <div class="loading loading-bar h-4 w-1/3"></div>
        </div>
      </div>
    `.repeat(3);
  }

  static skeletonStat() {
    return `
      <div class="stat">
        <div class="stat-value loading loading-bar h-10 w-24"></div>
        <div class="stat-desc loading loading-bar h-4 w-20"></div>
      </div>
    `.repeat(4);
  }

  static skeletonTable(cols = 5, rows = 5) {
    const header = `<tr>${Array(cols).fill('<th class="loading loading-bar h-4 w-full"></th>').join('')}</tr>`;
    const body = Array(rows).fill(
      `<tr>${Array(cols).fill('<td class="loading loading-bar h-4 w-full"></td>').join('')}</tr>`
    ).join('');
    return `
      <table class="table w-full">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }

  static skeletonList(items = 5) {
    return Array(items).fill(`
      <div class="join-item">
        <div class="loading loading-bar h-5 w-1/3 mb-1"></div>
        <div class="loading loading-bar h-4 w-1/2"></div>
      </div>
    `).join('');
  }

  static show(container, type, options = {}) {
    const { cols = 4, rows = 5, minDuration = 1500 } = options;
    let html = '';

    switch (type) {
      case 'table':
        html = this.skeletonTable(cols, rows);
        break;
      case 'cards':
        html = this.skeletonCard();
        break;
      case 'stats':
        html = this.skeletonStat();
        break;
      case 'list':
        html = this.skeletonList(rows);
        break;
      default:
        html = this.skeletonTable(cols, rows);
    }

    container.innerHTML = html;

    return new Promise((resolve) => {
      setTimeout(resolve, minDuration);
    });
  }

  static hide(container) {
    container.innerHTML = '';
  }
}

export default SkeletonLoader;