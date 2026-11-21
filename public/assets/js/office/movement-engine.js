import { store } from '../core/store.js';

export class MovementEngine {
  constructor() {
    this.agents = new Map(); // id -> { x, y, targetX, targetY, speed, direction, status }
    this.running = false;
    this.lastFrameTime = performance.now();
    this.onUpdateCallback = null;

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.running = false;
      } else {
        this.running = true;
        this.lastFrameTime = performance.now();
        requestAnimationFrame((t) => this.tick(t));
      }
    });
  }

  setUpdateCallback(cb) {
    this.onUpdateCallback = cb;
  }

  start() {
    if (!this.running) {
      this.running = true;
      this.lastFrameTime = performance.now();
      requestAnimationFrame((t) => this.tick(t));
    }
  }

  stop() {
    this.running = false;
  }

  syncAgents(agentsList) {
    for (const a of agentsList) {
      const px = Number.isFinite(Number(a.position_x)) ? Number(a.position_x) : 300;
      const py = Number.isFinite(Number(a.position_y)) ? Number(a.position_y) : 300;
      const existing = this.agents.get(a.id);
      const route = Array.isArray(a.path)
        ? a.path
            .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
            .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
        : [];
      const routeKey = route.length ? JSON.stringify(route) : null;

      if (!existing) {
        // Apply an initial server route as well as later route updates. Without
        // this, an agent loaded mid-walk would incorrectly appear stationary.
        const first = route.length ? route[0] : null;
        this.agents.set(a.id, {
          ...a,
          x: px,
          y: py,
          targetX: first ? first.x : (Number.isFinite(Number(a.target_x)) ? Number(a.target_x) : px),
          targetY: first ? first.y : (Number.isFinite(Number(a.target_y)) ? Number(a.target_y) : py),
          speed: 60, // base units/sec; simulationSpeed changes visuals only
          direction: a.direction || 'SE',
          path: first ? route.slice(1) : [],
          routeKey,
          arriveStatus: a.arrive_status || a.arriveStatus || null,
          moveNote: a.move_note || a.moveNote || null,
          move_note: a.move_note || a.moveNote || null,
          walkPhase: 0,
          moving: false,
          headingX: 0,
          headingY: 1
        });
        continue;
      }

      existing.status = a.status ?? existing.status;
      existing.display_name = a.display_name ?? existing.display_name;
      existing.department = a.department ?? existing.department;
      existing.active_task_title = a.active_task_title ?? existing.active_task_title;
      existing.current_tool = a.current_tool ?? existing.current_tool;

      if (routeKey && routeKey !== existing.routeKey) {
        // Server-computed waypoint route: walk each corridor-safe leg in order.
        existing.path = route.slice(1);
        existing.targetX = route[0].x;
        existing.targetY = route[0].y;
        existing.routeKey = routeKey;
        existing.arriveStatus = a.arrive_status || a.arriveStatus || null;
        existing.moveNote = a.move_note || a.moveNote || null;
        existing.move_note = existing.moveNote;
      } else if (
        Number.isFinite(Number(a.target_x)) &&
        Number.isFinite(Number(a.target_y)) &&
        (Number(a.target_x) !== existing.targetX || Number(a.target_y) !== existing.targetY)
      ) {
        // Direct target update (e.g. manual REST PATCH): cancel any queued route.
        existing.path = [];
        existing.routeKey = null;
        existing.targetX = Number(a.target_x);
        existing.targetY = Number(a.target_y);
        existing.arriveStatus = a.arrive_status || a.arriveStatus || null;
        existing.moveNote = a.move_note || a.moveNote || null;
        existing.move_note = existing.moveNote;
      } else if (
        (!existing.path || existing.path.length === 0) &&
        Math.hypot(existing.targetX - existing.x, existing.targetY - existing.y) <= 1 &&
        (Math.abs(existing.targetX - px) > 1 || Math.abs(existing.targetY - py) > 1)
      ) {
        // Honor an out-of-band persisted position only when the agent is idle.
        existing.targetX = px;
        existing.targetY = py;
      }
    }
  }

  tick(currentTime) {
    if (!this.running) return;

    const deltaSec = (currentTime - this.lastFrameTime) / 1000;
    this.lastFrameTime = currentTime;

    // Visual simulation speed multiplier
    const speedMultiplier = store.state.simulationSpeed || 1;
    let anyMoved = false;

    for (const [id, agent] of this.agents.entries()) {
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 1) {
        anyMoved = true;
        const step = Math.min(agent.speed * speedMultiplier * deltaSec, dist);
        agent.x += (dx / dist) * step;
        agent.y += (dy / dist) * step;

        // Walk cycle state for the leg/feet animation (one full stride ≈ 26 units)
        agent.moving = true;
        agent.headingX = dx / dist;
        agent.headingY = dy / dist;
        agent.walkPhase = ((agent.walkPhase || 0) + step / 13) % 65536;

        // Calculate Direction/Orientation
        if (Math.abs(dx) > Math.abs(dy)) {
          agent.direction = dx > 0 ? 'SE' : 'NW';
        } else {
          agent.direction = dy > 0 ? 'SW' : 'NE';
        }
      } else {
        agent.moving = false;
        agent.x = agent.targetX;
        agent.y = agent.targetY;

        if (agent.path && agent.path.length > 0) {
          // Advance to the next waypoint leg
          const next = agent.path.shift();
          agent.targetX = next.x;
          agent.targetY = next.y;
        } else if (agent.arriveStatus) {
          // Final waypoint reached: apply the server-declared arrival status
          agent.status = agent.arriveStatus;
          agent.arriveStatus = null;
          agent.moveNote = null;
          agent.move_note = null;
        }
      }
    }

    if (this.onUpdateCallback) {
      this.onUpdateCallback(Array.from(this.agents.values()), deltaSec);
    }

    requestAnimationFrame((t) => this.tick(t));
  }
}

export const movementEngine = new MovementEngine();
export default movementEngine;
