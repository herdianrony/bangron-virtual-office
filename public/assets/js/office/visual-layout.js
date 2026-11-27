/**
 * Bangron Virtual Office — "Rumah Studio Kantor Terpadu" floor plan.
 *
 * Diadaptasi dari denah referensi: carport & parkir motor di selatan, lobby
 * masuk + ruang meeting + 2 toilet di timur, pantry & area kopi di utara,
 * area kerja open-space dengan dua cluster meja di barat, taman di kiri atas.
 *
 * Koordinat kanonik backend tetap source of truth untuk navigasi & agen;
 * modul ini hanya adapter visual.
 */

export const VISUAL_BOUNDS = { x: 16, y: 16, w: 980, h: 1180 };

// Zona arsitektural (bukan ruang kanonik) — digambar sebagai dekorasi scene.
export const VISUAL_ZONES = [
  { id: 'carport', label: 'CARPORT & PARKIR MOTOR', x: 40, y: 930, w: 900, h: 240, accent: '#64748b' },
  { id: 'lobby', label: 'LOBBY MASUK', x: 690, y: 700, w: 250, h: 210, accent: '#0ea5e9' },
  { id: 'toilet', label: '2 TOILET KANTOR', x: 690, y: 70, w: 250, h: 250, accent: '#94a3b8' },
  { id: 'pantry', label: 'PANTRY & AREA KOPI', x: 440, y: 180, w: 240, h: 220, accent: '#a16207' },
  { id: 'open', label: 'AREA KERJA OPEN-SPACE', x: 40, y: 200, w: 390, h: 690, accent: '#b45309' }
];

// 14 ruang kanonik dipetakan ke zona denah (id backend tetap sama).
export const VISUAL_ROOMS = {
  room_dir:       { x: 40,  y: 40,  w: 250, h: 140, accent: '#65a30d', label: 'TAMAN', sub: 'Area Hijau' },
  room_meeting:   { x: 690, y: 400, w: 250, h: 290, accent: '#0891b2', label: 'RUANG MEETING', sub: '8 Kursi' },
  room_ops:       { x: 440, y: 40,  w: 240, h: 130, accent: '#a16207', label: 'PANTRY', sub: 'Area Kopi' },
  room_uiux:      { x: 40,  y: 200, w: 190, h: 165, accent: '#d97706', label: 'CLUSTER A', sub: 'Open Space' },
  room_qa:        { x: 240, y: 200, w: 190, h: 165, accent: '#ca8a04', label: 'CLUSTER B', sub: 'Open Space' },
  room_dev:       { x: 40,  y: 375, w: 190, h: 165, accent: '#16a34a', label: 'GARASI KODING', sub: 'Engineering' },
  room_research:  { x: 240, y: 375, w: 190, h: 165, accent: '#7c3aed', label: 'RAK RISET', sub: 'Research' },
  room_marketing: { x: 40,  y: 550, w: 190, h: 165, accent: '#ea580c', label: 'SUDUT KONTEN', sub: 'Marketing' },
  room_library:   { x: 240, y: 550, w: 190, h: 165, accent: '#0f766e', label: 'PERPUSTAKAAN', sub: 'Referensi' },
  room_coffee:    { x: 440, y: 180, w: 240, h: 220, accent: '#b45309', label: 'PANTRY & KOPI', sub: 'Pantry' },
  room_lounge:    { x: 40,  y: 725, w: 190, h: 195, accent: '#db2777', label: 'SOFA SANTA', sub: 'Istirahat' },
  room_creative:  { x: 240, y: 725, w: 190, h: 195, accent: '#9333ea', label: 'STUDIO KREATIF', sub: 'Desain' },
  room_reception: { x: 690, y: 700, w: 250, h: 210, accent: '#0284c7', label: 'LOBBY MASUK', sub: 'Pintu Utama' },
  room_server:    { x: 690, y: 70,  w: 250, h: 250, accent: '#475569', label: 'SERVER & TOILET', sub: 'Infrastructure' }
};

export const VISUAL_CORRIDORS = [
  { id: 'corr_main', x: 40, y: 355, w: 900, h: 18 },
  { id: 'corr_south', x: 40, y: 905, w: 900, h: 18 },
  { id: 'corr_cross', x: 430, y: 40, w: 18, h: 880 }
];

export const VISUAL_THEME = {
  floor: 0xf1ede3,
  grid: 0xe2ddd0,
  corridor: 0xd8d2c4,
  wall: 0x334155,
  night: 0x0b1220
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

export default { VISUAL_BOUNDS, VISUAL_ROOMS, VISUAL_ZONES, VISUAL_CORRIDORS, VISUAL_THEME, mapToVisual, findCanonicalRoom };
