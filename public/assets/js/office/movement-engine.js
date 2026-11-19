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
      const existing = this.agents.get(a.id);
      const px = a.position_x !== undefined ? a.position_x : 300;
      const py = a.position_y !== undefined ? a.position_y : 300;

      if (!existing) {
        this.agents.set(a.id, {
          ...a,
          x: px,
          y: py,
          targetX: px,
          targetY: py,
          speed: 60, // base units/sec
          direction: a.direction || 'SE',
          path: [],
          arriveStatus: null,
          moveNote: null,
          move_note: null,
          walkPhase: 0,   // advances with distance walked; drives the leg animation
          moving: false,
          headingX: 0,    // unit vector of current walk heading (for feet orientation)
          headingY: 1
        });
      } else {
        existing.status = a.status;
        existing.display_name = a.display_name;
        existing.department = a.department;
        existing.active_task_title = a.active_task_title;
        existing.current_tool = a.current_tool;

        if (Array.isArray(a.path) && a.path.length > 0) {
          // Server-computed waypoint route: walk leg by leg through corridors.
          existing.path = a.path.map((p) => ({ x: p.x, y: p.y }));
          const first = existing.path.shift();
          existing.targetX = first.x;
          existing.targetY = first.y;
          existing.arriveStatus = a.arrive_status || null;
          existing.moveNote = a.move_note || null;
          existing.move_note = a.move_note || null;
        } else if (a.target_x !== undefined && a.target_y !== undefined) {
          // Direct target update (e.g. manual REST PATCH): cancel any queued route.
          existing.path = [];
          existing.targetX = a.target_x;
          existing.targetY = a.target_y;
          existing.arriveStatus = a.arrive_status || null;
          existing.moveNote = a.move_note || null;
          existing.move_note = a.move_note || null;
        } else if (
          (!existing.path || existing.path.length === 0) &&
          Math.hypot(existing.targetX - existing.x, existing.targetY - existing.y) <= 1 &&
          (Math.abs(existing.targetX - px) > 1 || Math.abs(existing.targetY - py) > 1)
        ) {
          // Idle agent with an out-of-band DB position change: honor the new spot.
          // Never interrupt an in-progress waypoint walk with stale DB positions.
          existing.targetX = px;
          existing.targetY = py;
        }
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
      this.onUpdateCallback(Array.from(this.agents.values()));
    }

    requestAnimationFrame((t) => this.tick(t));
  }
}

export const movementEngine = new MovementEngine();
export default movementEngine;
