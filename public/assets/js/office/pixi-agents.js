/**
 * Bangron Virtual Office — PixiJS agent layer (top-down mode)
 *
 * Renders the dynamic agent layer (avatars, walking feet, halos, name tags,
 * speech bubbles) on a WebGL canvas composited on top of the static SVG
 * architectural floor plan. The SVG keeps drawing rooms, corridors, walls and
 * furniture (crisp vector architecture), while PixiJS owns everything that
 * moves every frame — no more per-frame SVG innerHTML rebuilds.
 *
 * Camera sync: the CameraController applies `translate(panX, panY) scale(s)`
 * to the SVG `#camera-viewport` group; the same numbers are applied to the
 * Pixi world container, so both layers stay pixel-aligned. The SVG has no
 * viewBox, so SVG user units == CSS pixels == Pixi screen units.
 */
import { Application, Container, Graphics, Sprite, Texture, Text } from '../vendor/pixi.mjs';
import { DEPARTMENT_COLORS, STATUS_HALO_COLORS, shade } from './palette.js';

const NIGHT_COLOR = 0x0d1522;
const NIGHT_ALPHA = 0.52; // matches .office-container.td-night .nightveil (CSS)

const BUBBLE_FILL = '#fff7e6';
const BUBBLE_STROKE = '#d8c39a';
const BUBBLE_TEXT = '#5d5145';
const TAG_FILL = 0x0f172a;
const TAG_ALPHA = 0.88;

// Face peek offset by heading (top-down), identical to the old SVG renderer.
const FACE_DIR = { NE: [0, -3.4], SE: [3.4, 0], SW: [0, 3.4], NW: [-3.4, 0] };
const PULSE_STATUSES = new Set(['working', 'thinking', 'collaborating']);

export class PixiAgentLayer {
  constructor() {
    this.app = null;
    this.world = null;
    this.overlay = null;
    this.agents = new Map(); // id -> rig
    this.footTexture = null;
    this.nightTarget = 0;
    this.nightCurrent = 0;
    this._elapsed = 0;
    this._hitList = [];
  }

  /** Creates the WebGL canvas behind the given SVG host element. */
  async init(hostSvg) {
    this.host = hostSvg;
    this.app = new Application();
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: 'webgl',
      width: hostSvg.clientWidth || 800,
      height: hostSvg.clientHeight || 600
    });
    this.app.canvas.id = 'office-pixi-canvas';
    hostSvg.parentNode.insertBefore(this.app.canvas, hostSvg.nextSibling);

    // World container mirrors the SVG camera viewport transform.
    this.world = new Container();
    this.world.sortableChildren = true;
    this.app.stage.addChild(this.world);

    // Screen-space night veil (agents must darken together with the SVG plan).
    this.overlay = new Graphics();
    this.app.stage.addChild(this.overlay);
    this._drawOverlay();

    // Shared foot shoe texture (vertical ellipse, rotated per heading).
    const footG = new Graphics()
      .ellipse(0, 0, 2.6, 3.8)
      .fill({ color: 0x3a2c1e })
      .stroke({ width: 0.5, color: 0x241b12 });
    this.footTexture = this.app.renderer.generateTexture(footG);
    footG.destroy();

    this.app.ticker.add((ticker) => this._tick(ticker.deltaMS));
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  _canvasSize() {
    const parent = this.app.canvas.parentNode;
    return {
      w: parent ? parent.clientWidth : window.innerWidth,
      h: parent ? parent.clientHeight : window.innerHeight
    };
  }

  _drawOverlay() {
    const { w, h } = this._canvasSize();
    this.overlay.clear().rect(0, 0, w, h).fill({ color: NIGHT_COLOR, alpha: 1 });
    this.overlay.alpha = this.nightCurrent;
  }

  resize() {
    if (!this.app) return;
    const { w, h } = this._canvasSize();
    this.app.renderer.resize(w, h);
    this._drawOverlay();
  }

  /** Mirrors the CameraController viewport transform. */
  applyCamera({ panX, panY, scale }) {
    if (!this.world) return;
    this.world.position.set(panX, panY);
    this.world.scale.set(scale);
  }

  setNight(enabled) {
    this.nightTarget = enabled ? NIGHT_ALPHA : 0;
  }

  /** Builds the full character rig once per agent. */
  _buildAgent(agent) {
    const root = new Container();

    const deptColor = DEPARTMENT_COLORS[agent.department] || '#3b82f6';
    const haloColor = STATUS_HALO_COLORS[agent.status] || '#6b7280';

    // Ground shadow
    const shadow = new Graphics()
      .ellipse(0, 1.5, 11, 8)
      .fill({ color: 0x000000, alpha: 0.35 });
    root.addChild(shadow);

    // Walking feet (shared texture, per-frame transform)
    const foot1 = new Sprite(this.footTexture);
    const foot2 = new Sprite(this.footTexture);
    foot1.anchor.set(0.5);
    foot2.anchor.set(0.5);
    root.addChild(foot1, foot2);

    // Status pulse ring (animated in the ticker when active)
    const pulse = new Graphics().circle(0, 0, 13).stroke({ width: 1.5, color: haloColor, alpha: 0.6 });
    root.addChild(pulse);

    // Halo ring (redrawn on status change)
    const halo = new Graphics().circle(0, 0, 13).stroke({ width: 1.8, color: haloColor, alpha: 0.85 });
    root.addChild(halo);

    // Body ellipse (department color)
    const body = new Graphics()
      .ellipse(0, 0, 7.5, 5.5)
      .fill(deptColor)
      .stroke({ width: 1.2, color: shade(deptColor, 22) });
    root.addChild(body);

    // Head + face peek
    const head = new Graphics().circle(0, -0.8, 5).fill(0x2b241f);
    root.addChild(head);
    const face = new Graphics().ellipse(0, 0, 2.7, 1.8).fill(0xe0a87e);
    root.addChild(face);

    // Name tag (bg width depends on the name, so keep bg + text in a sub-container)
    const tag = new Container();
    const tagBg = new Graphics();
    const tagText = new Text({
      text: (agent.display_name || 'Agent').replace('[DEMO] ', ''),
      style: { fontSize: 7.2, fontWeight: '600', fill: '#f8fafc', fontFamily: 'sans-serif' }
    });
    tagText.resolution = 3;
    tagText.anchor.set(0.5);
    tagText.position.set(0, -0.5);
    tag.addChild(tagBg, tagText);
    tag.position.set(0, 24);
    root.addChild(tag);

    // Speech / status bubble (rebuilt on text change)
    const bubble = new Container();
    bubble.visible = false;
    bubble.position.set(0, -22);
    const bubbleBg = new Graphics();
    const bubbleText = new Text({
      text: '',
      style: { fontSize: 7.2, fontWeight: '700', fill: BUBBLE_TEXT, fontFamily: 'sans-serif' }
    });
    bubbleText.resolution = 3;
    bubbleText.anchor.set(0.5);
    bubbleText.position.set(0, -3.8);
    bubble.addChild(bubbleBg, bubbleText);
    root.addChild(bubble);

    this.world.addChild(root);

    const rig = {
      root,
      shadow,
      foot1,
      foot2,
      pulse,
      halo,
      body,
      head,
      face,
      tag,
      tagBg,
      tagText,
      bubble,
      bubbleBg,
      bubbleText,
      lastStatus: null,
      lastHaloColor: null,
      lastDir: null,
      lastBubble: null,
      lastName: null,
      x: 0,
      y: 0
    };
    this._refreshTag(rig, agent);
    this._refreshStatus(rig, agent);
    return rig;
  }

  _refreshTag(rig, agent) {
    const name = (agent.display_name || 'Agent').replace('[DEMO] ', '');
    if (name === rig.lastName) return;
    rig.lastName = name;
    const w = Math.max(46, name.length * 5.8 + 14);
    rig.tagBg.clear().roundRect(-w / 2, -9, w, 12, 3).fill({ color: TAG_FILL, alpha: TAG_ALPHA }).stroke({ width: 0.7, color: rig.lastHaloColor || '#6b7280' });
    rig.tagText.text = name;
  }

  _refreshStatus(rig, agent) {
    const status = agent.status || 'idle';
    if (status === rig.lastStatus) return;
    rig.lastStatus = status;

    const haloColor = STATUS_HALO_COLORS[status] || '#6b7280';
    rig.lastHaloColor = haloColor;
    rig.halo.clear().circle(0, 0, 13).stroke({ width: 1.8, color: haloColor, alpha: 0.85 });
    rig.pulse.clear().circle(0, 0, 13).stroke({ width: 1.5, color: haloColor, alpha: 0.6 });
    rig.pulse.visible = PULSE_STATUSES.has(status);
    rig.tagBg.clear().roundRect(
      -(Math.max(46, (rig.lastName || '').length * 5.8 + 14)) / 2,
      -9,
      Math.max(46, (rig.lastName || '').length * 5.8 + 14),
      12,
      3
    ).fill({ color: TAG_FILL, alpha: TAG_ALPHA }).stroke({ width: 0.7, color: haloColor });
  }

  _bubbleTextFor(agent) {
    let t = '';
    if (agent.status === 'offline') t = 'Offline';
    else if (agent.status === 'walking') t = agent.move_note || agent.moveNote || 'Walking...';
    else if (agent.status === 'thinking') t = 'Thinking...';
    else if (agent.status === 'collaborating') t = 'Syncing...';
    else if (agent.status === 'waiting') t = 'Approval Req';
    else if (agent.current_tool) t = `Tool: ${agent.current_tool}`;
    else if (agent.active_task_title) t = agent.active_task_title.substring(0, 18) + '...';
    t = t ? t.replace('[DEMO] ', '').substring(0, 34) : '';
    return t;
  }

  _refreshBubble(rig, agent) {
    const t = this._bubbleTextFor(agent);
    if (t === rig.lastBubble) return;
    rig.lastBubble = t;
    if (!t) {
      rig.bubble.visible = false;
      return;
    }
    const w = t.length * 5.2 + 16;
    rig.bubbleBg.clear()
      .roundRect(-w / 2, -14, w, 14, 5)
      .fill({ color: BUBBLE_FILL })
      .stroke({ width: 0.9, color: BUBBLE_STROKE });
    // bubble tail (same triangle as the SVG version)
    rig.bubbleBg.poly([-3.5, -0.5, 3.5, -0.5, 0, 4]).fill({ color: BUBBLE_FILL });
    rig.bubbleText.text = t;
    rig.bubble.visible = true;
  }

  /** Per-movement-tick update: transforms are cheap, rebuilds are diffed. */
  updateAgents(agents) {
    if (!this.world) return;
    const seen = new Set();

    for (const agent of agents) {
      seen.add(agent.id);
      let rig = this.agents.get(agent.id);
      if (!rig) {
        rig = this._buildAgent(agent);
        this.agents.set(agent.id, rig);
      }

      const x = agent.x || 0;
      const y = agent.y || 0;
      rig.x = x;
      rig.y = y;
      rig.root.position.set(x, y);
      rig.root.zIndex = y;

      this._refreshStatus(rig, agent);
      this._refreshTag(rig, agent);
      this._refreshBubble(rig, agent);

      // Walking feet: swing along the heading, spread perpendicular.
      const hx = Number.isFinite(agent.headingX) ? agent.headingX : 0;
      const hy = Number.isFinite(agent.headingY) ? agent.headingY : 1;
      const hLen = Math.hypot(hx, hy) || 1;
      const hX = hx / hLen;
      const hY = hy / hLen;
      const pX = -hY;
      const pY = hX;
      const swing = agent.moving ? Math.sin(agent.walkPhase || 0) * 5.4 : 0;
      const rot = Math.atan2(hY, hX) + Math.PI / 2;
      rig.foot1.position.set(pX * 7.6 + hX * swing, pY * 7.6 + hY * swing);
      rig.foot1.rotation = rot;
      rig.foot2.position.set(-pX * 7.6 - hX * swing, -pY * 7.6 - hY * swing);
      rig.foot2.rotation = rot;

      // Face peek toward the heading
      const dir = agent.direction || 'SE';
      if (dir !== rig.lastDir) {
        rig.lastDir = dir;
        const [fx, fy] = FACE_DIR[dir] || [0, 3.4];
        rig.face.position.set(fx, fy - 0.8);
      }
    }

    // Remove rigs for agents that disappeared (reset, unprovision)
    for (const [id, rig] of this.agents.entries()) {
      if (!seen.has(id)) {
        rig.root.destroy({ children: true });
        this.agents.delete(id);
      }
    }
  }

  /** Nearest agent within hit radius for pointer interaction. */
  hitTest(worldX, worldY, radius = 16) {
    let best = null;
    let bestDist = Infinity;
    for (const [id, rig] of this.agents.entries()) {
      const d = Math.hypot(rig.x - worldX, rig.y - worldY);
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    return bestDist <= radius ? best : null;
  }

  _tick(deltaMS) {
    this._elapsed += deltaMS;

    // Smooth night veil fade (matches the 0.9s CSS transition on the SVG side)
    if (Math.abs(this.nightTarget - this.nightCurrent) > 0.001) {
      const k = Math.min(1, deltaMS / 220);
      this.nightCurrent += (this.nightTarget - this.nightCurrent) * k;
      this.overlay.alpha = this.nightCurrent;
    }

    // Status pulse animation (13 -> 21 radius, fading)
    for (const rig of this.agents.values()) {
      if (!rig.pulse.visible) continue;
      const t = (this._elapsed % 1800) / 1800;
      rig.pulse.scale.set(1 + t * 0.62);
      rig.pulse.alpha = 0.55 * (1 - t);
    }
  }

  destroy() {
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = null;
    }
    if (this.app) {
      this.app.destroy(true, { children: true, texture: true });
      this.app = null;
      this.world = null;
      this.agents.clear();
    }
  }
}

export const pixiAgentLayer = new PixiAgentLayer();
export default pixiAgentLayer;
