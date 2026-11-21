/**
 * Bangron Virtual Office — Top-down "Helicopter View" Renderer (layout v2)
 *
 * Ported from the bangron-studio-topdown.html design mockup into the real,
 * data-driven office, then upgraded to an architectural floor plan:
 *   - terrazzo corridors + wooden room floors, union building walls with
 *     automatic door gaps (rooms, corridors & door metadata come from the
 *     backend state, single source of truth: src/services/office-layout.js)
 *   - day/night lighting, swaying plants, blinking server LEDs, corridor
 *     ceiling lights, library bookshelves, an espresso bar and a real-time
 *     wall clock
 */

import { DEPARTMENT_COLORS, STATUS_HALO_COLORS } from './palette.js';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Darken a hex color by a percentage (port of the mockup `sh()` helper). */
const shade = (hex, pc = 16) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round((v * (100 - pc)) / 100);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

const WORKSTATION_TYPE_LABELS = {
  desk: 'Meja Kerja',
  dev_desk: 'Meja Developer',
  executive_desk: 'Meja Direktur',
  terminal: 'Rak Server',
  conference_table: 'Meja Meeting',
  couch: 'Sofa Lounge',
  command_pod: 'Pod Orkestrasi',
  qa_bench: 'Meja QA & Security',
  bench: 'Meja Riset',
  design_bench: 'Meja Desain UI/UX',
  creative_bench: 'Meja Kreatif',
  library_table: 'Meja Baca Perpustakaan',
  coffee_bar: 'Bar Kopi',
  reception: 'Resepsionis'
};

/** Fallback corridor plan (matches src/services/office-layout.js). */
const DEFAULT_CORRIDORS = [
  { id: 'corr_main', x: 30, y: 295, w: 940, h: 45 },
  { id: 'corr_south', x: 30, y: 480, w: 940, h: 45 },
  { id: 'corr_cross', x: 455, y: 30, w: 45, h: 620 },
  { id: 'corr_porch', x: 455, y: 650, w: 45, h: 16, entry: true }
];

// World bounds covered by the plan (rooms + corridors + porch, clock and
// compass live just outside the building walls).
const BOUNDS = { x: 12, y: 12, w: 996, h: 672 };

const CORRIDOR_FLOOR = '#ddd4b8';
const CORRIDOR_TILE = '#cbc0a0';
const DOOR_GAP = 21;

/** Top-down projection: world X/Y map 1:1 to screen pixels. */
export const topdownProjection = {
  toScreen(x, y, z = 0) {
    return { x, y: y - (z || 0) };
  }
};

function pointInRect(x, y, r, pad = 1.5) {
  return x > r.x + pad && x < r.x + r.w - pad && y > r.y + pad && y < r.y + r.h - pad;
}

export class TopdownRenderer {
  constructor() {
    this._clockTimer = null;
  }

  get BOUNDS() {
    return BOUNDS;
  }

  get projection() {
    return topdownProjection;
  }

  /* ------------------------------------------------------------------ */
  /* Defs (gradients)                                                    */
  /* ------------------------------------------------------------------ */

  ensureDefs(defsEl) {
    if (!defsEl || defsEl.querySelector('#td-g-pool')) return;
    defsEl.insertAdjacentHTML(
      'beforeend',
      `
      <radialGradient id="td-g-pool">
        <stop offset="0" stop-color="#ffd98a" stop-opacity="0.55"/>
        <stop offset="1" stop-color="#ffd98a" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="td-g-corridor">
        <stop offset="0" stop-color="#fff4d6" stop-opacity="0.5"/>
        <stop offset="1" stop-color="#fff4d6" stop-opacity="0"/>
      </radialGradient>
      `
    );
  }

  /* ------------------------------------------------------------------ */
  /* Floors: corridors + building wall outline                           */
  /* ------------------------------------------------------------------ */

  renderCorridors(corridors = []) {
    const list = corridors && corridors.length ? corridors : DEFAULT_CORRIDORS;
    return list
      .map((c) => {
        if (c.entry) {
          // Front porch: concrete stoop leading to the main gate.
          return `<g class="td-corridor td-porch" data-name="Teras masuk — gerbang utama">
            <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="#c9c2b0"/>
          </g>`;
        }
        // Terrazzo tile flooring with a subtle grid.
        let tiles = '';
        for (let tx = c.x + 11; tx < c.x + c.w - 4; tx += 22) {
          tiles += `<line x1="${tx}" y1="${c.y + 2}" x2="${tx}" y2="${c.y + c.h - 2}" stroke="${CORRIDOR_TILE}" stroke-width="1" opacity="0.6"/>`;
        }
        for (let ty = c.y + 11; ty < c.y + c.h - 4; ty += 22) {
          tiles += `<line x1="${c.x + 2}" y1="${ty}" x2="${c.x + c.w - 2}" y2="${ty}" stroke="${CORRIDOR_TILE}" stroke-width="1" opacity="0.6"/>`;
        }
        return `<g class="td-corridor" data-name="Koridor kantor">
          <rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="${CORRIDOR_FLOOR}"/>
          ${tiles}
        </g>`;
      })
      .join('\n');
  }

  /**
   * Building wall outline: for every corridor edge, draw wall only where the
   * edge is NOT covered by another room/corridor (i.e. it faces the outside).
   * Door gaps appear automatically because the door edge falls inside the
   * neighbouring corridor rect.
   */
  renderWalls(rooms = [], corridors = []) {
    const rects = [...(corridors && corridors.length ? corridors : DEFAULT_CORRIDORS), ...rooms.map((r) => ({ x: r.position_x, y: r.position_y, w: r.width, h: r.height, id: r.id }))];
    let out = '';
    const list = corridors && corridors.length ? corridors : DEFAULT_CORRIDORS;

    for (const c of list) {
      const edges = [
        { x1: c.x, y1: c.y, x2: c.x + c.w, y2: c.y },
        { x1: c.x, y1: c.y + c.h, x2: c.x + c.w, y2: c.y + c.h },
        { x1: c.x, y1: c.y, x2: c.x, y2: c.y + c.h },
        { x1: c.x + c.w, y1: c.y, x2: c.x + c.w, y2: c.y + c.h }
      ];
      for (const e of edges) {
        // The porch keeps its far edge open — that is the front gate.
        if (c.entry && e.y1 === c.y + c.h && e.y2 === c.y + c.h) continue;
        const horiz = e.y1 === e.y2;
        const len = horiz ? e.x2 - e.x1 : e.y2 - e.y1;
        const steps = Math.max(2, Math.ceil(len / 4));
        let runs = [];
        let cur = null;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const px = e.x1 + (horiz ? t * len : 0);
          const py = e.y1 + (horiz ? 0 : t * len);
          const covered = rects.some((o) => pointInRect(px, py, o));
          if (!covered) {
            if (!cur) cur = { a: t, b: t };
            else cur.b = t;
          } else if (cur) {
            runs.push(cur);
            cur = null;
          }
        }
        if (cur) runs.push(cur);
        for (const run of runs) {
          const ax = e.x1 + (horiz ? run.a * len : 0);
          const ay = e.y1 + (horiz ? 0 : run.a * len);
          const bx = e.x1 + (horiz ? run.b * len : 0);
          const by = e.y1 + (horiz ? 0 : run.b * len);
          out += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#6d5c4a" stroke-width="7" stroke-linecap="square"/>`;
          out += `<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#453b30" stroke-width="2.2" stroke-linecap="square"/>`;
        }
      }
    }
    return `<g class="td-walls" pointer-events="none">${out}</g>`;
  }

  /* ------------------------------------------------------------------ */
  /* Rooms                                                               */
  /* ------------------------------------------------------------------ */

  renderRooms(rooms = []) {
    return rooms.map((room) => this.renderRoom(room)).join('\n');
  }

  /** Door position from room metadata (single source: office-layout.js). */
  getDoor(room) {
    let side = 'S';
    let at = 0.5;
    try {
      const meta = typeof room.metadata_json === 'string' && room.metadata_json
        ? JSON.parse(room.metadata_json)
        : room.metadata_json || {};
      if (meta.door && ['N', 'S', 'E', 'W'].includes(meta.door.side)) {
        side = meta.door.side;
        at = typeof meta.door.at === 'number' ? meta.door.at : 0.5;
      }
      this._entranceFlag = !!meta.entrance;
    } catch {
      this._entranceFlag = false;
    }
    const px = room.position_x;
    const py = room.position_y;
    const w = room.width;
    const h = room.height;
    const point =
      side === 'N' ? { x: px + w * at, y: py }
      : side === 'S' ? { x: px + w * at, y: py + h }
      : side === 'W' ? { x: px, y: py + h * at }
      : { x: px + w, y: py + h * at };
    return { side, x: point.x, y: point.y };
  }

  renderRoom(room) {
    const { id, name, position_x: px, position_y: py, width: w, height: h, department } = room;
    const deptColor = DEPARTMENT_COLORS[department] || '#6b7280';
    const door = this.getDoor(room);
    const entrance = this._entranceFlag;

    // Wooden plank floor (port of the mockup floor style)
    let planks = '';
    const x0 = px + 5;
    const x1 = px + w - 5;
    let row = 0;
    for (let ly = py + 16; ly < py + h - 10; ly += 24, row++) {
      planks += `<line x1="${x0}" y1="${ly}" x2="${x1}" y2="${ly}" stroke="#cdb488" stroke-width="1" opacity="0.5"/>`;
      const seamX = row % 2 === 0 ? px + 34 : px + 66;
      for (let sx = seamX; sx < x1 - 8; sx += 96) {
        planks += `<line x1="${sx}" y1="${ly}" x2="${sx}" y2="${ly + 24}" stroke="#cdb488" stroke-width="1" opacity="0.35"/>`;
      }
    }

    // Door leaf + dashed swing arc on the declared edge (gap fill uses the
    // corridor floor colour so the opening reads through the wall stroke).
    let doorSvg = '';
    const gapRect = (x, y, gw, gh) =>
      `<rect x="${x}" y="${y}" width="${gw}" height="${gh}" fill="${CORRIDOR_FLOOR}"/>`;
    const leafH = (hx, hy, dir) => `
      <line x1="${hx}" y1="${hy}" x2="${hx}" y2="${hy + (dir > 0 ? 38 : -38)}" stroke="#8a6a48" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M ${hx + DOOR_GAP} ${hy} A ${DOOR_GAP * 2} ${DOOR_GAP * 2} 0 0 ${dir > 0 ? 0 : 1} ${hx} ${hy + (dir > 0 ? DOOR_GAP * 2 : -DOOR_GAP * 2)}" fill="none" stroke="#b09a7a" stroke-width="1.3" stroke-dasharray="5 4"/>
      <circle cx="${hx + 2.5}" cy="${hy + (dir > 0 ? 33 : -33)}" r="1.6" fill="#57493c"/>`;
    const leafV = (vx, vy, dir) => `
      <line x1="${vx}" y1="${vy}" x2="${vx + (dir > 0 ? 38 : -38)}" y2="${vy}" stroke="#8a6a48" stroke-width="3.5" stroke-linecap="round"/>
      <path d="M ${vx} ${vy + DOOR_GAP * (dir > 0 ? 1 : -1)} A ${DOOR_GAP * 2} ${DOOR_GAP * 2} 0 0 ${dir > 0 ? 1 : 0} ${vx + (dir > 0 ? DOOR_GAP * 2 : -DOOR_GAP * 2)} ${vy}" fill="none" stroke="#b09a7a" stroke-width="1.3" stroke-dasharray="5 4"/>
      <circle cx="${vx + (dir > 0 ? 33 : -33)}" cy="${vy + 2.5}" r="1.6" fill="#57493c"/>`;

    if (door.side === 'S') {
      doorSvg = `${gapRect(door.x - DOOR_GAP, door.y - 5, DOOR_GAP * 2, 10)}
        <line x1="${door.x - DOOR_GAP}" y1="${door.y - 5}" x2="${door.x - DOOR_GAP}" y2="${door.y + 5}" stroke="#57493c" stroke-width="3"/>
        <line x1="${door.x + DOOR_GAP}" y1="${door.y - 5}" x2="${door.x + DOOR_GAP}" y2="${door.y + 5}" stroke="#57493c" stroke-width="3"/>
        ${leafH(door.x - DOOR_GAP, door.y - 2, 1)}`;
    } else if (door.side === 'N') {
      doorSvg = `${gapRect(door.x - DOOR_GAP, door.y - 5, DOOR_GAP * 2, 10)}
        <line x1="${door.x - DOOR_GAP}" y1="${door.y - 5}" x2="${door.x - DOOR_GAP}" y2="${door.y + 5}" stroke="#57493c" stroke-width="3"/>
        <line x1="${door.x + DOOR_GAP}" y1="${door.y - 5}" x2="${door.x + DOOR_GAP}" y2="${door.y + 5}" stroke="#57493c" stroke-width="3"/>
        ${leafH(door.x - DOOR_GAP, door.y + 2, -1)}`;
    } else if (door.side === 'W') {
      doorSvg = `${gapRect(door.x - 5, door.y - DOOR_GAP, 10, DOOR_GAP * 2)}
        <line x1="${door.x - 5}" y1="${door.y - DOOR_GAP}" x2="${door.x + 5}" y2="${door.y - DOOR_GAP}" stroke="#57493c" stroke-width="3"/>
        <line x1="${door.x - 5}" y1="${door.y + DOOR_GAP}" x2="${door.x + 5}" y2="${door.y + DOOR_GAP}" stroke="#57493c" stroke-width="3"/>
        ${leafV(door.x + 2, door.y - DOOR_GAP, 1)}`;
    } else {
      doorSvg = `${gapRect(door.x - 5, door.y - DOOR_GAP, 10, DOOR_GAP * 2)}
        <line x1="${door.x - 5}" y1="${door.y - DOOR_GAP}" x2="${door.x + 5}" y2="${door.y - DOOR_GAP}" stroke="#57493c" stroke-width="3"/>
        <line x1="${door.x - 5}" y1="${door.y + DOOR_GAP}" x2="${door.x + 5}" y2="${door.y + DOOR_GAP}" stroke="#57493c" stroke-width="3"/>
        ${leafV(door.x - 2, door.y - DOOR_GAP, -1)}`;
    }

    // Main gate on the south wall of the reception room
    const gate = entrance
      ? `<g data-name="Gerbang utama — pintu masuk kantor">
          ${gapRect(px + w / 2 - 26, py + h - 5, 52, 10)}
          <rect x="${px + w / 2 - 24}" y="${py + h - 12}" width="48" height="7" rx="2" fill="none" stroke="#8a6a48" stroke-width="1.5"/>
          <line x1="${px + w / 2 - 24}" y1="${py + h - 2}" x2="${px + w / 2 - 2}" y2="${py + h - 20}" stroke="#8a6a48" stroke-width="3" stroke-linecap="round"/>
          <line x1="${px + w / 2 + 24}" y1="${py + h - 2}" x2="${px + w / 2 + 2}" y2="${py + h - 20}" stroke="#8a6a48" stroke-width="3" stroke-linecap="round"/>
          <rect x="${px + w / 2 - 16}" y="${py + h + 2}" width="32" height="11" rx="2" fill="#b98d5f" stroke="#8a6a48"/>
          <text x="${px + w / 2}" y="${py + h + 10.5}" font-size="6.5" font-weight="800" fill="#57493c" text-anchor="middle" letter-spacing="0.6">MASUK</text>
        </g>`
      : '';

    // Room name chip + department accent stripe
    const label = `
      <g pointer-events="none">
        <rect x="${px + 2}" y="${py + 3}" width="${w - 4}" height="3.5" fill="${deptColor}" opacity="0.4"/>
        <rect x="${Math.max(px + 4, px + w / 2 - 72)}" y="${py + 9}" width="${Math.min(w - 8, 144)}" height="17" rx="4" fill="rgba(43,38,28,0.78)"/>
        <circle cx="${Math.max(px + 4, px + w / 2 - 72) + 12}" cy="${py + 17.5}" r="3" fill="${deptColor}"/>
        <text x="${px + w / 2 + 6}" y="${py + 21.5}" font-size="9.5" font-weight="700" fill="#f4ead2" text-anchor="middle" letter-spacing="0.4">${esc(name)}</text>
      </g>`;

    return `
      <g class="td-room" data-room-id="${esc(id)}" data-name="${esc(name)} — ${esc(department || 'General')}">
        <rect x="${px + 3}" y="${py + 3}" width="${w - 6}" height="${h - 6}" fill="#e3d0a8" rx="2"/>
        ${planks}
        <rect x="${px + 1}" y="${py + 1}" width="${w - 2}" height="${h - 2}" fill="none" stroke="#7d6c58" stroke-width="5" rx="2"/>
        <rect x="${px + 1}" y="${py + 1}" width="${w - 2}" height="${h - 2}" fill="none" stroke="#57493c" stroke-width="1" rx="2"/>
        ${doorSvg}
        ${gate}
        ${label}
      </g>`;
  }

  /* ------------------------------------------------------------------ */
  /* Decorations (lamp pools, plants, wall clock, compass, shelves)      */
  /* ------------------------------------------------------------------ */

  renderDecorations(rooms = [], corridors = []) {
    const list = corridors && corridors.length ? corridors : DEFAULT_CORRIDORS;
    const roomDecor = rooms.map((room) => this.renderRoomDecor(room)).join('\n');
    return `
      ${this.renderCorridorDecor(list, rooms)}
      ${roomDecor}
      ${rooms.map((room) => this.renderRoomSpecials(room)).join('\n')}
      ${this.renderWallClock()}
      ${this.renderCompass()}
    `;
  }

  renderRoomDecor(room) {
    const { position_x: px, position_y: py, width: w, height: h } = room;
    const cx = px + w / 2;
    const cy = py + h / 2;
    return `
      <g class="td-room-decor" pointer-events="none">
        <!-- ceiling lamp light pool -->
        <ellipse cx="${cx}" cy="${cy}" rx="68" ry="48" fill="url(#td-g-pool)" class="pool"/>
      </g>
      <g class="td-lamp" data-name="Lampu gantung — klik untuk ganti mode siang/malam" transform="translate(${cx}, ${cy})">
        <circle r="5.5" fill="#3b3f46" stroke="#23262b" stroke-width="1.2" opacity="0.9"/>
        <circle r="3" fill="#ffd98a" class="td-glowP"/>
      </g>
      ${this.renderPlant(px + 20, py + 32, 'Tanaman — sudut barat')}
      ${this.renderPlant(px + w - 20, py + 32, 'Tanaman — sudut timur')}
    `;
  }

  /** Corridor ceiling lights, potted plants and entry mat along the halls. */
  renderCorridorDecor(corridors, rooms) {
    let out = '';
    for (const c of corridors) {
      if (c.entry) continue;
      const horiz = c.w >= c.h;
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      const span = horiz ? c.w : c.h;
      for (let d = 90; d < span - 40; d += 210) {
        const lx = horiz ? c.x + d : cx;
        const ly = horiz ? cy : c.y + d;
        out += `
          <g class="td-corridor-lamp" data-name="Lampu koridor">
            <ellipse cx="${lx}" cy="${ly}" rx="44" ry="26" fill="url(#td-g-corridor)" pointer-events="none"/>
            <circle r="3.6" fill="#3b3f46" stroke="#23262b" stroke-width="1"/>
            <circle r="2" fill="#ffe9b8" class="td-glowP"/>
          </g>`;
      }
    }

    // Potted plants placed on corridor walls away from doors
    const plantSpots = [
      { x: 60, y: 316 }, { x: 438, y: 316 }, { x: 522, y: 316 }, { x: 940, y: 316 },
      { x: 60, y: 502 }, { x: 438, y: 502 }, { x: 522, y: 502 }, { x: 940, y: 502 },
      { x: 477, y: 60 }, { x: 477, y: 210 }, { x: 477, y: 430 }, { x: 477, y: 580 }
    ];
    for (const p of plantSpots) {
      out += this.renderPlant(p.x, p.y, 'Tanaman koridor');
    }

    // Entry mat on the porch
    const porch = corridors.find((c) => c.entry);
    if (porch) {
      out += `
        <g data-name="Kesap masuk — gerbang utama" pointer-events="none">
          <rect x="${porch.x + 2}" y="${porch.y + 1}" width="${porch.w - 4}" height="${porch.h - 2}" rx="2" fill="#a9774f" stroke="#8a6a48"/>
          <line x1="${porch.x + 6}" y1="${porch.y + 5}" x2="${porch.x + porch.w - 6}" y2="${porch.y + porch.h - 5}" stroke="#8a6a48" stroke-width="1" opacity="0.6"/>
          <line x1="${porch.x + porch.w - 6}" y1="${porch.y + 5}" x2="${porch.x + 6}" y2="${porch.y + porch.h - 5}" stroke="#8a6a48" stroke-width="1" opacity="0.6"/>
        </g>`;
    }
    return `<g class="td-corridor-decor">${out}</g>`;
  }

  /** Room-specific dressing: library bookshelves, espresso machine. */
  renderRoomSpecials(room) {
    if (room.id === 'room_library') {
      return this.renderLibraryShelves(room);
    }
    if (room.id === 'room_coffee') {
      return this.renderCoffeeCorner(room);
    }
    if (room.id === 'room_server') {
      return this.renderServerTiles(room);
    }
    return '';
  }

  renderLibraryShelves(room) {
    const px = room.position_x;
    const py = room.position_y;
    const w = room.width;
    const spineColors = ['#b3554d', '#4f8adb', '#e0b64f', '#5f8f5a', '#8b5cf6', '#d05a4a', '#4f8a8b', '#c9773f'];
    let shelves = '';
    // Two long shelves along the north wall
    for (const sy of [py + 22, py + 46]) {
      shelves += `<rect x="${px + 16}" y="${sy}" width="${w - 60}" height="14" rx="1.5" fill="#8a5a3b" stroke="#6f462e" stroke-width="1.2"/>`;
      let bx = px + 20;
      let i = 0;
      while (bx < px + w - 52) {
        const bw = 3 + ((i * 7) % 3);
        shelves += `<rect x="${bx}" y="${sy + 2.5}" width="${bw}" height="9" fill="${spineColors[i % spineColors.length]}"/>`;
        bx += bw + 1.6;
        i++;
      }
    }
    // A small reading lamp on the table is part of the workstation glyph.
    return `<g class="td-library-shelves" data-name="Rak buku perpustakaan" pointer-events="none">${shelves}</g>`;
  }

  renderCoffeeCorner(room) {
    const px = room.position_x;
    const py = room.position_y;
    const w = room.width;
    return `
      <g class="td-coffee-corner" data-name="Sudut kopi — mesin espresso & snack" pointer-events="none">
        <rect x="${px + w - 70}" y="${py + 14}" width="52" height="18" rx="2" fill="#5d4430" stroke="#43301f" stroke-width="1.4"/>
        <rect x="${px + w - 66}" y="${py + 17}" width="18" height="12" rx="1.5" fill="#23262b"/>
        <circle cx="${px + w - 57}" cy="${py + 23}" r="3" fill="#ff8f6b" class="td-led"/>
        <rect x="${px + w - 42}" y="${py + 19}" width="16" height="8" rx="1.5" fill="#e8d9b0" stroke="#c9b287"/>
        <circle cx="${px + 22}" cy="${py + 112}" r="9" fill="#f2ede1" stroke="#c9b287" stroke-width="1.2"/>
        <circle cx="${px + 22}" cy="${py + 112}" r="4.5" fill="#8a5a3b"/>
        <circle cx="${px + 40}" cy="${py + 116}" r="6.5" fill="#f2ede1" stroke="#c9b287" stroke-width="1.2"/>
        <circle cx="${px + 40}" cy="${py + 116}" r="3" fill="#d05a4a" opacity="0.85"/>
      </g>`;
  }

  renderServerTiles(room) {
    const px = room.position_x;
    const py = room.position_y;
    const w = room.width;
    const h = room.height;
    let tiles = '';
    for (let tx = px + 24; tx < px + w - 10; tx += 26) {
      for (let ty = py + 40; ty < py + h - 10; ty += 26) {
        tiles += `<rect x="${tx}" y="${ty}" width="24" height="24" fill="none" stroke="#cdb488" stroke-width="1" opacity="0.55"/>`;
      }
    }
    return `<g class="td-server-tiles" data-name="Lantai grating ruang server" pointer-events="none">${tiles}</g>`;
  }

  renderPlant(x, y, name) {
    const leaves = [0, 60, 120, 180, 240, 300]
      .map(
        (a, i) =>
          `<ellipse cx="${x}" cy="${y}" rx="8" ry="2.6" fill="${['#5f8f5a', '#6fa468', '#547f50'][i % 3]}" transform="rotate(${a} ${x} ${y})"/>`
      )
      .join('\n');
    return `
      <g class="td-plant" data-name="${esc(name)}">
        <ellipse cx="${x}" cy="${y + 2.5}" rx="8" ry="5" fill="rgba(0,0,0,0.12)"/>
        <g class="td-sway">${leaves}</g>
        <circle cx="${x}" cy="${y}" r="5.5" fill="#8a5a3b" stroke="#6f462e" stroke-width="1.4"/>
        <circle cx="${x}" cy="${y}" r="3" fill="#5d4430"/>
      </g>`;
  }

  renderWallClock() {
    let ticks = '';
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      const r1 = i % 3 === 0 ? 11 : 13.5;
      const r2 = 15;
      ticks += `<line x1="${(Math.sin(a) * r1).toFixed(1)}" y1="${(-Math.cos(a) * r1).toFixed(1)}" x2="${(Math.sin(a) * r2).toFixed(1)}" y2="${(-Math.cos(a) * r2).toFixed(1)}" stroke="#6b5d4f" stroke-width="${i % 3 === 0 ? 2 : 1}"/>`;
    }
    const now = new Date();
    return `
      <g id="td-wallclock" data-name="Jam dinding — waktu nyata" transform="translate(990, 34)">
        <circle r="17" fill="#f6f1e4" stroke="#6b5d4f" stroke-width="2"/>
        ${ticks}
        <line id="td-clk-h" x1="0" y1="0" x2="0" y2="-8" stroke="#3a3430" stroke-width="2.4" stroke-linecap="round" transform="rotate(${(((now.getHours() % 12) + now.getMinutes() / 60) * 30).toFixed(2)})"/>
        <line id="td-clk-m" x1="0" y1="0" x2="0" y2="-12" stroke="#3a3430" stroke-width="1.8" stroke-linecap="round" transform="rotate(${(now.getMinutes() * 6).toFixed(2)})"/>
        <g transform="rotate(${(now.getSeconds() * 6).toFixed(2)})">
          <line x1="0" y1="0" x2="0" y2="-13.5" stroke="#d05a4a" stroke-width="1.2" stroke-linecap="round"/>
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="60s" additive="sum" repeatCount="indefinite"/>
        </g>
        <circle r="1.8" fill="#3a3430"/>
      </g>`;
  }

  renderCompass() {
    return `
      <g data-name="Kompas — utara" transform="translate(990, 622)" pointer-events="none">
        <circle r="13" fill="#f2ede1" stroke="#b09a7a" stroke-width="1.5"/>
        <path d="M 0 -10 L 4 7 L 0 4 L -4 7 Z" fill="#d05a4a"/>
        <text x="0" y="-15" font-size="8" font-weight="800" fill="#8b7a63" text-anchor="middle">U</text>
      </g>`;
  }

  /** Real-time wall clock: hour/minute hands (second hand runs via SMIL). */
  startClock() {
    this.stopClock();
    const update = () => {
      const h = document.getElementById('td-clk-h');
      const m = document.getElementById('td-clk-m');
      if (!h || !m) return;
      const d = new Date();
      const hv = (d.getHours() % 12) + d.getMinutes() / 60;
      h.setAttribute('transform', `rotate(${(hv * 30).toFixed(2)})`);
      m.setAttribute('transform', `rotate(${(d.getMinutes() * 6).toFixed(2)})`);
    };
    update();
    this._clockTimer = setInterval(update, 15000);
  }

  stopClock() {
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Furniture / workstations                                            */
  /* ------------------------------------------------------------------ */

  renderFurniture(workstations = []) {
    return workstations.map((ws) => this.renderWorkstation(ws)).join('\n');
  }

  renderWorkstation(ws) {
    const type = ws.workstation_type || 'desk';
    const label = `${ws.name || 'Workstation'} — ${WORKSTATION_TYPE_LABELS[type] || 'Furnitur kantor'}`;
    const inner =
      type === 'terminal' ? this.renderServerRack(ws)
      : type === 'conference_table' ? this.renderConferenceTable(ws)
      : type === 'couch' ? this.renderCouch(ws)
      : type === 'command_pod' ? this.renderCommandPod(ws)
      : type === 'reception' ? this.renderReception(ws)
      : type === 'library_table' ? this.renderLibraryTable(ws)
      : type === 'coffee_bar' ? this.renderCoffeeBar(ws)
      : type === 'executive_desk' ? this.renderDesk(ws, { w: 58, h: 30, accent: '#eab308', mug: '#ffcf6b', dual: true })
      : type === 'qa_bench' ? this.renderDesk(ws, { w: 46, h: 26, accent: '#f59e0b', mug: '#e0574f', extra: 'bug' })
      : type === 'design_bench' ? this.renderDesk(ws, { w: 46, h: 26, accent: '#06b6d4', mug: '#4f8a8b', extra: 'palette' })
      : type === 'creative_bench' ? this.renderDesk(ws, { w: 46, h: 26, accent: '#ec4899', mug: '#8a5a3b', extra: 'palette' })
      : type === 'bench' ? this.renderDesk(ws, { w: 46, h: 26, accent: '#8b5cf6', mug: '#4f8a8b' })
      : this.renderDesk(ws, { w: 44, h: 26, accent: '#3b82f6', mug: '#d05a4a' });

    return `<g class="td-furniture" data-ws-id="${esc(ws.id)}" data-name="${esc(label)}">${inner}</g>`;
  }

  /**
   * Desk glyph, drawn slightly north of the seat point so an agent standing
   * on the workstation coordinate appears seated in front of the desk.
   */
  renderDesk(ws, opts = {}) {
    const w = opts.w || 44;
    const h = opts.h || 26;
    const x = (ws.position_x || 0) - w / 2;
    const y = (ws.position_y || 0) - 14 - h / 2;
    const cx = x + w / 2;

    let extras = '';
    if (opts.dual) {
      extras = `
        <rect x="${cx - 20}" y="${y + 3}" width="17" height="9" rx="1.5" fill="#23262b" stroke="#0f1114"/>
        <rect x="${cx - 18.5}" y="${y + 4.5}" width="14" height="6" fill="#7fd4e8" class="glowM"/>
        <rect x="${cx + 3}" y="${y + 3}" width="17" height="9" rx="1.5" fill="#23262b" stroke="#0f1114"/>
        <rect x="${cx + 4.5}" y="${y + 4.5}" width="14" height="6" fill="#7fd4e8" class="glowM"/>`;
    } else {
      extras = `
        <rect x="${cx - 12}" y="${y + 2.5}" width="24" height="9.5" rx="1.5" fill="#23262b" stroke="#0f1114"/>
        <rect x="${cx - 10.5}" y="${y + 4}" width="21" height="6.5" fill="#7fd4e8" class="glowM"/>
        <rect x="${cx - 8}" y="${y + 14}" width="16" height="5" rx="1.5" fill="#2c3036"/>
        <line x1="${cx - 6}" y1="${y + 16.5}" x2="${cx + 6}" y2="${y + 16.5}" stroke="#3d434b" stroke-width="1"/>`;
    }
    if (opts.extra === 'palette') {
      extras += `
        <circle cx="${x + 7}" cy="${y + h - 4}" r="2" fill="#e0574f"/>
        <circle cx="${x + 12}" cy="${y + h - 4}" r="2" fill="#4f8adb"/>
        <circle cx="${x + 17}" cy="${y + h - 4}" r="2" fill="#e0b64f"/>`;
    }
    if (opts.extra === 'bug') {
      extras += `<circle cx="${x + 9}" cy="${y + h - 4}" r="2.2" fill="#e0574f"/><line x1="${x + 6.5}" y1="${y + h - 4}" x2="${x + 11.5}" y2="${y + h - 4}" stroke="#7a2f28" stroke-width="1"/>`;
    }

    return `
      <ellipse cx="${x + w / 2}" cy="${y + h / 2 + 3}" rx="${w / 2 + 3}" ry="${h / 2}" fill="rgba(0,0,0,0.10)"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#c59a68" stroke="#a87f4f" stroke-width="1.5"/>
      <rect x="${x + 3}" y="${y + 3}" width="${w - 6}" height="${h - 6}" rx="2" fill="none" stroke="rgba(255,255,255,0.25)"/>
      ${extras}
      <circle cx="${x + w - 7}" cy="${y + h - 5}" r="3" fill="${opts.mug || '#d05a4a'}" stroke="${shade(opts.mug || '#d05a4a')}" stroke-width="1"/>
      <circle cx="${x + w - 4.5}" cy="${y + 4.5}" r="1.8" fill="#7fe08f" class="td-led"/>`;
  }

  renderServerRack(ws) {
    const x = (ws.position_x || 0) - 13;
    const y = (ws.position_y || 0) - 10 - 23;
    const ledColors = ['#7fe08f', '#ffcf6b', '#ff8f6b', '#7fe08f', '#6fb6ff'];
    let rows = '';
    for (let i = 0; i < 5; i++) {
      const ly = y + 7 + i * 8;
      rows += `
        <line x1="${x + 1.5}" y1="${ly + 3.5}" x2="${x + 24.5}" y2="${ly + 3.5}" stroke="#333a41" stroke-width="1"/>
        <circle cx="${x + 5.5}" cy="${ly + 1.5}" r="1.7" fill="${ledColors[i]}" class="td-led" style="animation-delay:${(-i * 0.5).toFixed(2)}s"/>
        <circle cx="${x + 10.5}" cy="${ly + 1.5}" r="1.7" fill="${ledColors[(i + 2) % 5]}" class="td-led" style="animation-delay:${(-i * 0.7).toFixed(2)}s"/>`;
    }
    return `
      <ellipse cx="${ws.position_x}" cy="${ws.position_y - 8}" rx="16" ry="8" fill="rgba(0,0,0,0.14)"/>
      <rect x="${x}" y="${y}" width="26" height="46" rx="2.5" fill="#23262b" stroke="#101215" stroke-width="1.5"/>
      ${rows}
      <line x1="${x + 19}" y1="${y + 3}" x2="${x + 19}" y2="${y + 43}" stroke="#2e353c" stroke-width="1" stroke-dasharray="3 3"/>`;
  }

  renderConferenceTable(ws) {
    const cx = ws.position_x || 0;
    const cy = ws.position_y || 0;
    const chair = (x, y, dir) => {
      const back =
        dir === 'n' ? `<rect x="${x - 9}" y="${y - 11}" width="18" height="4.5" rx="2" fill="#b98d5f" stroke="#a87f4f"/>`
        : dir === 's' ? `<rect x="${x - 9}" y="${y + 6.5}" width="18" height="4.5" rx="2" fill="#b98d5f" stroke="#a87f4f"/>`
        : dir === 'w' ? `<rect x="${x - 11}" y="${y - 9}" width="4.5" height="18" rx="2" fill="#b98d5f" stroke="#a87f4f"/>`
        : `<rect x="${x + 6.5}" y="${y - 9}" width="4.5" height="18" rx="2" fill="#b98d5f" stroke="#a87f4f"/>`;
      return `<ellipse cx="${x}" cy="${y + 1.5}" rx="9" ry="6.5" fill="rgba(0,0,0,0.10)"/><rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="3.5" fill="#c9a36a" stroke="#a87f4f" stroke-width="1.4"/>${back}`;
    };
    return `
      <ellipse cx="${cx}" cy="${cy + 2}" rx="52" ry="30" fill="rgba(0,0,0,0.10)"/>
      ${chair(cx, cy - 32, 'n')}
      ${chair(cx, cy + 32, 's')}
      ${chair(cx - 52, cy, 'w')}
      ${chair(cx + 52, cy, 'e')}
      <rect x="${cx - 46}" y="${cy - 26}" width="92" height="52" rx="20" fill="#a9784f" stroke="#8a5f3e" stroke-width="2"/>
      <rect x="${cx - 39}" y="${cy - 19}" width="78" height="38" rx="15" fill="none" stroke="rgba(255,255,255,0.2)"/>
      <rect x="${cx - 9}" y="${cy - 6}" width="18" height="12" rx="2" fill="#2c3036" stroke="#171a1e"/>
      <line x1="${cx - 6}" y1="${cy + 9}" x2="${cx + 6}" y2="${cy + 9}" stroke="#4a5158" stroke-width="1.5"/>
      <rect x="${cx + 14}" y="${cy - 12}" width="12" height="8.5" rx="1.5" fill="#f4ead2" stroke="#c9b287"/>
      <line x1="${cx + 16}" y1="${cy - 8}" x2="${cx + 24}" y2="${cy - 8.5}" stroke="#8b7a63" stroke-width="1"/>
      <circle cx="${cx - 24}" cy="${cy + 9}" r="2.8" fill="#f2ede1" stroke="#c9b287"/>`;
  }

  renderCouch(ws) {
    const cx = ws.position_x || 0;
    const cy = (ws.position_y || 0) - 6;
    return `
      <ellipse cx="${cx}" cy="${cy + 2}" rx="32" ry="15" fill="rgba(0,0,0,0.10)"/>
      <rect x="${cx - 28}" y="${cy - 13}" width="56" height="26" rx="8" fill="#c96f5e" stroke="#a35245" stroke-width="1.5"/>
      <rect x="${cx - 25}" y="${cy - 11}" width="50" height="7" rx="3" fill="#b25c4d"/>
      <rect x="${cx - 23}" y="${cy - 2}" width="22" height="13" rx="4" fill="#d8826d" stroke="#b25c4d"/>
      <rect x="${cx + 1}" y="${cy - 2}" width="22" height="13" rx="4" fill="#d8826d" stroke="#b25c4d"/>`;
  }

  renderCommandPod(ws) {
    const cx = ws.position_x || 0;
    const cy = (ws.position_y || 0) - 6;
    return `
      <ellipse cx="${cx}" cy="${cy + 2}" rx="26" ry="15" fill="rgba(0,0,0,0.14)"/>
      <circle cx="${cx}" cy="${cy}" r="20" fill="#1e293b" stroke="#3b82f6" stroke-width="1.5"/>
      <circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="#1d4ed8" stroke-width="1" stroke-dasharray="4 3"/>
      <circle cx="${cx}" cy="${cy}" r="9" fill="#0f172a"/>
      <circle cx="${cx}" cy="${cy}" r="4.5" fill="#06b6d4" class="glowM"/>
      <circle cx="${cx - 11}" cy="${cy - 7}" r="1.8" fill="#10b981" class="td-led"/>
      <circle cx="${cx + 11}" cy="${cy - 7}" r="1.8" fill="#06b6d4" class="td-led" style="animation-delay:-1.1s"/>
      <circle cx="${cx - 11}" cy="${cy + 9}" r="1.8" fill="#3b82f6" class="td-led" style="animation-delay:-2s"/>
      <circle cx="${cx + 11}" cy="${cy + 9}" r="1.8" fill="#f59e0b" class="td-led" style="animation-delay:-0.6s"/>`;
  }

  renderReception(ws) {
    const cx = ws.position_x || 0;
    const cy = (ws.position_y || 0) - 8;
    return `
      <ellipse cx="${cx}" cy="${cy + 2}" rx="28" ry="14" fill="rgba(0,0,0,0.10)"/>
      <rect x="${cx - 24}" y="${cy - 10}" width="48" height="20" rx="4" fill="#9a7a52" stroke="#7c6242" stroke-width="1.8"/>
      <rect x="${cx - 20}" y="${cy - 7}" width="40" height="14" rx="2" fill="none" stroke="rgba(255,255,255,0.18)"/>
      <rect x="${cx - 8}" y="${cy - 5}" width="16" height="9" rx="1.5" fill="#23262b"/>
      <rect x="${cx - 6.5}" y="${cy - 3.5}" width="13" height="6" fill="#7fd4e8" class="glowM"/>
      <circle cx="${cx + 16}" cy="${cy}" r="6" fill="#e8d9b0" stroke="#c9b287"/>
      <circle cx="${cx + 16}" cy="${cy}" r="2.5" fill="#d05a4a" opacity="0.85"/>`;
  }

  /** Library reading table: long oak table, desk lamp, two chairs. */
  renderLibraryTable(ws) {
    const cx = ws.position_x || 0;
    const cy = (ws.position_y || 0) - 12;
    const chair = (x, y, backNorth) => `
      <ellipse cx="${x}" cy="${y + 1.5}" rx="9" ry="6.5" fill="rgba(0,0,0,0.10)"/>
      <rect x="${x - 8}" y="${y - 8}" width="16" height="16" rx="3.5" fill="#c9a36a" stroke="#a87f4f" stroke-width="1.4"/>
      ${backNorth ? `<rect x="${x - 9}" y="${y - 11}" width="18" height="4.5" rx="2" fill="#b98d5f" stroke="#a87f4f"/>` : `<rect x="${x - 9}" y="${y + 6.5}" width="18" height="4.5" rx="2" fill="#b98d5f" stroke="#a87f4f"/>`}`;
    return `
      <ellipse cx="${cx}" cy="${cy + 3}" rx="42" ry="16" fill="rgba(0,0,0,0.10)"/>
      ${chair(cx, cy - 20, false)}
      ${chair(cx, cy + 20, true)}
      <rect x="${cx - 40}" y="${cy - 12}" width="80" height="24" rx="4" fill="#a9784f" stroke="#8a5f3e" stroke-width="1.8"/>
      <rect x="${cx - 34}" y="${cy - 8}" width="68" height="16" rx="3" fill="none" stroke="rgba(255,255,255,0.22)"/>
      <rect x="${cx - 10}" y="${cy - 8}" width="12" height="8" rx="1.5" fill="#2c3036"/>
      <rect x="${cx - 8.5}" y="${cy - 6.5}" width="9" height="5" fill="#7fd4e8" class="glowM"/>
      <rect x="${cx + 12}" y="${cy - 7}" width="12" height="9" rx="1" fill="#4f8adb"/>
      <rect x="${cx + 14}" y="${cy - 5.5}" width="8" height="6" fill="#f4ead2"/>
      <circle cx="${cx - 24}" cy="${cy + 5}" r="2.4" fill="#e0b64f"/>`;
  }

  /** Espresso bar: counter with machine, three stools facing south. */
  renderCoffeeBar(ws) {
    const cx = ws.position_x || 0;
    const cy = (ws.position_y || 0) - 12;
    let stools = '';
    for (const dx of [-26, 0, 26]) {
      stools += `
        <ellipse cx="${cx + dx}" cy="${cy + 26}" rx="7" ry="4.5" fill="rgba(0,0,0,0.12)"/>
        <circle cx="${cx + dx}" cy="${cy + 24}" r="5.5" fill="#b3554d" stroke="#8f423b" stroke-width="1.3"/>
        <circle cx="${cx + dx}" cy="${cy + 24}" r="2" fill="#e8d9b0"/>`;
    }
    return `
      <ellipse cx="${cx}" cy="${cy + 2}" rx="40" ry="14" fill="rgba(0,0,0,0.10)"/>
      ${stools}
      <rect x="${cx - 38}" y="${cy - 12}" width="76" height="18" rx="3" fill="#9a7a52" stroke="#7c6242" stroke-width="1.8"/>
      <rect x="${cx - 32}" y="${cy - 9}" width="64" height="12" rx="2" fill="none" stroke="rgba(255,255,255,0.2)"/>
      <rect x="${cx - 24}" y="${cy - 11}" width="16" height="11" rx="1.5" fill="#23262b" stroke="#101215"/>
      <circle cx="${cx - 16}" cy="${cy - 5.5}" r="2.2" fill="#ff8f6b" class="td-led"/>
      <circle cx="${cx - 2}" cy="${cy - 4}" r="3.2" fill="#f4ead2" stroke="#c9b287"/>
      <circle cx="${cx - 2}" cy="${cy - 4}" r="1.4" fill="#8a5a3b"/>
      <circle cx="${cx + 14}" cy="${cy - 4}" r="3.2" fill="#f4ead2" stroke="#c9b287"/>
      <circle cx="${cx + 14}" cy="${cy - 4}" r="1.4" fill="#d05a4a"/>
      <rect x="${cx + 26}" y="${cy - 6}" width="9" height="7" rx="1" fill="#e0b64f" stroke="#b8943a"/>`;
  }

  /* ------------------------------------------------------------------ */
  /* Agents render on the PixiJS layer (see office/pixi-agents.js)       */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* FX (night veil)                                                     */
  /* ------------------------------------------------------------------ */

  renderFx() {
    return `<rect class="nightveil" x="${BOUNDS.x - 6}" y="${BOUNDS.y - 8}" width="${BOUNDS.w + 16}" height="${BOUNDS.h + 20}" fill="#0d1522" pointer-events="none"/>`;
  }

  /* ------------------------------------------------------------------ */
  /* Scene composition                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Full static scene for the rooms layer: corridor floors → building walls
   * → room floors/walls. Doors leave gaps in both the room border and the
   * building outline because they open onto corridor space.
   */
  renderScene(rooms = [], corridors = []) {
    return `
      ${this.renderCorridors(corridors)}
      ${this.renderWalls(rooms, corridors)}
      ${this.renderRooms(rooms)}
      ${this.renderHitTestLayer(rooms, corridors)}
    `;
  }

  /* ------------------------------------------------------------------ */
  /* Hit-Test Layer (invisible shapes for room/furniture/decor clicks)   */
  /* ------------------------------------------------------------------ */

  renderHitTestLayer(rooms = [], corridors = []) {
    const roomsHit = rooms.map((room) => {
      const { id, name, position_x: px, position_y: py, width: w, height: h, department } = room;
      return `<rect class="td-hit-test-room" x="${px + 1}" y="${py + 1}" width="${w - 2}" height="${h - 2}" rx="2" data-name="${esc(name)} — ${esc(department || 'General')}" pointer-events="all"/>`;
    }).join('\n');

    const corridorsHit = (corridors && corridors.length ? corridors : DEFAULT_CORRIDORS).map((c) => {
      return `<rect class="td-hit-test-corridor" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" data-name="Koridor ${c.id}" pointer-events="all"/>`;
    }).join('\n');

    // Note: Furniture/decor hit-test will be added via separate method for dynamic workstations
    return `<g id="hit-test-layer" pointer-events="all" style="display: none;">\n${roomsHit}\n${corridorsHit}\n</g>`;
  }

  /* Helper: render hit-test shapes for furniture/workstations */
  renderFurnitureHitTest(workstations = []) {
    return workstations.map((ws) => {
      const { id, name, position_x: px, position_y: py, width: w, height: h, workstation_type } = ws;
      const label = `${name || 'Workstation'} — ${WORKSTATION_TYPE_LABELS[workstation_type] || 'Furnitur kantor'}`;
      return `<rect class="td-hit-test-furniture" x="${px}" y="${py}" width="${w}" height="${h}" rx="4" data-name="${esc(label)}" pointer-events="all"/>`;
    }).join('\n');
  }
}

export const topdownRenderer = new TopdownRenderer();
export default topdownRenderer;
