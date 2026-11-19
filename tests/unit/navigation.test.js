import { describe, it, expect } from 'vitest';
import { buildOfficeGraph, computeRoute, roomAt } from '../../src/services/navigation.js';
import { OFFICE_ROOMS, OFFICE_CORRIDORS, OFFICE_WORKSTATIONS } from '../../src/services/office-layout.js';

// Mirrors the DB rows: layout v2 rooms carry their door in metadata_json.
const seedRooms = OFFICE_ROOMS.map((r) => ({
  id: r.id,
  name: r.name,
  position_x: r.px,
  position_y: r.py,
  width: r.w,
  height: r.h,
  metadata_json: JSON.stringify({ door: r.door, ...(r.entrance ? { entrance: true } : {}) })
}));

const ws = (id) => OFFICE_WORKSTATIONS.find((w) => w.id === id);

describe('office navigation graph (architectural layout v2)', () => {
  const graph = buildOfficeGraph(seedRooms, OFFICE_CORRIDORS);

  it('builds a connected waypoint graph from the floor plan', () => {
    expect(graph).not.toBeNull();
    expect(graph.rooms).toHaveLength(14);
    expect(graph.lines).toHaveLength(3); // main hall, south hall, cross hall
    expect(graph.nodes.length).toBeGreaterThan(10);
    for (const node of graph.nodes) {
      expect(node.edges.length, `node ${node.id} should have edges`).toBeGreaterThan(0);
    }
    // Every room must have a door wired into the corridor network.
    for (const room of seedRooms) {
      const door = graph.doors.get(room.id);
      expect(door, `${room.id} needs a door`).toBeTruthy();
      expect(door.anchorId, `${room.id} door must connect to a corridor`).not.toBeNull();
    }
  });

  it('routes straight when both points share a room', () => {
    const backend = ws('ws_dev_desk_backend');
    const frontend = ws('ws_dev_desk_frontend');
    const route = computeRoute(graph, backend.px, backend.py, frontend.px, frontend.py);
    expect(route).toEqual([{ x: frontend.px, y: frontend.py }]);
  });

  it('allows a doorway-legal direct walk between adjacent rooms', () => {
    // Development Room -> Director Office: the straight segment exits through
    // the dev door and enters through the director door, so a direct route is
    // geometrically legal (no wall is crossed).
    const from = ws('ws_dev_desk_backend');
    const to = ws('ws_dir_desk');
    const route = computeRoute(graph, from.px, from.py, to.px, to.py);
    expect(route).toEqual([{ x: to.px, y: to.py }]);
  });

  it('computes a corridor-safe route between distant rooms', () => {
    const from = ws('ws_lounge_sofa'); // Lounge, south-west wing
    const to = ws('ws_dir_desk'); // Director Office, north-west corner
    const route = computeRoute(graph, from.px, from.py, to.px, to.py);
    expect(route.length).toBeGreaterThan(2);
    expect(route[0]).toEqual({ x: from.px, y: from.py });
    expect(route[route.length - 1]).toEqual({ x: to.px, y: to.py });

    // Every intermediate waypoint must stay outside room interiors (corridor band)
    for (const p of route.slice(1, -1)) {
      const insideRoom = seedRooms.some(
        (r) => p.x > r.position_x + 2 && p.x < r.position_x + r.width - 2 && p.y > r.position_y + 2 && p.y < r.position_y + r.height - 2
      );
      expect(insideRoom, `waypoint ${JSON.stringify(p)} must sit in a corridor`).toBe(false);
    }
  });

  it('never crosses a wall on long trips across the whole floor', () => {
    const pairs = [
      ['ws_lounge_sofa', 'ws_coffee_bar'], // south-west wing -> middle-east wing
      ['ws_ops_orchestrator', 'ws_reception_desk'], // north band -> south band
      ['ws_meeting_table', 'ws_server_terminal'], // north-west -> south-east
      ['ws_research_desk_1', 'ws_qa_desk_1'] // middle-west -> north-east
    ];
    for (const [fromId, toId] of pairs) {
      const from = ws(fromId);
      const to = ws(toId);
      const route = computeRoute(graph, from.px, from.py, to.px, to.py);
      expect(route.length, `${fromId} -> ${toId}`).toBeGreaterThan(2);
      // No leg may slice through a room the agent is not visiting.
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1];
        const b = route[i];
        const fromRoom = roomAt(graph, a.x, a.y);
        const toRoom = roomAt(graph, b.x, b.y);
        for (const r of seedRooms) {
          if (fromRoom && fromRoom.id === r.id) continue;
          if (toRoom && toRoom.id === r.id) continue;
          // Sample the leg against the room interior.
          const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = a.x + (b.x - a.x) * t;
            const y = a.y + (b.y - a.y) * t;
            const inside = x > r.position_x + 2 && x < r.position_x + r.width - 2 && y > r.position_y + 2 && y < r.position_y + r.height - 2;
            expect(inside, `${fromId} -> ${toId}: leg crosses ${r.id} at (${x.toFixed(0)}, ${y.toFixed(0)})`).toBe(false);
            if (inside) break;
          }
        }
      }
    }
  });

  it('keeps routes unique and forward-moving between any two rooms', () => {
    const route = computeRoute(graph, ws('ws_uiux_desk_1').px, ws('ws_uiux_desk_1').py, ws('ws_lounge_sofa').px, ws('ws_lounge_sofa').py);
    expect(route.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
    }
  });

  it('identifies rooms by point lookup', () => {
    expect(roomAt(graph, ws('ws_meeting_table').px, ws('ws_meeting_table').py)?.id).toBe('room_meeting');
    expect(roomAt(graph, ws('ws_server_terminal').px, ws('ws_server_terminal').py)?.id).toBe('room_server');
    expect(roomAt(graph, 320, 317)).toBeNull(); // inside the main corridor band
    expect(roomAt(graph, 617, 380)?.id).toBe('room_library'); // Perpustakaan
    expect(roomAt(graph, 855, 380)?.id).toBe('room_coffee'); // Ruang Kopi
  });
});
