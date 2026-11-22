import { describe, it, expect } from 'vitest';
import { topdownRenderer } from '../../public/assets/js/office/topdown-renderer.js';

/**
 * SVG Attribute Validation — Regression tests for malformed SVG attributes.
 *
 * Root cause: renderFurnitureHitTest destructured `width`/`height` from
 * workstation objects, but the /api/virtual-office/state contract does NOT
 * include width/height on workstations (only position_x, position_y,
 * capacity, workstation_type). This produced SVG attributes like
 * width="undefined" / height="undefined", causing the browser error:
 *   Expected length, "undefined"
 *
 * Fix: Derive hit areas from per-type furniture geometry with safe numeric
 * defaults instead of relying on absent width/height fields.
 */
describe('SVG attribute validation — furniture hit-test layer', () => {
  const workstationsWithoutDimensions = [
    {
      id: 'ws_test_desk',
      name: 'Test Desk',
      position_x: 100,
      position_y: 200,
      workstation_type: 'desk',
      capacity: 1,
      status: 'available'
    },
    {
      id: 'ws_test_terminal',
      name: 'Server Terminal',
      position_x: 300,
      position_y: 400,
      workstation_type: 'terminal',
      capacity: 1,
      status: 'occupied'
    },
    {
      id: 'ws_test_conference',
      name: 'Conference Table',
      position_x: 500,
      position_y: 600,
      workstation_type: 'conference_table',
      capacity: 4,
      status: 'available'
    },
    {
      id: 'ws_test_couch',
      name: 'Lounge Sofa',
      position_x: 700,
      position_y: 800,
      workstation_type: 'couch',
      capacity: 2,
      status: 'available'
    },
    {
      id: 'ws_test_command_pod',
      name: 'Command Pod',
      position_x: 900,
      position_y: 1000,
      workstation_type: 'command_pod',
      capacity: 1,
      status: 'available'
    },
    {
      id: 'ws_test_unknown_type',
      name: 'Unknown Type',
      position_x: 1100,
      position_y: 1200,
      workstation_type: 'nonexistent_type',
      capacity: 1,
      status: 'available'
    },
    {
      id: 'ws_test_null_coords',
      name: 'Null Coords',
      position_x: null,
      position_y: null,
      workstation_type: 'desk',
      capacity: 1,
      status: 'available'
    }
  ];

  it('never emits SVG width/height="undefined" for any workstation type', () => {
    const html = topdownRenderer.renderFurnitureHitTest(workstationsWithoutDimensions);

    // Every rect must have numeric width and height attributes
    const rectMatches = html.matchAll(/<rect[^>]*>/g);
    for (const match of rectMatches) {
      const rectTag = match[0];

      // Extract width attribute
      const widthMatch = rectTag.match(/width="([^"]*)"/);
      expect(widthMatch, `rect tag missing width attribute: ${rectTag}`).toBeTruthy();
      const widthVal = widthMatch[1];
      expect(widthVal, `width is undefined/empty in: ${rectTag}`).not.toBe('undefined');
      expect(widthVal, `width is empty in: ${rectTag}`).not.toBe('');
      expect(Number.isFinite(Number(widthVal)), `width is not a finite number: ${widthVal} in ${rectTag}`).toBe(true);
      expect(Number(widthVal), `width is non-positive: ${widthVal} in ${rectTag}`).toBeGreaterThan(0);

      // Extract height attribute
      const heightMatch = rectTag.match(/height="([^"]*)"/);
      expect(heightMatch, `rect tag missing height attribute: ${rectTag}`).toBeTruthy();
      const heightVal = heightMatch[1];
      expect(heightVal, `height is undefined/empty in: ${rectTag}`).not.toBe('undefined');
      expect(heightVal, `height is empty in: ${rectTag}`).not.toBe('');
      expect(Number.isFinite(Number(heightVal)), `height is not a finite number: ${heightVal} in ${rectTag}`).toBe(true);
      expect(Number(heightVal), `height is non-positive: ${heightVal} in ${rectTag}`).toBeGreaterThan(0);

      // Extract x attribute
      const xMatch = rectTag.match(/x="([^"]*)"/);
      expect(xMatch, `rect tag missing x attribute: ${rectTag}`).toBeTruthy();
      expect(Number.isFinite(Number(xMatch[1])), `x is not a finite number: ${xMatch[1]} in ${rectTag}`).toBe(true);

      // Extract y attribute
      const yMatch = rectTag.match(/y="([^"]*)"/);
      expect(yMatch, `rect tag missing y attribute: ${rectTag}`).toBeTruthy();
      expect(Number.isFinite(Number(yMatch[1])), `y is not a finite number: ${yMatch[1]} in ${rectTag}`).toBe(true);
    }
  });

  it('derives hit areas from per-type furniture geometry', () => {
    const html = topdownRenderer.renderFurnitureHitTest(workstationsWithoutDimensions);

    // Desk: default w=44, h=26, centered on position
    expect(html).toContain('width="44"');
    expect(html).toContain('height="26"');

    // Terminal: w=26, h=46
    expect(html).toContain('width="26"');
    expect(html).toContain('height="46"');

    // Conference table: w=92, h=52
    expect(html).toContain('width="92"');
    expect(html).toContain('height="52"');

    // Couch: w=56, h=26
    expect(html).toContain('width="56"');
    expect(html).toContain('height="26"');

    // Command pod: w=40, h=40
    expect(html).toContain('width="40"');
    expect(html).toContain('height="40"');
  });

  it('handles null coordinates safely (falls back to 0)', () => {
    const html = topdownRenderer.renderFurnitureHitTest([
      {
        id: 'ws_null_coords',
        name: 'Null Coords',
        position_x: null,
        position_y: null,
        workstation_type: 'desk',
        capacity: 1,
        status: 'available'
      }
    ]);

    // Should not contain "null" in x or y attributes
    expect(html).not.toMatch(/x="null"/);
    expect(html).not.toMatch(/y="null"/);
    // x and y should be valid numbers (position 0 - w/2, 0 - h/2 for desk)
    expect(html).toMatch(/x="-22"/); // 0 - 44/2 = -22
    expect(html).toMatch(/y="-13"/); // 0 - 26/2 = -13
  });

  it('returns empty string for empty workstation list', () => {
    const html = topdownRenderer.renderFurnitureHitTest([]);
    expect(html).toBe('');
  });

  it('all rects have data-name and pointer-events attributes', () => {
    const html = topdownRenderer.renderFurnitureHitTest(workstationsWithoutDimensions);
    const rectMatches = html.matchAll(/<rect[^>]*>/g);
    let count = 0;
    for (const match of rectMatches) {
      const rectTag = match[0];
      expect(rectTag).toContain('data-name=');
      expect(rectTag).toContain('pointer-events="all"');
      expect(rectTag).toContain('class="td-hit-test-furniture"');
      count++;
    }
    expect(count).toBe(workstationsWithoutDimensions.length);
  });
});
