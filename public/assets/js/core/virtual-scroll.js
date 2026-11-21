/**
 * Virtual Scroll - Render only visible items for long lists (100+ agents/tasks)
 * Maintains scroll position, supports dynamic item heights
 */

export class VirtualScroll {
  constructor(options = {}) {
    this.container = options.container;
    this.itemHeight = options.itemHeight || 64; // px per item
    this.overscan = options.overscan || 5; // items to render beyond viewport
    this.data = options.data || [];
    this.renderItem = options.renderItem || ((item, index) => `<div>${item}</div>`);
    this.onScroll = options.onScroll || (() => {});
    
    this.startIndex = 0;
    this.endIndex = 0;
    this.scrollTop = 0;
    this.frameId = null;
    
    this.init();
  }

  init() {
    if (!this.container) return;
    
    this.container.style.position = 'relative';
    this.container.style.overflowY = 'auto';
    
    // Create scroll spacer (full height of all items)
    this.spacer = document.createElement('div');
    this.spacer.style.height = `${this.data.length * this.itemHeight}px`;
    this.spacer.style.width = '100%';
    this.container.appendChild(this.spacer);
    
    // Create viewport wrapper
    this.viewport = document.createElement('div');
    this.viewport.style.position = 'absolute';
    this.viewport.style.top = '0';
    this.viewport.style.left = '0';
    this.viewport.style.width = '100%';
    this.container.appendChild(this.viewport);
    
    // Bind scroll with throttle
    this.container.addEventListener('scroll', this.throttle(this.handleScroll.bind(this), 16));
    
    // Initial render
    this.update();
  }

  throttle(fn, limit) {
    let inThrottle;
    return (...args) => {
      if (!inThrottle) {
        fn.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  handleScroll() {
    this.scrollTop = this.container.scrollTop;
    this.cancelAnimationFrame();
    this.frameId = requestAnimationFrame(() => this.update());
    this.onScroll(this.scrollTop);
  }

  cancelAnimationFrame() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  update() {
    if (!this.container || !this.data.length) return;

    const containerHeight = this.container.clientHeight;
    const start = Math.floor(this.scrollTop / this.itemHeight);
    const end = Math.min(
      start + Math.ceil(containerHeight / this.itemHeight) + this.overscan,
      this.data.length - 1
    );
    
    const startIndex = Math.max(0, start - this.overscan);
    const endIndex = end;

    // Only re-render if visible range changed significantly
    if (startIndex === this.startIndex && endIndex === this.endIndex) return;
    
    this.startIndex = startIndex;
    this.endIndex = endIndex;

    // Calculate offset for items before visible range
    const offsetY = startIndex * this.itemHeight;
    
    this.viewport.style.transform = `translateY(${offsetY}px)`;
    
    const visibleItems = this.data.slice(startIndex, endIndex + 1);
    
    this.viewport.innerHTML = visibleItems.map((item, i) => {
      const globalIndex = startIndex + i;
      return `
        <div style="
          position: absolute;
          top: ${globalIndex * this.itemHeight}px;
          left: 0;
          width: 100%;
          height: ${this.itemHeight}px;
          box-sizing: border-box;
        " data-virtual-index="${globalIndex}">
          ${this.renderItem(item, globalIndex)}
        </div>
      `;
    }).join('');
  }

  setData(newData) {
    this.data = newData;
    this.spacer.style.height = `${this.data.length * this.itemHeight}px`;
    this.scrollTop = 0;
    this.container.scrollTop = 0;
    this.update();
  }

  setItemHeight(height) {
    this.itemHeight = height;
    this.spacer.style.height = `${this.data.length * this.itemHeight}px`;
    this.update();
  }

  scrollToIndex(index) {
    if (!this.container) return;
    const targetTop = index * this.itemHeight;
    this.container.scrollTop = targetTop;
    this.scrollTop = targetTop;
    this.update();
  }

  destroy() {
    this.cancelAnimationFrame();
    this.container.removeEventListener('scroll', this.handleScroll);
    if (this.spacer) this.spacer.remove();
    if (this.viewport) this.viewport.remove();
  }
}

export default VirtualScroll;