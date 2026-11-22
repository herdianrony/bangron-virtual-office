import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock is hoisted — ALL browser global setup and mutable state must live
// inside the factory. Use globalThis for cross-scope state access from tests.
vi.mock('../../public/assets/js/office/movement-engine.js', () => {
  const frameCallbacks = [];
  let mockNow = 0;

  globalThis.__me_frameCallbacks = frameCallbacks;
  globalThis.__me_setNow = (v) => { mockNow = v; };

  global.document = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    hidden: false
  };
  global.requestAnimationFrame = (cb) => {
    frameCallbacks.push(cb);
    return 1;
  };
  global.performance = {
    now: () => mockNow
  };

  return vi.importActual('../../public/assets/js/office/movement-engine.js');
});

import { MovementEngine } from '../../public/assets/js/office/movement-engine.js';

beforeEach(() => {
  globalThis.__me_frameCallbacks.length = 0;
  globalThis.__me_setNow(1000);
});

afterEach(() => {
  globalThis.__me_frameCallbacks.length = 0;
});

/**
 * Animation — MovementEngine delta-time propagation regression test.
 *
 * Root cause: OfficeView.setUpdateCallback((agents) => {
 *   this.renderAvatars(agents);
 *   this.camera.updateFollow(agents, dt);  // ← dt is undefined → ReferenceError
 * });
 *
 * MovementEngine.tick() calls onUpdateCallback(Array.from(this.agents.values()),
 * deltaSec) — passing deltaSec as the SECOND argument. The callback must accept
 * (agents, dt) for time-based lerp smoothing in CameraController.updateFollow.
 *
 * Fix: Changed callback signature to (agents, dt) so deltaTime flows through.
 */
describe('MovementEngine — delta-time propagation through update callback', () => {
  it('calls onUpdateCallback with (agents, deltaSec) — dt is never undefined', () => {
    const engine = new MovementEngine();
    const calls = [];
    engine.setUpdateCallback((agents, dt) => {
      calls.push({ agents: [...agents], dt });
    });

    // One agent walking toward a target
    engine.syncAgents([
      {
        id: 'agent_dt_test',
        position_x: 0,
        position_y: 0,
        target_x: 100,
        target_y: 0,
        direction: 'SE',
        status: 'walking',
        path: [],
        arrive_status: null,
        move_note: null,
        walkPhase: 0,
        moving: false,
        headingX: 0,
        headingY: 1
      }
    ]);

    engine.start();

    // Simulate a frame: advance time and invoke the raf callback
    globalThis.__me_setNow(2000); // 1 second elapsed
    globalThis.__me_frameCallbacks[0](2000);

    engine.stop();

    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall.dt).toBeDefined();
    expect(typeof lastCall.dt).toBe('number');
    expect(lastCall.dt).toBeGreaterThan(0);
    expect(lastCall.agents.length).toBe(1);
    expect(lastCall.agents[0].id).toBe('agent_dt_test');
  });

  it('deltaSec is positive and finite for normal frame intervals', () => {
    const engine = new MovementEngine();
    let receivedDt = null;
    engine.setUpdateCallback((_agents, dt) => {
      receivedDt = dt;
    });

    engine.syncAgents([
      {
        id: 'agent_dt_2',
        position_x: 0,
        position_y: 0,
        target_x: 50,
        target_y: 0,
        direction: 'SE',
        status: 'walking',
        path: [],
        arrive_status: null,
        move_note: null,
        walkPhase: 0,
        moving: false,
        headingX: 0,
        headingY: 1
      }
    ]);

    engine.start();
    globalThis.__me_setNow(1016); // 16ms elapsed (~60 FPS)
    globalThis.__me_frameCallbacks[0](1016);
    engine.stop();

    expect(receivedDt).toBeDefined();
    expect(typeof receivedDt).toBe('number');
    expect(receivedDt).toBeGreaterThan(0);
    expect(receivedDt).toBeLessThan(1); // 16ms = 0.016s, well under 1s
    expect(Number.isFinite(receivedDt)).toBe(true);
  });

  it('callback receives updated agent positions after movement', () => {
    const engine = new MovementEngine();
    let lastAgents = null;
    engine.setUpdateCallback((agents) => {
      lastAgents = [...agents];
    });

    engine.syncAgents([
      {
        id: 'agent_move_test',
        position_x: 0,
        position_y: 0,
        target_x: 100,
        target_y: 0,
        direction: 'SE',
        status: 'walking',
        path: [],
        arrive_status: null,
        move_note: null,
        walkPhase: 0,
        moving: false,
        headingX: 0,
        headingY: 1
      }
    ]);

    engine.start();
    globalThis.__me_setNow(2000); // 1 second elapsed, agent moves ~60 units at speed 60
    globalThis.__me_frameCallbacks[0](2000);
    engine.stop();

    expect(lastAgents).not.toBeNull();
    const agent = lastAgents[0];
    expect(agent.id).toBe('agent_move_test');
    // Agent should have moved toward target (x > 0, x < 100)
    expect(agent.x).toBeGreaterThan(0);
    expect(agent.x).toBeLessThan(100);
    expect(agent.moving).toBe(true);
  });

  it('does not throw when callback is not set', () => {
    const engine = new MovementEngine();
    engine.syncAgents([
      {
        id: 'agent_no_cb',
        position_x: 0,
        position_y: 0,
        target_x: 10,
        target_y: 0,
        direction: 'SE',
        status: 'walking',
        path: [],
        arrive_status: null,
        move_note: null,
        walkPhase: 0,
        moving: false,
        headingX: 0,
        headingY: 1
      }
    ]);
    engine.start();
    expect(() => {
      globalThis.__me_setNow(1100);
      globalThis.__me_frameCallbacks[0](1100);
    }).not.toThrow();
    engine.stop();
  });
});
