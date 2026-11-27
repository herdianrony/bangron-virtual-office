/**
 * Bangron Virtual Office — redesigned visual floor plan ("Studio Loft").
 *
 * Backend `office-layout.js` tetap menjadi source of truth untuk navigasi,
 * pintu, dan koordinat agen. Modul ini hanya memetakan ruang kanonik ke
 * geometri visual baru, sehingga desain bisa diimprovisasi bebas tanpa
 * mengubah state/pathfinding/demo engine.
 */

export const VISUAL_BOUNDS = { x: 16, y: 16, w: 1148, h: 748 };

export const VISUAL_ROOMS = {
  room_dir:       { x: 40,  y: 40,  w: 250, h: 268, accent: '#eab308', icon: 'fi-rr-crown' },
  room_meeting:   { x: 300, y: 40,  w: 230, h: 268, accent: '#3b82f6', icon: 'fi-rr-comments' },
  room_ops:       { x: 620, y: 40,  w: 240, h: 268, accent: '#6366f1', icon: 'fi-rr-orbit' },
  room_uiux:      { x: 870, y: 40,  w: 210, h: 124, accent: '#06b6d4', icon: 'fi-rr-palette' },
  room_qa:        { x: 870, y: 176, w: 210, h: 132, accent: '#f59e0b', icon: 'fi-rr-shield-check' },

  room_dev:       { x: 40,  y: 398, w: 220, h: 166, accent: '#10b981', icon: 'fi-rr-code-branch' },
  room_research:  { x: 270, y: 398, w: 130, h: 166, accent: '#8b5cf6', icon: 'fi-rr-search-alt' },
  room_marketing: { x: 410, y: 398, w: 120, h: 166, accent: '#f97316', icon: 'fi-rr-bullhorn' },
  room_library:   { x: 620, y: 398, w: 230, h: 166, accent: '#14b8a6', icon: 'fi-rr-book-open' },
  room_coffee:    { x: 860, y: 398, w: 220, h: 166, accent: '#d97706', icon: 'fi-rr-coffee' },

  room_lounge:    { x: 40,  y: 584, w: 250, h: 158, accent: '#ec4899', icon: 'fi-rr-couch' },
  room_creative:  { x: 300, y: 584, w: 230, h: 158, accent: '#a855f7', icon: 'fi-rr-palette' },
  room_reception: { x: 620, y: 584, w: 230, h: 158, accent: '#0ea5e9', icon: 'fi-rr-door-open' },
  room_server:    { x: 860, y: 584, w: 220, h: 158, accent: '#64748b', icon: 'fi-rr-server' }
};

export const VISUAL_CORRIDORS = [
  { id: 'corr_main', x: 40, y: 320, w: 1040, h: 62 },
  { id: 'corr_south', x: 40, y: 566, w: 1040, h: 18 },
  { id: 'corr_cross', x: 542, y: 40, w: 62, h: 702 }
];

/** rooms: canonical backend rooms. x/y: canonical world coords. */
export function findCanonicalRoom(x, y, rooms = []) {
  return rooms.find((r) => {
    const px = Number(r.position_x); const py = Number(r.position_y);
    const w = Number(r.width); const h = Number(r.height);
    return [px, py, w, h].every(Number.isFinite) &&
      x >= px && x <= px + w && y >= py && y <= py + h;
  }) || null;
}

/**
 * Map a canonical world point into the redesigned visual plan.
 * Positions inside a room are mapped proportionally into that room's new
 * rectangle; corridor points are scaled linearly across the whole building.
 */
export function mapToVisual(x, y, rooms = [], bounds = null) {
  const room = findCanonicalRoom(x, y, rooms);
  if (room && VISUAL_ROOMS[room.id]) {
    const v = VISUAL_ROOMS[room.id];
    const px = Number(room.position_x), py = Number(room.position_y);
    const w = Number(room.width) || 1, h = Number(room.height) || 1;
    return {
      x: v.x + ((x - px) / w) * v.w,
      y: v.y + ((y - py) / h) * v.h,
      roomId: room.id
    };
  }
  const b = bounds || { x: 14, y: 14, w: 992, h: 668 };
  return {
    x: VISUAL_BOUNDS.x + 20 + ((x - b.x) / b.w) * (VISUAL_BOUNDS.w - 40),
    y: VISUAL_BOUNDS.y + 20 + ((y - b.y) / b.h) * (VISUAL_BOUNDS.h - 40),
    roomId: null
  };
}

export default { VISUAL_BOUNDS, VISUAL_ROOMS, VISUAL_CORRIDORS, mapToVisual, findCanonicalRoom };
