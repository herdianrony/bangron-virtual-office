import { describe, it, expect } from 'vitest';
import { doorPoint } from '../../public/assets/js/office/pixi-office-scene.js';

describe('PixiOfficeScene geometry', () => {
  it('computes door midpoint for each side', () => {
    const room = { position_x: 100, position_y: 200, width: 80, height: 60 };
    expect(doorPoint({ ...room, door: { side: 'S' } })).toEqual({ x: 140, y: 260 });
    expect(doorPoint({ ...room, door: { side: 'N' } })).toEqual({ x: 140, y: 200 });
    expect(doorPoint({ ...room, door: { side: 'W' } })).toEqual({ x: 100, y: 230 });
    expect(doorPoint({ ...room, door: { side: 'E' } })).toEqual({ x: 180, y: 230 });
  });

  it('defaults to south door when metadata is missing', () => {
    expect(doorPoint({ px: 10, py: 20, w: 40, h: 30 })).toEqual({ x: 30, y: 50 });
  });
});
