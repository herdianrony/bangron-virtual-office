import { getDatabase } from '../../database/connection.js';
import { VirtualOfficeService } from '../virtual-office/virtual-office.service.js';
import { AgentRepository } from '../../database/repositories/agent.repository.js';
import { ActivityRepository } from '../../database/repositories/activity.repository.js';
import { eventPublisher } from '../../realtime/event-publisher.js';
import logger from '../../utils/logger.js';
import { DEMO_SPOTS, BREAK_SPOTS } from '../../services/office-layout.js';

/**
 * DemoEngine — auto-play director for the isolated DEMO workspace.
 *
 * Every tick it picks the next specialist in rotation and dispatches a
 * task-driven walk: agents head to the workstation that matches their
 * active task (pairing in the Meeting Room, infra checks in the Server
 * Room, design reviews in the UI/UX Lab), while workstation reservations
 * and the activity feed stay in sync.
 *
 * IDLE BEHAVIOUR: an agent with nothing to do does not freeze at its desk —
 * it takes a realistic break and wanders off to the Coffee Bar, the Library
 * reading table or the Lounge sofa (BREAK_SPOTS), walking the full corridor
 * route like everyone else.
 *
 * The frontend receives the full waypoint path over WebSocket and walks
 * the agent leg by leg (60 units/sec at 1x visual speed), showing a
 * "Heading to ..." bubble until arrival.
 */

const FIRST_NAME = (displayName) => (displayName || 'Agent').replace('[DEMO] ', '').split(' ')[0];

const SPOTS = DEMO_SPOTS;

const BREAK_ACTIVITY = {
  coffee: 'is idle — strolled to the Coffee Bar for a fresh espresso',
  library: 'is idle — headed to the Perpustakaan to browse the reference shelf',
  lounge: 'is idle — flopped onto the Lounge Sofa to recharge'
};

// Cyclic routines per demo agent: [spot, arriveStatus, activity description]
const ROUTINES = {
  inst_demo_hermes: [
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub to lead the cross-functional orchestration sync'],
    [SPOTS.director, 'thinking', 'walked to the Director Office to report pipeline progress'],
    [SPOTS.library, 'thinking', 'walked to the Perpustakaan to review the orchestration playbook'],
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub for subtask delegation review'],
    ['home', 'working', 'returned to the Hermes Orchestration Station to dispatch subagents']
  ],
  inst_demo_backend: [
    [SPOTS.server, 'working', 'walked to the Server Room to dry-run the schema migration on the infrastructure terminal'],
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub to pair with Hermes on task decomposition'],
    [SPOTS.coffee, 'idle', 'walked to the Ruang Kopi to refuel on a debugger latte'],
    ['home', 'working', 'returned to the Backend Engineering Station to continue the REST API build']
  ],
  inst_demo_frontend: [
    [SPOTS.uiux, 'collaborating', 'walked to the UI/UX Lab to inspect the new design tokens'],
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub to demo the isometric renderer'],
    [SPOTS.library, 'thinking', 'walked to the Perpustakaan to study SVG optimization papers'],
    ['home', 'working', 'returned to the Frontend Engineering Station to keep polishing the 2.5D engine']
  ],
  inst_demo_uiux: [
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub to facilitate the design review'],
    ['home', 'working', 'returned to the UI/UX Design Station to iterate on wireframes'],
    [SPOTS.coffee, 'idle', 'took a coffee break at the Espresso Bar']
  ],
  inst_demo_qa: [
    [SPOTS.server, 'working', 'walked to the Server Room to audit the CI/CD runners'],
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub to align on the QA sign-off checklist'],
    [SPOTS.coffee, 'idle', 'walked to the Ruang Kopi to swap vulnerability findings over coffee'],
    ['home', 'working', 'returned to the QA Test & Security Station to run the regression suite']
  ],
  inst_demo_creative: [
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub for the brand and UI sync'],
    [SPOTS.lounge, 'idle', 'took a creative recharge break at the Lounge Sofa'],
    [SPOTS.library, 'thinking', 'walked to the Perpustakaan to sketch moodboards from the art books'],
    ['home', 'working', 'returned to the Digital Art Station to craft isometric brand assets']
  ],
  inst_demo_research: [
    [SPOTS.library, 'thinking', 'moved to the Perpustakaan to synthesize research notes between the stacks'],
    [SPOTS.coffee, 'idle', 'took a coffee break at the Espresso Bar to swap benchmark trivia'],
    [SPOTS.meeting, 'collaborating', 'walked to the Conference Hub to brief the team on benchmarks'],
    ['home', 'working', 'returned to the Research Analyst Station to compile the whitepaper']
  ]
};

const WALK_SPEED = 60; // base units/sec at 1x (kept in sync with the frontend movement engine)
const IDLE_BREAK_CHANCE = 0.8; // probability an idle agent takes a wander break this tick

export class DemoEngine {
  constructor() {
    this.timer = null;
    this.enabled = false;
    this.tickMs = 6500;
    this.rotationIndex = 0;
    this.lastTickAt = null;
    this.lastDispatch = null;
    this.officeService = null;
    this.agentRepo = null;
    this.activityRepo = null;
  }

  start() {
    if (this.timer) return;
    this.enabled = true;
    this.officeService = new VirtualOfficeService();
    this.agentRepo = new AgentRepository(getDatabase());
    this.activityRepo = new ActivityRepository(getDatabase());
    this.timer = setInterval(() => this.safeTick(), this.tickMs);
    logger.info(`DemoEngine auto-play started (tick every ${this.tickMs}ms)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.enabled = false;
    logger.info('DemoEngine auto-play stopped');
  }

  setEnabled(enabled) {
    if (enabled) {
      this.start();
    } else {
      this.stop();
    }
    return this.getStatus();
  }

  getStatus() {
    return {
      enabled: this.enabled,
      running: this.timer !== null,
      tickMs: this.tickMs,
      lastTickAt: this.lastTickAt,
      lastDispatch: this.lastDispatch
    };
  }

  safeTick() {
    try {
      this.tick();
    } catch (err) {
      logger.error({ err }, 'DemoEngine tick failed');
    }
  }

  tick() {
    this.lastTickAt = new Date().toISOString();

    const demoAgents = this.agentRepo
      .getAllInstances()
      .filter((a) => a.metadata_json && a.metadata_json.includes('"is_demo": true'));

    if (!demoAgents.length) return; // Production namespace — nothing to drive

    const rotating = demoAgents.filter((a) => ROUTINES[a.id]);
    if (!rotating.length) return;

    const agent = rotating[this.rotationIndex % rotating.length];
    this.rotationIndex = (this.rotationIndex + 1) % rotating.length;

    // Respect the approval policy gate: a waiting agent must stay at its desk.
    if (agent.status === 'waiting' || agent.active_task_status === 'waiting') {
      this.recordActivity(agent, 'approval.waiting', 'is waiting for Director approval — holding position');
      return;
    }

    // Never re-dispatch while the previous walk is still in progress: the
    // route would start from the stale DB origin and the client-side agent
    // would beeline straight to it, cutting across room walls. The arrival
    // timer lands the final status, freeing the agent for the next dispatch.
    if (agent.status === 'walking') {
      return;
    }

    // IDLE BEHAVIOUR: agents with nothing on their plate take a break walk
    // to the Coffee Bar, the Library or the Lounge instead of idling at
    // their desk (they pick a spot they are not already occupying).
    if (agent.status === 'idle' || agent.active_task_status === 'idle') {
      if (Math.random() < IDLE_BREAK_CHANCE) {
        const options = BREAK_SPOTS.filter((s) => s.workstationId !== agent.current_workstation_id);
        if (options.length) {
          const spot = options[Math.floor(Math.random() * options.length)];
          const key = spot === SPOTS.coffee ? 'coffee' : spot === SPOTS.library ? 'library' : 'lounge';
          const dispatched = this.dispatchWalk(agent, spot, 'idle', BREAK_ACTIVITY[key], { skipAlreadyThere: false });
          if (dispatched) return;
        }
      }
    }

    const routine = ROUTINES[agent.id];
    const routineKey = agent.id;
    this.routineIndex = this.routineIndex || {};
    const step = this.routineIndex[routineKey] ?? 0;
    this.routineIndex[routineKey] = (step + 1) % routine.length;

    const [targetSpot, arriveStatus, activityDesc] = routine[step];
    const destination = targetSpot === 'home' ? this.getHomeSpot(agent) : targetSpot;
    if (!destination) return;

    this.dispatchWalk(agent, destination, arriveStatus, activityDesc, { skipAlreadyThere: true });
  }

  /**
   * Routes the agent through the corridor network to a destination spot and
   * broadcasts the waypoint path. Returns true when a walk was dispatched.
   */
  dispatchWalk(agent, destination, arriveStatus, activityDesc, { skipAlreadyThere = true } = {}) {
    const position = this.officeService.officeRepo.getAgentPosition(agent.id);
    const fromX = position ? position.position_x : destination.x;
    const fromY = position ? position.position_y : destination.y;

    // Already there? Log the activity without a redundant walk.
    const wsUnchanged = destination.workstationId && agent.current_workstation_id === destination.workstationId;
    const distance = Math.hypot(destination.x - fromX, destination.y - fromY);
    if (skipAlreadyThere && wsUnchanged && distance < 6) {
      this.recordActivity(agent, 'task.progress', `${activityDesc} (already in place)`);
      this.agentRepo.updateInstanceStatus(agent.id, arriveStatus);
      return false;
    }

    // Shared spots (conference table, sofa, bar): deterministic per-agent seat
    // offset so agents gathering in the same place do not stack on one pixel.
    let tx = destination.x;
    let ty = destination.y;
    if ((destination.cap || 1) > 1) {
      const seedNum = [...agent.id].reduce((s, c) => s + c.charCodeAt(0), 0);
      tx += ((seedNum % 3) - 1) * 14;
      ty += ((Math.floor(seedNum / 3) % 3) - 1) * 9;
    }

    // Keep-left lane: deterministic per-agent offset (6-10 units) so every
    // agent walks on the LEFT side of the corridor, like real pedestrians,
    // with just enough spread that same-direction walkers never single-file.
    const laneSeed = [...agent.id].reduce((s, c) => s + c.charCodeAt(0), 0);
    const laneOffset = 6 + (laneSeed % 5);
    const path = this.officeService.computeWalkRoute(fromX, fromY, tx, ty, { laneOffset });
    const pathLength = path.reduce((sum, p, i) => {
      if (i === 0) return sum;
      return sum + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y);
    }, 0);

    const moveNote = `Heading to ${destination.label}`;
    const etaSec = pathLength / (WALK_SPEED * 1) + 1;

    // Face the dominant walking axis (kept in sync with the movement engine).
    const dx = tx - fromX;
    const dy = ty - fromY;
    const direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'SE' : 'NW') : dy > 0 ? 'SW' : 'NE';

    this.officeService.updateAgentPosition(agent.id, {
      roomId: destination.roomId,
      workstationId: destination.workstationId,
      positionX: tx,
      positionY: ty,
      direction,
      path,
      moveNote,
      arriveStatus
    });

    this.agentRepo.updateInstanceStatus(agent.id, 'walking');
    this.recordActivity(agent, 'movement.dispatched', `${activityDesc} (ETA ~${Math.round(etaSec)}s)`);

    // Reflect the arrival status in the DB/telemetry once the walk should be done
    setTimeout(() => {
      try {
        this.agentRepo.updateInstanceStatus(agent.id, arriveStatus);
        eventPublisher.publishAgentStatus(agent.id, arriveStatus);
      } catch (err) {
        logger.warn({ err }, 'DemoEngine arrival status update failed');
      }
    }, Math.max(etaSec + 2, 3) * 1000);

    this.lastDispatch = {
      at: this.lastTickAt,
      agentId: agent.id,
      agentName: agent.display_name,
      destination: destination.label,
      etaSec: Math.round(etaSec)
    };
    return true;
  }

  getHomeSpot(agent) {
    const ws = this.officeService.officeRepo.getWorkstationById(agent.current_workstation_id);
    if (ws && ws.room_id === agent.current_room_id) {
      return { roomId: ws.room_id, workstationId: ws.id, x: ws.position_x, y: ws.position_y, cap: ws.capacity, label: ws.name };
    }
    const fallback = { inst_demo_hermes: SPOTS.meeting };
    return fallback[agent.id] || SPOTS.meeting;
  }

  recordActivity(agent, activityType, description) {
    const firstName = FIRST_NAME(agent.display_name);
    const activity = this.activityRepo.recordActivity({
      agentInstanceId: agent.id,
      taskId: agent.active_task_id || null,
      activityType,
      description: `${firstName} ${description}`,
      metadata: { is_demo: true, source: 'demo-engine' }
    });
    const enriched = {
      ...activity,
      agent_name: agent.display_name,
      agent_department: agent.department
    };
    eventPublisher.publishAgentActivity(enriched);
    return enriched;
  }
}

export const demoEngine = new DemoEngine();
export default demoEngine;
