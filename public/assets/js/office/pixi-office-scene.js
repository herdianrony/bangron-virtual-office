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

const FLOOR = 0xe8e2d4;
const CORRIDOR = 0xd6cbae;
const WALL = 0x6b6252;
const ROOM_STROKE = 0x8a7f6a;
const DOOR_GAP = 24;
const NIGHT = 0x0b1220;

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
    floor.removeChildren().forEach((c) => c.destroy());
    corridor.removeChildren().forEach((c) => c.destroy());
    room.removeChildren().forEach((c) => c.destroy());
    furniture.removeChildren().forEach((c) => c.destroy());
    label.removeChildren().forEach((c) => c.destroy());
    this.hitAreas = [];

    const b = this.state.building;
    floor.addChild(new Graphics().rect(b.x, b.y, b.w, b.h).fill(FLOOR).stroke({ width: 3, color: WALL }));

    for (const c of this.state.corridors) {
      corridor.addChild(new Graphics()
        .rect(c.x, c.y, c.w, c.h)
        .fill({ color: CORRIDOR })
        .stroke({ width: 0.6, color: 0xb9ad92 }));
      this.hitAreas.push({ rect: new Rectangle(c.x, c.y, c.w, c.h), kind: 'corridor', name: `Koridor ${c.id}` });
    }

    for (const r of this.state.rooms) {
      const x = Number(r.position_x ?? r.px) || 0;
      const y = Number(r.position_y ?? r.py) || 0;
      const w = Number(r.width ?? r.w) || 60;
      const h = Number(r.height ?? r.h) || 60;
      const dept = r.department || 'General';
      const color = colorToNumber(DEPARTMENT_COLORS[dept] || '#6b7280');

      const g = new Graphics()
        .rect(x, y, w, h)
        .fill({ color, alpha: 0.16 })
        .stroke({ width: 2, color: ROOM_STROKE });
      room.addChild(g);
      this._drawDoor(g, r, x, y, w, h);
      this.hitAreas.push({ rect: new Rectangle(x, y, w, h), kind: 'room', id: r.id, name: `${r.name} — ${dept}` });

      const text = new Text({
        text: r.name || r.id,
        style: { fontSize: 17, fontWeight: '700', fill: 0x334155, fontFamily: 'sans-serif', align: 'center' }
      });
      text.resolution = 2;
      text.anchor.set(0.5);
      text.position.set(x + w / 2, y + h / 2 - 6);
      label.addChild(text);
    }

    for (const ws of this.state.workstations) {
      const x = Number(ws.position_x);
      const y = Number(ws.position_y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const [w, h] = FURNITURE[ws.workstation_type || 'desk'] || FURNITURE.desk;
      const g = new Graphics()
        .roundRect(x - w / 2, y - h / 2, w, h, 4)
        .fill({ color: 0xb9956a })
        .stroke({ width: 1, color: 0x7c5f3e });
      furniture.addChild(g);
      this.hitAreas.push({ rect: new Rectangle(x - w / 2, y - h / 2, w, h), kind: 'furniture', id: ws.id, name: ws.name || 'Workstation' });
    }
  }

  _drawDoor(g, room, x, y, w, h) {
    const side = room.door?.side || 'S';
    const mid = doorPoint(room);
    g.rect(mid.x - DOOR_GAP / 2, mid.y - 1, DOOR_GAP, 2).fill({ color: FLOOR });
    if (side === 'N' || side === 'S') {
      g.moveTo(mid.x - DOOR_GAP / 2, mid.y).lineTo(mid.x - DOOR_GAP / 2, mid.y + (side === 'N' ? -14 : 14))
        .stroke({ width: 1, color: WALL });
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
      rig.root.position.set(x, y);
      rig.halo.clear().circle(0, 0, 20).stroke({ width: 2.4, color: colorToNumber(STATUS_HALO_COLORS[a.status] || '#6b7280'), alpha: 0.85 });
      rig.tagText.text = String(a.display_name || a.id).replace('[DEMO] ', '').slice(0, 20);
      rig.tagBg.clear().roundRect(-rig.tagText.width / 2 - 6, -12, rig.tagText.width + 12, 18, 4).fill({ color: 0x0f172a, alpha: 0.9 });
    }
    for (const [id, rig] of this.agents) {
      if (!seen.has(id)) { rig.root.destroy({ children: true }); this.agents.delete(id); }
    }
  }

  _buildAgent(agent) {
    const root = new Container();
    const dept = colorToNumber(DEPARTMENT_COLORS[agent.department] || '#3b82f6');
    const shadow = new Graphics().ellipse(0, 3, 18, 13).fill({ color: 0x000000, alpha: 0.3 });
    const halo = new Graphics();
    const body = new Graphics().ellipse(0, 0, 13, 10).fill(dept).stroke({ width: 2, color: 0x334155 });
    const head = new Graphics().circle(0, -2, 9).fill(0x2b241f);
    const face = new Graphics().ellipse(0, -2, 4.5, 3).fill(0xe0a87e);
    const tagText = new Text({ text: '', style: { fontSize: 12, fontWeight: '700', fill: '#f8fafc', fontFamily: 'sans-serif' } });
    tagText.resolution = 3; tagText.anchor.set(0.5); tagText.position.set(0, 38);
    const tagBg = new Graphics();
    root.addChild(shadow, halo, body, head, face, tagBg, tagText);
    root.eventMode = 'static';
    root.cursor = 'pointer';
    root.hitArea = new Circle(0, 0, 16);
    root.on('pointertap', (e) => {
      e.stopPropagation();
      this.onAgentClick?.(agent.id);
    });
    return { root, halo, tagText, tagBg };
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
