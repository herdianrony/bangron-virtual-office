export const ISO_COS = 0.8660254; // cos(30 deg)
export const ISO_SIN = 0.5;       // sin(30 deg)

export class IsometricProjection {
  constructor(tileWidth = 64, tileHeight = 32) {
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight;
  }

  /**
   * Projects 3D / 2.5D world coordinates (x, y, z) into 2D SVG screen space (screenX, screenY).
   */
  toScreen(x, y, z = 0) {
    const screenX = (x - y) * ISO_COS;
    const screenY = (x + y) * ISO_SIN - z;
    return { x: screenX, y: screenY };
  }

  /**
   * Converts 2D screen coordinates back into isometric ground coordinates (x, y) assuming z = 0.
   */
  toIsometric(screenX, screenY) {
    const y = (screenY / ISO_SIN - screenX / ISO_COS) / 2;
    const x = (screenX / ISO_COS + screenY / ISO_SIN) / 2;
    return { x, y };
  }

  /**
   * Generates SVG path string for an isometric tile or room floor polygon.
   */
  getIsoPolygonPath(originX, originY, width, height) {
    const p1 = this.toScreen(originX, originY);
    const p2 = this.toScreen(originX + width, originY);
    const p3 = this.toScreen(originX + width, originY + height);
    const p4 = this.toScreen(originX, originY + height);

    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${p3.x} ${p3.y} L ${p4.x} ${p4.y} Z`;
  }
}

export const iso = new IsometricProjection();
export default iso;
