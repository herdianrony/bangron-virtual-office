/**
 * Waypoint-based graph navigation for the Bangron Virtual Office (layout v2).
 *
 * Builds a corridor waypoint graph from the architectural floor plan:
 *   - corridor centerlines come from `office-layout.js` corridor rects
 *     (two horizontal halls + one cross hall, served via DB / layout module)
 *   - each room exposes ONE door waypoint on the edge declared in its
 *     metadata (`{"door":{"side":"S","at":0.5}}`), auto-inferred from the
 *     nearest corridor when metadata is missing (backwards compatible)
 *
 * Routes are computed with A* through the corridor network, so agents walk
 * hallways like real people and never cut through room walls. Direct
 * straight-line walks are only allowed inside the same room (or in open
 * corridor space) and are rejected when the segment would cross another room.
 */

const DIRECT_ROUTE_MAX_DIST = 260;
const DOOR_CORRIDOR_MAX_DIST = 110; // max door -> corridor centerline projection distance
const DOOR_CLEARANCE = 24; // border crossing must happen within this radius of the door
const WALL_SAMPLE_STEP = 6;
const EPSILON = 0.75;

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function pointInRect(x, y, r, pad = 1.5) {
  return x > r.x + pad && x < r.x + r.w - pad && y > r.y + pad && y < r.y + r.h - pad;
}

/** Samples the segment and reports whether it crosses any room interior. */
function segmentCrossesRoom(rooms, ax, ay, bx, by, ignoreIds = []) {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, Math.ceil(dist / 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    for (const r of rooms) {
      if (ignoreIds.includes(r.id)) continue;
      if (pointInRect(x, y, r, 2)) return r.id;
    }
  }
  return null;
}

/**
 * Validates a straight-line walk. The segment must not pass through ANY room
 * interior, and where it does leave/enter the origin/destination room it must
 * cross the wall inside the door clearance radius (i.e. through the doorway).
 */
function directPathClear(graph, fromRoom, toRoom, ax, ay, bx, by) {
  const dist = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(2, Math.ceil(dist / WALL_SAMPLE_STEP));
  const insideMap = new Map();
  const crossings = new Map(); // roomId -> {x, y}

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    for (const r of graph.rooms) {
      const inside = pointInRect(x, y, r, 2);
      const prev = insideMap.get(r.id);
      if (prev === undefined) {
        insideMap.set(r.id, inside);
        continue;
      }
      if (prev !== inside) {
        // Border transition — record it (interpolated edge point)
        crossings.set(r.id, { x, y });
        insideMap.set(r.id, inside);
      }
    }
  }

  for (const r of graph.rooms) {
    const crossing = crossings.get(r.id);
    const isEndpointRoom = fromRoom && fromRoom.id === r.id ? true : toRoom && toRoom.id === r.id ? true : false;
    if (crossing && !isEndpointRoom) return false; // slices a third room
    if (!crossing && isEndpointRoom) continue; // fully inside / outside: fine
    if (crossing && isEndpointRoom) {
      const door = graph.doors.get(r.id);
      if (!door) return false;
      if (Math.hypot(crossing.x - door.x, crossing.y - door.y) > DOOR_CLEARANCE) return false;
    }
  }
  return true;
}

function dedupePoints(points) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < EPSILON) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

function collapseCollinear(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    // cross product of 2D vectors (a->b) x (a->c)
    const cr = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const dot = (b.x - a.x) * (c.x - a.x) + (b.y - a.y) * (c.y - a.y);
    if (Math.abs(cr) > EPSILON || dot <= 0) out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/* ------------------------------------------------------------------ */
/* Door parsing / inference                                            */
/* ------------------------------------------------------------------ */

function parseRoomDoor(room, corridors) {
  let door = null;
  try {
    const meta = typeof room.metadata_json === 'string' && room.metadata_json
      ? JSON.parse(room.metadata_json)
      : room.metadata_json || {};
    if (meta.door && ['N', 'S', 'E', 'W'].includes(meta.door.side)) {
      door = { side: meta.door.side, at: typeof meta.door.at === 'number' ? meta.door.at : 0.5 };
    }
  } catch {
    /* malformed metadata -> fall back to inference */
  }

  if (!door) {
    // Infer: pick the room edge closest to a corridor boundary.
    const edges = {
      N: { x: room.position_x + room.width / 2, y: room.position_y },
      S: { x: room.position_x + room.width / 2, y: room.position_y + room.height },
      W: { x: room.position_x, y: room.position_y + room.height / 2 },
      E: { x: room.position_x + room.width, y: room.position_y + room.height / 2 }
    };
    let best = null;
    for (const [side, p] of Object.entries(edges)) {
      for (const c of corridors || []) {
        const cx = c.x + c.w / 2;
        const cy = c.y + c.h / 2;
        const insideX = p.x > c.x - 8 && p.x < c.x + c.w + 8;
        const insideY = p.y > c.y - 8 && p.y < c.y + c.h + 8;
        const d = insideX && insideY ? 0 : Math.hypot(Math.max(c.x - p.x, 0, p.x - (c.x + c.w)), Math.max(c.y - p.y, 0, p.y - (c.y + c.h))) + Math.hypot(insideX ? 0 : Math.min(Math.abs(p.x - c.x), Math.abs(p.x - (c.x + c.w))), insideY ? 0 : Math.min(Math.abs(p.y - c.y), Math.abs(p.y - (c.y + c.h))));
        if (!best || d < best.d) best = { side, d, p };
      }
    }
    door = { side: best ? best.side : 'S', at: 0.5 };
  }

  const { side, at } = door;
  const point =
    side === 'N' ? { x: room.position_x + room.width * at, y: room.position_y }
    : side === 'S' ? { x: room.position_x + room.width * at, y: room.position_y + room.height }
    : side === 'W' ? { x: room.position_x, y: room.position_y + room.height * at }
    : { x: room.position_x + room.width, y: room.position_y + room.height * at };
  return { ...door, x: point.x, y: point.y };
}

/* ------------------------------------------------------------------ */
/* Keep-left lane offset                                               */
/* ------------------------------------------------------------------ */

/** Walker's left-hand normal in screen coords (y grows downward). */
function leftNormal(d) {
  // e.g. facing east (1,0) -> left hand points north (0,-1)
  return { x: d.y, y: -d.x };
}

function segDir(points, a, b) {
  const dx = points[b].x - points[a].x;
  const dy = points[b].y - points[a].y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return { x: dx / len, y: dy / len };
}

/** Miter join for a corner so the lane stays continuous around turns. */
function miterNormal(dIn, dOut) {
  const a = leftNormal(dIn);
  const b = leftNormal(dOut);
  let mx = a.x + b.x;
  let my = a.y + b.y;
  const len = Math.hypot(mx, my);
  if (len < 1e-3) return b; // 180-degree reversal fallback
  mx /= len;
  my /= len;
  const dot = mx * a.x + my * a.y;
  const scale = 1 / Math.max(dot, 0.55); // cap very sharp miters
  return { x: mx * scale, y: my * scale };
}

/**
 * Shifts the corridor portion of a route onto a keep-left lane, the way
 * pedestrians naturally walk on one side of a hallway. Door crossings and
 * room-interior legs stay centered — only corridor waypoints move to the
 * lane, so agents still pass straight through every doorway.
 *
 * Opposing walkers therefore pass each other on opposite lanes (eastbound
 * keeps the north side of an east-west hall, and so on), and per-agent
 * offset magnitude keeps same-direction walkers from single-file overlap.
 */
function applyLaneOffset(points, corridorIdx, offset) {
  const idxs = [...corridorIdx].sort((a, b) => a - b);
  if (!idxs.length) return;

  // All normals are computed from the ORIGINAL geometry snapshot — mutating
  // points while iterating would corrupt the directions of later waypoints.
  const orig = points.map((p) => ({ x: p.x, y: p.y }));
  const dir = (a, b) => segDir(orig, a, b);

  const runs = [];
  let run = [idxs[0]];
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] === idxs[i - 1] + 1) run.push(idxs[i]);
    else { runs.push(run); run = [idxs[i]]; }
  }
  runs.push(run);

  for (const r of runs) {
    const first = r[0];
    const last = r[r.length - 1];

    if (first === last) {
      const dIn = first > 0 ? dir(first - 1, first) : null;
      const dOut = last < points.length - 1 ? dir(first, last + 1) : null;
      const n = !dIn ? (dOut ? leftNormal(dOut) : null)
        : !dOut ? leftNormal(dIn)
        : miterNormal(dIn, dOut);
      if (n) { points[first].x += n.x * offset; points[first].y += n.y * offset; }
      continue;
    }

    for (let k = first; k <= last; k++) {
      const dIn = k > 0 ? dir(k - 1, k) : null;
      const dOut = k < points.length - 1 ? dir(k, k + 1) : null;
      let n;
      if (!dIn) n = dOut ? leftNormal(dOut) : null;
      else if (!dOut) n = leftNormal(dIn);
      else if (k === first) n = leftNormal(dOut); // door-aligned merge into lane
      else if (k === last) n = leftNormal(dIn);   // door-aligned exit from lane
      else n = miterNormal(dIn, dOut);
      if (n) { points[k].x += n.x * offset; points[k].y += n.y * offset; }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Graph construction                                                  */
/* ------------------------------------------------------------------ */

/**
 * Builds the navigation graph.
 * @param {Array} rooms      rows from office_rooms (position_x/position_y/width/height/metadata_json)
 * @param {Array} corridors  rects from office-layout.js OFFICE_CORRIDORS (optional)
 */
export function buildOfficeGraph(rooms = [], corridors = []) {
  if (!rooms.length) return null;
  const corr = corridors && corridors.length ? corridors : inferCorridorsFromRooms(rooms);

  // Corridor centerlines: long axis of every non-entry corridor rect.
  const lines = [];
  for (const c of corr) {
    if (c.entry) continue;
    if (c.h > c.w) lines.push({ axis: 'V', x: c.x + c.w / 2, y0: c.y, y1: c.y + c.h });
    else lines.push({ axis: 'H', y: c.y + c.h / 2, x0: c.x, x1: c.x + c.w });
  }

  const nodes = [];
  const nodeIndex = new Map(); // "x|y" -> node id

  const addNode = (x, y, kind) => {
    const key = `${x.toFixed(1)}|${y.toFixed(1)}`;
    if (nodeIndex.has(key)) return nodeIndex.get(key);
    const node = { id: nodes.length, x, y, kind, edges: [] };
    nodes.push(node);
    nodeIndex.set(key, node.id);
    return node.id;
  };

  // Line points: endpoints + intersections with other lines.
  const lineNodeIds = lines.map((line, li) => {
    const pts = [];
    if (line.axis === 'H') {
      pts.push(line.x0, line.x1);
      for (const other of lines) {
        if (other.axis !== 'V') continue;
        if (line.x0 - 1 <= other.x && other.x <= line.x1 + 1 && other.y0 - 1 <= line.y && line.y <= other.y1 + 1) {
          pts.push(other.x);
        }
      }
    } else {
      pts.push(line.y0, line.y1);
      for (const other of lines) {
        if (other.axis !== 'H') continue;
        if (line.y0 - 1 <= other.y && other.y <= line.y1 + 1 && other.x0 - 1 <= line.x && line.x <= other.x1 + 1) {
          pts.push(other.y);
        }
      }
    }
    const ids = [...new Set(pts.map((p) => Math.round(p * 10) / 10))].sort((a, b) => a - b).map((p) =>
      line.axis === 'H' ? addNode(p, line.y, 'corridor') : addNode(line.x, p, 'corridor')
    );
    for (let i = 0; i < ids.length - 1; i++) {
      nodes[ids[i]].edges.push(ids[i + 1]);
      nodes[ids[i + 1]].edges.push(ids[i]);
    }
    return { li, ids, line };
  });

  // Insert a door anchor into its line chain (keeps neighbours connected).
  const insertIntoLine = (lineEntry, anchorId) => {
    const { ids, line } = lineEntry;
    const pos = (n) => (line.axis === 'H' ? nodes[n].x : nodes[n].y);
    const anchorPos = pos(anchorId);
    let prev = null;
    let next = null;
    for (let i = 0; i < ids.length; i++) {
      if (pos(ids[i]) < anchorPos) prev = ids[i];
      else { next = ids[i]; break; }
    }
    if (prev !== null) {
      nodes[prev].edges.push(anchorId);
      nodes[anchorId].edges.push(prev);
    }
    if (next !== null) {
      nodes[next].edges.push(anchorId);
      nodes[anchorId].edges.push(next);
    }
  };

  // Doors: room edge point -> projected corridor anchor.
  const doors = new Map(); // roomId -> { side, x, y, nodeId, anchorId }
  for (const room of rooms) {
    const door = parseRoomDoor(room, corr);
    const doorId = addNode(door.x, door.y, 'door');

    // Project the door point onto the nearest corridor centerline.
    let best = null;
    for (const entry of lineNodeIds) {
      const line = entry.line;
      if (line.axis === 'H') {
        if (door.x < line.x0 - 1 || door.x > line.x1 + 1) continue;
        const d = Math.abs(door.y - line.y);
        if (d > DOOR_CORRIDOR_MAX_DIST) continue;
        if (!best || d < best.d) best = { d, entry, ax: door.x, ay: line.y };
      } else {
        if (door.y < line.y0 - 1 || door.y > line.y1 + 1) continue;
        const d = Math.abs(door.x - line.x);
        if (d > DOOR_CORRIDOR_MAX_DIST) continue;
        if (!best || d < best.d) best = { d, entry, ax: line.x, ay: door.y };
      }
    }

    if (best) {
      const anchorId = addNode(best.ax, best.ay, 'corridor');
      if (!best.entry.ids.includes(anchorId)) insertIntoLine(best.entry, anchorId);
      nodes[doorId].edges.push(anchorId);
      nodes[anchorId].edges.push(doorId);
      doors.set(room.id, { side: door.side, x: door.x, y: door.y, nodeId: doorId, anchorId });
    } else {
      doors.set(room.id, { side: door.side, x: door.x, y: door.y, nodeId: doorId, anchorId: null });
    }
  }

  // Keep the door position inside room metadata consumers (renderer) in sync.
  return { rooms, corridors: corr, lines, nodes, doors, nodeIndex };
}

/** Fallback for legacy layouts: a single perimeter band around the room grid. */
function inferCorridorsFromRooms(rooms) {
  const minX = Math.min(...rooms.map((r) => r.position_x));
  const maxX = Math.max(...rooms.map((r) => r.position_x + r.width));
  const minY = Math.min(...rooms.map((r) => r.position_y));
  const maxY = Math.max(...rooms.map((r) => r.position_y + r.height));
  return [
    { id: 'corr_h_north', x: minX, y: minY - 24, w: maxX - minX, h: 48 },
    { id: 'corr_h_south', x: minX, y: maxY - 24, w: maxX - minX, h: 48 },
    { id: 'corr_v_west', x: minX - 24, y: minY, w: 48, h: maxY - minY },
    { id: 'corr_v_east', x: maxX - 24, y: minY, w: 48, h: maxY - minY }
  ];
}

/**
 * Finds the room containing the given point (with a small tolerance).
 */
export function roomAt(graph, x, y) {
  if (!graph) return null;
  const pad = 1;
  return (
    graph.rooms.find(
      (r) =>
        x >= r.position_x - pad &&
        x <= r.position_x + r.width + pad &&
        y >= r.position_y - pad &&
        y <= r.position_y + r.height + pad
    ) || null
  );
}

function nearestNodeId(graph, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const node of graph.nodes) {
    const d = Math.hypot(node.x - x, node.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = node.id;
    }
  }
  return best;
}

function astar(graph, startId, goalId) {
  const nodes = graph.nodes;
  const open = [startId];
  const gScore = new Map([[startId, 0]]);
  const cameFrom = new Map();
  const h = (id) => Math.hypot(nodes[id].x - nodes[goalId].x, nodes[id].y - nodes[goalId].y);

  while (open.length) {
    open.sort((a, b) => (gScore.get(a) ?? Infinity) + h(a) - ((gScore.get(b) ?? Infinity) + h(b)));
    const current = open.shift();
    if (current === goalId) {
      const path = [current];
      let c = current;
      while (cameFrom.has(c)) {
        c = cameFrom.get(c);
        path.unshift(c);
      }
      return path;
    }
    for (const nb of nodes[current].edges) {
      const tentative = (gScore.get(current) ?? Infinity) + Math.hypot(nodes[current].x - nodes[nb].x, nodes[current].y - nodes[nb].y);
      if (tentative < (gScore.get(nb) ?? Infinity)) {
        cameFrom.set(nb, current);
        gScore.set(nb, tentative);
        if (!open.includes(nb)) open.push(nb);
      }
    }
  }
  return null;
}

/**
 * Computes a waypoint route from (fromX, fromY) to (toX, toY) that walks
 * corridors and passes through doors — never through walls.
 *
 * @param {Object} [options]
 * @param {number} [options.laneOffset=0] keep-left lane offset (units) applied
 *   to corridor waypoints so agents walk one side of the hallway, like real
 *   pedestrians. Room-interior legs and door crossings stay centered.
 */
export function computeRoute(graph, fromX, fromY, toX, toY, options = {}) {
  if (!graph) return [{ x: toX, y: toY }];
  const laneOffset = Math.max(0, Math.min(Number(options.laneOffset) || 0, 14));

  const fromRoom = roomAt(graph, fromX, fromY);
  const toRoom = roomAt(graph, toX, toY);
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const sameRoom = fromRoom && toRoom && fromRoom.id === toRoom.id;

  // Straight-line shortcut: allowed inside one room, or when the segment only
  // crosses walls through actual doorways (validated by directPathClear).
  if (sameRoom || (dist < DIRECT_ROUTE_MAX_DIST && directPathClear(graph, fromRoom, toRoom, fromX, fromY, toX, toY))) {
    return [{ x: toX, y: toY }];
  }

  const exitDoor = fromRoom ? graph.doors.get(fromRoom.id) : null;
  const entryDoor = toRoom ? graph.doors.get(toRoom.id) : null;

  const startId = exitDoor ? exitDoor.anchorId ?? exitDoor.nodeId : nearestNodeId(graph, fromX, fromY);
  const goalId = entryDoor ? entryDoor.anchorId ?? entryDoor.nodeId : nearestNodeId(graph, toX, toY);

  const nodePath = startId === goalId ? [startId] : astar(graph, startId, goalId);
  if (!nodePath) return [{ x: toX, y: toY }];

  const points = [{ x: fromX, y: fromY }];
  const corridorIdx = new Set(); // indices of waypoints that sit on corridor centerlines

  // Exit leg: interior -> door edge -> corridor anchor
  if (exitDoor && exitDoor.anchorId !== null) {
    points.push({ x: exitDoor.x, y: exitDoor.y });
    const anchor = graph.nodes[exitDoor.anchorId];
    points.push({ x: anchor.x, y: anchor.y });
    corridorIdx.add(points.length - 1);
  }

  for (const id of nodePath) {
    const n = graph.nodes[id];
    // Skip nodes already appended (anchor overlap)
    const last = points[points.length - 1];
    if (Math.hypot(n.x - last.x, n.y - last.y) < EPSILON) continue;
    points.push({ x: n.x, y: n.y });
    corridorIdx.add(points.length - 1);
  }

  // Entry leg: corridor anchor -> door edge -> destination interior
  if (entryDoor && entryDoor.anchorId !== null) {
    const anchor = graph.nodes[entryDoor.anchorId];
    const last = points[points.length - 1];
    if (Math.hypot(anchor.x - last.x, anchor.y - last.y) >= EPSILON) {
      points.push({ x: anchor.x, y: anchor.y });
      corridorIdx.add(points.length - 1);
    }
    points.push({ x: entryDoor.x, y: entryDoor.y });
  }

  points.push({ x: toX, y: toY });

  // Keep-left lane: corridor waypoints shift to the walker's left side.
  if (laneOffset > 0 && corridorIdx.size) applyLaneOffset(points, corridorIdx, laneOffset);

  return collapseCollinear(dedupePoints(points));
}

export default { buildOfficeGraph, roomAt, computeRoute };
