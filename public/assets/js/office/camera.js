import { store } from '../core/store.js';

export class CameraController {
  constructor(svgElement, viewportGroup, projection = null) {
    this.svg = svgElement;
    this.viewport = viewportGroup;
    this.projection = projection;
    /** Optional hook: fired on every viewport transform change (Pixi layer sync). */
    this.onTransformChange = null;

    this.panX = 0;
    this.panY = 0; // Top-down camera starts with no vertical offset
    this.scale = 1.0;
    this.minScale = 0.12;
    this.maxScale = 2.4;

    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;

    // Time-based lerp state
    this.lastTime = null;
    this.lerpSpeed = 6.0; // units per second (smoothness factor)

    this.initEvents();
    this.updateTransform();
  }

  initEvents() {
    this.svg.addEventListener('mousedown', (e) => {
      // Don't drag if clicking an agent or button
      if (e.target.closest('.agent-avatar-node')) return;
      this.isDragging = true;
      this.startX = e.clientX - this.panX;
      this.startY = e.clientY - this.panY;
      store.setState({ followAgentId: null }); // Stop following on manual drag
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      this.panX = e.clientX - this.startX;
      this.panY = e.clientY - this.startY;
      this.updateTransform();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom(zoomFactor, e.clientX, e.clientY);
    }, { passive: false });
  }

  zoom(factor, clientX = null, clientY = null) {
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    if (newScale === this.scale) return;

    if (clientX !== null && clientY !== null) {
      const rect = this.svg.getBoundingClientRect();
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;

      this.panX = mouseX - (mouseX - this.panX) * (newScale / this.scale);
      this.panY = mouseY - (mouseY - this.panY) * (newScale / this.scale);
    }

    this.scale = newScale;
    this.updateTransform();
  }

  /** Swap the world->screen projection (kept for API compat; top-down only). */
  setProjection(projection) {
    this.projection = projection || null;
  }

  /** Zoom & pan so the given world-space bounds fit the viewport. */
  fitBounds(bounds, fillRatio = 0.98) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ribbonInset = 48; // ruang untuk demo ribbon di atas
    const usableH = Math.max(120, rect.height - ribbonInset);
    const scale = Math.max(
      this.minScale,
      Math.min(this.maxScale, Math.min(rect.width / bounds.w, usableH / bounds.h) * fillRatio)
    );
    this.scale = scale;
    const hudInset = rect.width >= 1024 ? 90 : 0;
    this.panX = (rect.width - hudInset) / 2 - (bounds.x + bounds.w / 2) * scale;
    this.panY = ribbonInset + usableH / 2 - (bounds.y + bounds.h / 2) * scale;
    this.updateTransform();
  }

  zoomIn() {
    this.zoom(1.2);
  }

  zoomOut() {
    this.zoom(0.8);
  }

  reset() {
    store.setState({ followAgentId: null });
    const bounds = this.svg.getBoundingClientRect();
    this.panX = bounds.width / 2;
    this.panY = bounds.height / 2;
    this.scale = 1.0;
    this.updateTransform();
  }

  centerOn(x, y, z = 0) {
    const screenPos = this.projection
      ? this.projection.toScreen(x, y, z)
      : { x, y };
    const rect = this.svg.getBoundingClientRect();
    this.panX = rect.width / 2 - screenPos.x * this.scale;
    this.panY = rect.height / 2 - screenPos.y * this.scale;
    this.updateTransform();
  }

  updateFollow(agents, dt = 1 / 60) {
    const followId = store.state.followAgentId;
    if (!followId) return;

    const agent = agents.find((a) => a.id === followId);
    if (agent) {
      const screenPos = this.projection
        ? this.projection.toScreen(agent.x, agent.y, 0)
        : { x: agent.x, y: agent.y };
      const rect = this.svg.getBoundingClientRect();
      const targetPanX = rect.width / 2 - screenPos.x * this.scale;
      const targetPanY = rect.height / 2 - screenPos.y * this.scale;

      // Time-based lerp: exponential decay independent of frame rate
      // alpha = 1 - e^(-speed * dt) gives consistent smoothing at any FPS
      const alpha = 1 - Math.exp(-this.lerpSpeed * dt);
      this.panX += (targetPanX - this.panX) * alpha;
      this.panY += (targetPanY - this.panY) * alpha;
      this.updateTransform();
    }
  }

  updateTransform() {
    if (this.viewport) {
      this.viewport.setAttribute(
        'transform',
        `translate(${this.panX}, ${this.panY}) scale(${this.scale})`
      );
    }
    if (this.onTransformChange) {
      this.onTransformChange({ panX: this.panX, panY: this.panY, scale: this.scale });
    }
  }
}

export default CameraController;
