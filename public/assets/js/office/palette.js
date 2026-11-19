/**
 * Shared visual palette for office agent rendering (SVG scene + Pixi layer).
 */

export const DEPARTMENT_COLORS = {
  Operations: '#3b82f6',
  Development: '#10b981',
  'UI/UX': '#06b6d4',
  'Creative Studio': '#ec4899',
  'Quality Assurance': '#f59e0b',
  Research: '#8b5cf6',
  Marketing: '#f97316',
  General: '#6b7280',
  Executive: '#eab308'
};

export const STATUS_HALO_COLORS = {
  working: '#3b82f6',
  thinking: '#8b5cf6',
  walking: '#38bdf8',
  collaborating: '#06b6d4',
  waiting: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  idle: '#6b7280',
  offline: '#374151'
};

/** Darken a hex color by a percentage (port of the mockup `sh()` helper). */
export function shade(hex, pc = 16) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round((v * (100 - pc)) / 100);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Parse a #rrggbb / rgb() color into a Pixi-compatible 0xRRGGBB number. */
export function colorToNumber(cssColor) {
  if (typeof cssColor === 'number') return cssColor;
  if (cssColor.startsWith('#')) return parseInt(cssColor.slice(1), 16);
  const m = cssColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (m) return (parseInt(m[1], 10) << 16) | (parseInt(m[2], 10) << 8) | parseInt(m[3], 10);
  return 0xffffff;
}

export default { DEPARTMENT_COLORS, STATUS_HALO_COLORS, shade, colorToNumber };
