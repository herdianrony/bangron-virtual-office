import { store } from '../core/store.js';

export class CameraController {
  constructor(svgElement, viewportGroup, projection = null) {
    this.svg = svgElement;
    this.viewport = viewportGroup;
    this.projection = projection;
    /** Optional hook: fired on every viewport transform change (Pixi layer sync). */
    this.onTransformChange = null;

    this.panX = 0;
    this.panY = 160; // Initial nice isometric tilt center
    this.scale = 1.0;
    this.minScale = 0.4;
    this.maxScale = 2.4;

    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;

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
  fitBounds(bounds, fillRatio = 0.92) {
    const rect = this.svg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const scale = Math.max(
      this.minScale,
      Math.min(this.maxScale, Math.min(rect.width / bounds.w, rect.height / bounds.h) * fillRatio)
    );
    this.scale = scale;
    this.panX = rect.width / 2 - (bounds.x + bounds.w / 2) * scale;
    this.panY = rect.height / 2 - (bounds.y + bounds.h / 2) * scale;
    this.updateTransform();
  }

  zoomIn() {
    this.zoom(1.2);
  }

  zoomOut() {
    this.zoom(0.8);
  }

  reset() {
    this.panX = window.innerWidth / 2 - 100;
    this.panY = 220;
    this.scale = 1.0;
    store.setState({ followAgentId: null });
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

  updateFollow(agents) {
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

      // Smooth lerp
      this.panX += (targetPanX - this.panX) * 0.1;
      this.panY += (targetPanY - this.panY) * 0.1;
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
