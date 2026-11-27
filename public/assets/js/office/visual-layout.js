/**
 * Bangron Virtual Office — "Rumah Studio" visual floor plan.
 *
 * Rumah rintilan yang dipakai sebagai studio: garasi koding, dapur kopi,
 * ruang keluarga, meja makan, sudut desain, teras depan, rak server.
 *
 * Backend `office-layout.js` tetap source of truth untuk navigasi, pintu, dan
 * koordinat agen. Modul ini hanya memetakan ruang kanonik ke geometri visual,
 * sehingga desain bebas tanpa mengubah state/pathfinding/demo engine.
 */

export const VISUAL_BOUNDS = { x: 16, y: 16, w: 1148, h: 748 };

export const VISUAL_ROOMS = {
  room_dir:       { x: 40,  y: 40,  w: 230, h: 220, accent: '#b45309', label: 'Ruang Kerja', sub: 'Studio Direktur' },
  room_meeting:   { x: 280, y: 40,  w: 250, h: 220, accent: '#0d9488', label: 'Meja Makan', sub: 'Diskusi Tim' },
  room_ops:       { x: 540, y: 40,  w: 270, h: 220, accent: '#c2410c', label: 'Ruang Keluarga', sub: 'Orkestrasi' },
  room_uiux:      { x: 820, y: 40,  w: 160, h: 104, accent: '#0891b2', label: 'Sudut Desain', sub: 'UI/UX' },
  room_qa:        { x: 820, y: 156, w: 160, h: 104, accent: '#ca8a04', label: 'Rak Uji', sub: 'QA & Security' },
  room_dev:       { x: 40,  y: 272, w: 250, h: 180, accent: '#16a34a', label: 'Garasi Koding', sub: 'Backend + Frontend' },
  room_research:  { x: 300, y: 272, w: 150, h: 180, accent: '#7c3aed', label: 'Rak Riset', sub: 'Research' },
  room_marketing: { x: 460, y: 272, w: 150, h: 180, accent: '#ea580c', label: 'Sudut Konten', sub: 'Marketing' },
  room_library:   { x: 620, y: 272, w: 220, h: 180, accent: '#0f766e', label: 'Perpustakaan', sub: 'Buku & Referensi' },
  room_coffee:    { x: 850, y: 272, w: 230, h: 180, accent: '#a16207', label: 'Dapur & Kopi', sub: 'Pantry' },
  room_lounge:    { x: 40,  y: 464, w: 250, h: 170, accent: '#db2777', label: 'Sofa Santai', sub: 'Istirahat' },
  room_creative:  { x: 300, y: 464, w: 250, h: 170, accent: '#9333ea', label: 'Studio Kreatif', sub: 'Brand & Visual' },
  room_reception: { x: 560, y: 464, w: 230, h: 170, accent: '#0284c7', label: 'Teras Depan', sub: 'Pintu Masuk' },
  room_server:    { x: 800, y: 464, w: 280, h: 170, accent: '#475569', label: 'Rak Server', sub: 'Infrastructure' }
};

export const VISUAL_CORRIDORS = [
  { id: 'corr_main', x: 40, y: 262, w: 1040, h: 10 },
  { id: 'corr_south', x: 40, y: 454, w: 1040, h: 10 },
  { id: 'corr_cross', x: 520, y: 40, w: 12, h: 594 }
];

export const VISUAL_THEME = {
  floor: 0x2a1c16,
  grid: 0x3d2a20,
  corridor: 0x6b4f35,
  wall: 0x8b6b4a,
  night: 0x120c08
};

export function findCanonicalRoom(x, y, rooms = []) {
  return rooms.find((r) => {
    const px = Number(r.position_x); const py = Number(r.position_y);
    const w = Number(r.width); const h = Number(r.height);
    return [px, py, w, h].every(Number.isFinite) &&
      x >= px && x <= px + w && y >= py && y <= py + h;
  }) || null;
}

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

export default { VISUAL_BOUNDS, VISUAL_ROOMS, VISUAL_CORRIDORS, VISUAL_THEME, mapToVisual, findCanonicalRoom };
