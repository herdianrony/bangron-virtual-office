import { describe, it, expect } from 'vitest';
import { VISUAL_BOUNDS, VISUAL_ROOMS, mapToVisual, findCanonicalRoom } from '../../public/assets/js/office/visual-layout.js';

describe('Studio Loft visual layout adapter', () => {
  const rooms = [
    { id: 'room_dev', position_x: 30, position_y: 340, width: 160, height: 140, name: 'Development Room' },
    { id: 'room_dir', position_x: 30, position_y: 40, width: 220, height: 255, name: 'Director Office' }
  ];

  it('maps canonical room coordinates into redesigned room rectangles', () => {
    const p = mapToVisual(110, 410, rooms);
    expect(p.roomId).toBe('room_dev');
    expect(p.x).toBeGreaterThan(VISUAL_ROOMS.room_dev.x);
    expect(p.y).toBeGreaterThan(VISUAL_ROOMS.room_dev.y);
    expect(p.x).toBeLessThan(VISUAL_ROOMS.room_dev.x + VISUAL_ROOMS.room_dev.w);
  });

  it('keeps distinct rooms distinct after mapping', () => {
    const a = mapToVisual(110, 410, rooms);
    const b = mapToVisual(140, 160, rooms);
    expect(a.roomId).toBe('room_dev');
    expect(b.roomId).toBe('room_dir');
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(100);
  });

  it('falls back to linear scaling for corridor points', () => {
    const p = mapToVisual(500, 300, rooms);
    expect(p.roomId).toBeNull();
    expect(p.x).toBeGreaterThan(VISUAL_BOUNDS.x);
  });

  it('finds canonical room by point', () => {
    expect(findCanonicalRoom(110, 410, rooms)?.id).toBe('room_dev');
    expect(findCanonicalRoom(9999, 9999, rooms)).toBeNull();
  });
});
