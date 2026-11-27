/**
 * Bangron Virtual Office — PixiJS-first scene renderer.
 *
 * Satu Application PixiJS menggambar SELURUH kantor: lantai, koridor, ruang,
 * dinding + pintu, furnitur, label, agen, dan lighting malam. Tidak ada lagi
 * layer SVG; satu canvas, satu transform kamera, satu sumber kebenaran state.
 *
 * Kontrak (sengaja kompatibel dengan office-view lama):
 *   await scene.init(hostElement)
 *   scene.setState({ rooms, workstations, corridors, building })
 *   scene.setAgents(agents)            // agen dari store/movement engine
 *   scene.applyCamera({panX,panY,scale})
 *   scene.setNight(boolean)
 *   scene.resize()
 *   scene.pick(clientX, clientY)       // -> { kind, id, name } | null
 *   scene.destroy()
 */
import { Application, Container, Graphics, Text, Circle, Rectangle } from '../vendor/pixi.mjs';
import { DEPARTMENT_COLORS, STATUS_HALO_COLORS, colorToNumber } from './palette.js';
import { VISUAL_BOUNDS, VISUAL_ROOMS, VISUAL_ZONES, VISUAL_CORRIDORS, VISUAL_THEME, mapToVisual } from './visual-layout.js';

const FLOOR = VISUAL_THEME.floor;
const FLOOR_GRID = VISUAL_THEME.grid;
const CORRIDOR = VISUAL_THEME.corridor;
const WALL = VISUAL_THEME.wall;
const NIGHT = VISUAL_THEME.night;

const DEFAULT_BUILDING = { x: 14, y: 14, w: 992, h: 668 };
const DEFAULT_CORRIDORS = [
  { id: 'corr_main', x: 30, y: 295, w: 940, h: 45 },
  { id: 'corr_south', x: 30, y: 480, w: 940, h: 45 },
  { id: 'corr_cross', x: 455, y: 30, w: 45, h: 620 }
];

const FURNITURE = {
  desk: [50, 34], dev_desk: [50, 34], executive_desk: [64, 40],
  bench: [52, 36], qa_bench: [52, 36], design_bench: [52, 36],
  creative_bench: [52, 36], library_table: [86, 52], coffee_bar: [82, 50],
  conference_table: [110, 68], command_pod: [46, 46], terminal: [32, 48],
  couch: [62, 34], reception: [54, 34]
};

/** Pure helper: door midpoint for a room, exported for tests. */
export function doorPoint(room) {
  const x = Number(room.position_x ?? room.px ?? 0);
  const y = Number(room.position_y ?? room.py ?? 0);
  const w = Number(room.width ?? room.w ?? 0);
  const h = Number(room.height ?? room.h ?? 0);
  const side = room.door?.side || 'S';
  if (side === 'N') return { x: x + w / 2, y };
  if (side === 'S') return { x: x + w / 2, y: y + h };
  if (side === 'W') return { x, y: y + h / 2 };
  return { x: x + w, y: y + h / 2 };
}

export class PixiOfficeScene {
  constructor() {
    this.app = null;
    this.world = null;
    this.layers = {};
    this.state = { rooms: [], workstations: [], corridors: DEFAULT_CORRIDORS, building: DEFAULT_BUILDING };
    this.agents = new Map();
    this.hitAreas = [];
    this.night = false;
    this.camera = { panX: 0, panY: 0, scale: 1 };
    this._resizeObserver = null;
  }

  async init(host) {
    if (this.app) return;
    this.host = host;
    this.app = new Application();
    await this.app.init({
      background: '#111827',
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      width: host.clientWidth || 960,
      height: host.clientHeight || 640
    });
    this.app.canvas.id = 'office-pixi-canvas';
    this.app.canvas.className = 'office-scene-canvas';
    host.appendChild(this.app.canvas);

    this.world = new Container();
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    for (const name of ['floor', 'corridor', 'room', 'furniture', 'label', 'agent', 'fx']) {
      const layer = new Container();
      layer.zIndex = ['floor', 'corridor', 'room', 'furniture', 'label', 'agent', 'fx'].indexOf(name);
      this.layers[name] = layer;
      this.world.addChild(layer);
    }
    this.nightVeil = new Graphics();
    this.app.stage.addChild(this.nightVeil);

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(host);
    this.resize();
    this._applyCamera();
  }

  getBounds() { return VISUAL_BOUNDS; }

  setState(state = {}) {
    this.state = {
      rooms: state.rooms || [],
      workstations: state.workstations || [],
      corridors: state.corridors?.length ? state.corridors : DEFAULT_CORRIDORS,
      building: state.building || DEFAULT_BUILDING
    };
    this._drawScene();
  }

  _drawScene() {
    const { floor, corridor, room, furniture, label } = this.layers;
    for (const layer of [floor, corridor, room, furniture, label]) {
      layer.removeChildren().forEach((c) => c.destroy());
    }
    this.hitAreas = [];

    const b = VISUAL_BOUNDS;
    const base = new Graphics().roundRect(b.x, b.y, b.w, b.h, 18).fill(FLOOR).stroke({ width: 3, color: WALL });
    for (let gx = b.x + 40; gx < b.x + b.w; gx += 40) {
      base.moveTo(gx, b.y).lineTo(gx, b.y + b.h).stroke({ width: 0.5, color: FLOOR_GRID, alpha: 0.5 });
    }
    for (let gy = b.y + 40; gy < b.y + b.h; gy += 40) {
      base.moveTo(b.x, gy).lineTo(b.x + b.w, gy).stroke({ width: 0.5, color: FLOOR_GRID, alpha: 0.5 });
    }
    floor.addChild(base);

    // Architectural zones from the reference floor plan (carport, lobby, etc.)
    for (const z of VISUAL_ZONES) {
      const zc = colorToNumber(z.accent);
      const g = new Graphics().roundRect(z.x, z.y, z.w, z.h, 6).fill({ color: zc, alpha: 0.1 }).stroke({ width: 1.5, color: zc, alpha: 0.35 });
      room.addChild(g);
      const t = new Text({ text: z.label, style: { fontSize: 18, fontWeight: '700', fill: 0x475569, fontFamily: 'sans-serif' } });
      t.resolution = 2; t.anchor.set(0.5, 1); t.position.set(z.x + z.w / 2, z.y + z.h - 8);
      label.addChild(t);
    }

    // Cars & motorcycles in the carport.
    const carport = VISUAL_ZONES.find((z) => z.id === 'carport');
    if (carport) {
      for (const cx of [carport.x + 140, carport.x + 300]) {
        room.addChild(new Graphics().roundRect(cx - 42, carport.y + 30, 84, 150, 26).fill({ color: 0x94a3b8, alpha: 0.35 }).stroke({ width: 1.5, color: 0x64748b }));
        room.addChild(new Graphics().roundRect(cx - 28, carport.y + 52, 56, 52, 14).fill({ color: 0x64748b, alpha: 0.5 }));
      }
      for (const mx of [carport.x + 540, carport.x + 610, carport.x + 680]) {
        room.addChild(new Graphics().ellipse(mx, carport.y + 130, 12, 30).fill({ color: 0x94a3b8, alpha: 0.45 }).stroke({ width: 1, color: 0x64748b }));
      }
    }

    // Two meeting-desk clusters in the open-space area.
    for (const [cx, cy] of [[135, 280], [335, 280], [135, 455], [335, 455]]) {
      furniture.addChild(new Graphics().roundRect(cx - 55, cy - 34, 110, 68, 8).fill({ color: 0xc49b6a, alpha: 0.8 }).stroke({ width: 1, color: 0x92704e }));
      for (const dx of [-42, 42]) for (const dy of [-22, 22]) {
        furniture.addChild(new Graphics().circle(cx + dx, cy + dy, 9).fill({ color: 0x64748b, alpha: 0.75 }));
      }
    }

    for (const c of VISUAL_CORRIDORS) {
      corridor.addChild(new Graphics()
        .roundRect(c.x, c.y, c.w, c.h, 8)
        .fill({ color: CORRIDOR, alpha: 0.85 })
        .stroke({ width: 1, color: 0x38bdf8, alpha: 0.25 }));
      this.hitAreas.push({ rect: new Rectangle(c.x, c.y, c.w, c.h), kind: 'corridor', name: `Koridor ${c.id}` });
    }

    const canonical = new Map(this.state.rooms.map((r) => [r.id, r]));
    for (const [id, v] of Object.entries(VISUAL_ROOMS)) {
      const meta = canonical.get(id) || { name: id, department: 'General', door: { side: 'S' } };
      const dept = meta.department || 'General';
      const accent = colorToNumber(v.accent || DEPARTMENT_COLORS[dept] || '#6b7280');
      const g = new Graphics()
        .roundRect(v.x, v.y, v.w, v.h, 12)
        .fill({ color: accent, alpha: 0.13 })
        .stroke({ width: 2, color: accent, alpha: 0.55 });
      g.rect(v.x + 12, v.y, Math.min(v.w - 24, 70), 4).fill({ color: accent, alpha: 0.9 });
      g.circle(v.x + v.w - 18, v.y + 18, 4).fill({ color: accent, alpha: 0.8 });
      room.addChild(g);
      this.hitAreas.push({ rect: new Rectangle(v.x, v.y, v.w, v.h), kind: 'room', id, name: `${meta.name || id} — ${dept}` });

      const title = new Text({
        text: String(v.label || meta.name || id).toUpperCase(),
        style: { fontSize: 20, fontWeight: '800', fill: 0x334155, fontFamily: 'sans-serif', letterSpacing: 1 }
      });
      title.resolution = 2; title.anchor.set(0.5, 0);
      title.position.set(v.x + v.w / 2, v.y + 14);
      label.addChild(title);
      const sub = new Text({
        text: v.sub || dept,
        style: { fontSize: 14, fontWeight: '600', fill: 0x64748b, fontFamily: 'sans-serif' }
      });
      sub.resolution = 2; sub.anchor.set(0.5, 0);
      sub.position.set(v.x + v.w / 2, v.y + 32);
      label.addChild(sub);
    }

    for (const ws of this.state.workstations) {
      const mapped = mapToVisual(Number(ws.position_x), Number(ws.position_y), this.state.rooms, this.state.building);
      const [w, h] = FURNITURE[ws.workstation_type || 'desk'] || FURNITURE.desk;
      const g = new Graphics()
        .roundRect(mapped.x - w / 2, mapped.y - h / 2, w, h, 5)
        .fill({ color: 0x64748b, alpha: 0.55 })
        .stroke({ width: 1, color: 0x94a3b8, alpha: 0.5 });
      furniture.addChild(g);
      this.hitAreas.push({ rect: new Rectangle(mapped.x - w / 2, mapped.y - h / 2, w, h), kind: 'furniture', id: ws.id, name: ws.name || 'Workstation' });
    }
  }

  setAgents(agents = []) {
    const layer = this.layers.agent;
    const seen = new Set();
    for (const a of agents) {
      if (!a || !a.id) continue;
      seen.add(a.id);
      let rig = this.agents.get(a.id);
      if (!rig) {
        rig = this._buildAgent(a);
        this.agents.set(a.id, rig);
        layer.addChild(rig.root);
      }
      const x = Number.isFinite(Number(a.x)) ? Number(a.x) : Number(a.position_x) || 300;
      const y = Number.isFinite(Number(a.y)) ? Number(a.y) : Number(a.position_y) || 300;
      const mapped = mapToVisual(x, y, this.state.rooms, this.state.building);
      rig.root.position.set(mapped.x, mapped.y);
      const haloColor = colorToNumber(STATUS_HALO_COLORS[a.status] || '#6b7280');
      rig.aura.clear().circle(0, -2, 22).stroke({ width: 2.4, color: haloColor, alpha: 0.85 });
      this._animateAgentRig(rig, a);
      rig.tagText.text = String(a.display_name || a.id).replace('[DEMO] ', '').slice(0, 20);
      rig.tagBg.clear().roundRect(-rig.tagText.width / 2 - 6, 23, rig.tagText.width + 12, 18, 4).fill({ color: 0x0f172a, alpha: 0.9 });
    }
    for (const [id, rig] of this.agents) {
      if (!seen.has(id)) { rig.root.destroy({ children: true }); this.agents.delete(id); }
    }
  }

  _buildAgent(agent) {
    const root = new Container();
    const dept = colorToNumber(DEPARTMENT_COLORS[agent.department] || '#3b82f6');
    const skin = 0xf1c27d;
    const hair = 0x2b241f;

    // Ground shadow + status aura
    const shadow = new Graphics().ellipse(0, 10, 17, 7).fill({ color: 0x000000, alpha: 0.28 });
    const aura = new Graphics().circle(0, 0, 22).stroke({ width: 2.4, color: dept, alpha: 0.5 });
    root.addChild(shadow, aura);

    // Legs (animated by walk phase)
    const legL = new Graphics().roundRect(-7, 2, 6, 13, 2).fill(0x334155);
    const legR = new Graphics().roundRect(1, 2, 6, 13, 2).fill(0x334155);
    root.addChild(legL, legR);

    // Body: shirt in department color + collar + arms
    const body = new Graphics()
      .roundRect(-12, -10, 24, 22, 7)
      .fill(dept)
      .stroke({ width: 1.5, color: 0x1e293b, alpha: 0.6 });
    body.poly([-5, -10, 0, -4, 5, -10]).fill({ color: 0xffffff, alpha: 0.55 });
    const armL = new Graphics().roundRect(-17, -8, 6, 16, 3).fill(dept);
    const armR = new Graphics().roundRect(11, -8, 6, 16, 3).fill(dept);
    root.addChild(armL, body, armR);

    // Head: hair cap + face + eyes (direction-aware peeking)
    const head = new Graphics();
    head.circle(0, -14, 10).fill(hair);
    head.ellipse(0, -12, 7.5, 8).fill(skin);
    head.arc(0, -12, 8, Math.PI, 0).fill(hair);
    const eyes = new Graphics();
    root.addChild(head, eyes);

    // Name tag
    const tagText = new Text({ text: '', style: { fontSize: 15, fontWeight: '700', fill: '#f8fafc', fontFamily: 'sans-serif' } });
    tagText.resolution = 3; tagText.anchor.set(0.5); tagText.position.set(0, 32);
    const tagBg = new Graphics();
    root.addChild(tagBg, tagText);

    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Circle(0, -2, 20);
    root.on('pointertap', (e) => { e.stopPropagation(); this.onAgentClick?.(agent.id); });

    return { root, aura, legL, legR, armL, armR, eyes, body, tagText, tagBg, dept, phase: 0 };
  }

  _animateAgentRig(rig, agent) {
    const moving = !!agent.moving;
    if (moving) rig.phase = (rig.phase || 0) + 0.25;
    const swing = moving ? Math.sin(rig.phase) * 5 : 0;
    rig.legL.y = 2 + swing;
    rig.legR.y = 2 - swing;
    rig.armL.rotation = moving ? -swing * 0.04 : 0;
    rig.armR.rotation = moving ? swing * 0.04 : 0;

    // Eyes peek toward heading (top-down 4-way)
    const dir = String(agent.direction || 'SE');
    const dx = dir.includes('E') ? 3 : dir.includes('W') ? -3 : 0;
    const dy = dir.includes('S') ? 1 : dir.includes('N') ? -2 : 0;
    rig.eyes.clear()
      .circle(-3 + dx, -13 + dy, 1.6).fill(0x0f172a)
      .circle(3 + dx, -13 + dy, 1.6).fill(0x0f172a);
  }

  applyCamera(t = {}) {
    this.camera = { panX: t.panX ?? 0, panY: t.panY ?? 0, scale: t.scale ?? 1 };
    this._applyCamera();
  }

  _applyCamera() {
    if (!this.world) return;
    this.world.position.set(this.camera.panX, this.camera.panY);
    this.world.scale.set(this.camera.scale);
    this._drawNight();
  }

  setNight(enabled) {
    this.night = !!enabled;
    this._drawNight();
  }

  _drawNight() {
    if (!this.nightVeil || !this.app) return;
    const { width, height } = this.app.renderer;
    this.nightVeil.clear();
    if (this.night) this.nightVeil.rect(0, 0, width, height).fill({ color: NIGHT, alpha: 0.5 });
  }

  resize() {
    if (!this.app || !this.host) return;
    const w = this.host.clientWidth || 960;
    const h = this.host.clientHeight || 640;
    this.app.renderer.resize(w, h);
    this._drawNight();
  }

  pick(clientX, clientY) {
    if (!this.app) return null;
    const rect = this.app.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const wx = (sx - this.camera.panX) / this.camera.scale;
    const wy = (sy - this.camera.panY) / this.camera.scale;
    // Agents first (smallest target wins)
    for (const [id, rig] of this.agents) {
      const dx = wx - rig.root.x, dy = wy - rig.root.y;
      if (dx * dx + dy * dy <= 18 * 18) return { kind: 'agent', id };
    }
    const hits = this.hitAreas.filter((h) => h.rect.contains(wx, wy));
    if (!hits.length) return null;
    return hits[hits.length - 1];
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this.app?.destroy(true, { children: true });
    this.app = null;
  }
}

export default PixiOfficeScene;
