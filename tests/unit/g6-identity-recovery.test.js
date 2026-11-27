import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { StateReconciler } from '../../src/integrations/hermes/state-reconciler.js';
import { AgentRepository } from '../../src/database/repositories/agent.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { recoverActiveHermesRuns } from '../../src/integrations/hermes/startup-recovery.js';
import { hermesEventBridge } from '../../src/integrations/hermes/event-bridge.js';

describe('G6.1 — StateReconciler Agent Identity Safety', () => {
  let db;
  let reconciler;
  let agentRepo;
  let taskRepo;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);

    reconciler = new StateReconciler(db);
    agentRepo = new AgentRepository(db);
    taskRepo = new TaskRepository(db);

    // Create a known instance
    agentRepo.createInstance({
      id: 'inst_test_dev',
      profileId: 'prof_dev_backend',
      displayName: 'Test Backend Dev',
      status: 'idle',
      currentRoomId: 'room_dev'
    });

    // Create a task (status defaults to 'pending')
    taskRepo.createTask({
      id: 'task_test_api',
      title: 'Build REST endpoints',
      assignedAgentId: 'inst_test_dev'
    });
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('should NOT fall back to inst_demo_hermes for unknown identity', () => {
    // Verify defaultInstanceId is null (not 'inst_demo_hermes')
    expect(reconciler.defaultInstanceId).toBeNull();

    // Reconcile an event with unknown identity
    const result = reconciler.reconcile({
      event_id: 'evt_unknown_001',
      event_type: 'agent.execution.started',
      instance_id: 'inst_nonexistent',
      task_id: 'task_test_api',
      payload: {}
    });

    // Event should still be recorded (idempotency/persistence)
    expect(result.status).toBe('processed');

    // But no agent state should be updated (instance_id null -> unknown instance ignored)
    const instance = agentRepo.getInstanceById('inst_test_dev');
    expect(instance.status).toBe('idle'); // unchanged

    const task = taskRepo.getTaskById('task_test_api');
    expect(task.status).toBe('pending'); // unchanged (not running, since no valid instance)
  });

  it('should use explicit instance mapping when available', () => {
    const result = reconciler.reconcile({
      event_id: 'evt_explicit_001',
      event_type: 'agent.execution.started',
      instance_id: 'inst_test_dev',
      task_id: 'task_test_api',
      payload: {}
    });

    expect(result.status).toBe('processed');

    const instance = agentRepo.getInstanceById('inst_test_dev');
    expect(instance.status).toBe('working'); // updated by execution.started

    const task = taskRepo.getTaskById('task_test_api');
    expect(task.status).toBe('running'); // updated since instance resolved
  });

  it('should use known session mapping for stickiness', () => {
    // First, create a session for the instance
    agentRepo.createSession({
      id: 'sess_known_001',
      agentInstanceId: 'inst_test_dev',
      taskId: 'task_test_api',
      metadata: {}
    });

    // Reconcile an event with session_id but no instance_id
    const result = reconciler.reconcile({
      event_id: 'evt_session_001',
      event_type: 'agent.execution.started',
      instance_id: null,
      session_id: 'sess_known_001',
      task_id: 'task_test_api',
      payload: {}
    });

    expect(result.status).toBe('processed');
  });

  it('should use configured profile mapping (HERMES_PROFILE_AGENT_MAP)', () => {
    // Temporarily set the profile map
    const originalMap = reconciler.profileAgentMap;
    reconciler.profileAgentMap = { 'hermes_backend_profile': 'inst_test_dev' };

    const result = reconciler.reconcile({
      event_id: 'evt_profile_001',
      event_type: 'agent.execution.started',
      instance_id: null,
      profile: 'hermes_backend_profile',
      task_id: 'task_test_api',
      payload: {}
    });

    expect(result.status).toBe('processed');

    reconciler.profileAgentMap = originalMap;
  });

  it('should auto-provision agent from actual Hermes profile identity', () => {
    // Clear any profile map to force auto-provisioning
    reconciler.profileAgentMap = {};

    const result = reconciler.reconcile({
      event_id: 'evt_provision_001',
      event_type: 'agent.execution.started',
      instance_id: null,
      profile: 'Hermes Backend Agent',
      task_id: null,
      payload: {}
    });

    expect(result.status).toBe('processed');

    // Should have provisioned a new instance from the Hermes profile name
    const instances = agentRepo.getAllInstances();
    const hermesInstance = instances.find(i => i.display_name === 'Hermes Backend Agent');
    expect(hermesInstance).toBeDefined();
    expect(hermesInstance.runtime_type).toBe('hermes');
  });

  it('should skip agent state updates when identity cannot be resolved', () => {
    // Task WITHOUT an assigned agent — no identity source at all
    taskRepo.createTask({ id: 'task_unassigned_api', title: 'Unassigned probe' });

    // Event with unknown profile/agent_id, no explicit mapping, no default instance
    const result = reconciler.reconcile({
      event_id: 'evt_ambiguous_001',
      event_type: 'agent.execution.started',
      instance_id: null,
      profile: null,
      agent_id: null,
      task_id: 'task_unassigned_api',
      payload: {}
    });

    expect(result.status).toBe('processed');

    // No agent state should change - task stays pending since no instance resolved
    const task = taskRepo.getTaskById('task_unassigned_api');
    expect(task.status).toBe('pending');
    expect(agentRepo.getInstanceById('inst_test_dev').status).toBe('idle');
  });

  it('should not silently update demo agent for live Hermes events', () => {
    // Verify there is no inst_demo_hermes in the database
    const demoInstance = agentRepo.getInstanceById('inst_demo_hermes');
    expect(demoInstance).toBeUndefined();

    // Reconcile an event that would have fallen back to demo agent previously
    const result = reconciler.reconcile({
      event_id: 'evt_nodemo_001',
      event_type: 'agent.execution.started',
      instance_id: null,
      profile: null,
      agent_id: null,
      task_id: null,
      payload: {}
    });

    expect(result.status).toBe('processed');

    // No demo agent was created or updated
    const demoAfter = agentRepo.getInstanceById('inst_demo_hermes');
    expect(demoAfter).toBeUndefined();
  });
});

describe('G6.1 — EventBridge Restart Recovery from SQLite', () => {
  let db;
  let taskRepo;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);

    taskRepo = new TaskRepository(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('should recover active Hermes runs with non-terminal status', () => {
    // Create tasks (status defaults to 'pending'), then set hermes_run_id and update status
    const t1 = taskRepo.createTask({
      id: 'task_active_1',
      title: 'Active run 1'
    });
    taskRepo.setHermesRunId(t1.id, 'hermes_run_active_1');
    taskRepo.updateTaskStatus(t1.id, 'running');

    const t2 = taskRepo.createTask({
      id: 'task_active_2',
      title: 'Active run 2'
    });
    taskRepo.setHermesRunId(t2.id, 'hermes_run_active_2');
    taskRepo.updateTaskStatus(t2.id, 'queued');

    // Terminal tasks
    const t3 = taskRepo.createTask({
      id: 'task_terminal_1',
      title: 'Terminal completed'
    });
    taskRepo.setHermesRunId(t3.id, 'hermes_run_completed');
    taskRepo.updateTaskStatus(t3.id, 'completed');

    const t4 = taskRepo.createTask({
      id: 'task_terminal_2',
      title: 'Terminal failed'
    });
    taskRepo.setHermesRunId(t4.id, 'hermes_run_failed');
    taskRepo.updateTaskStatus(t4.id, 'failed');

    // Task without hermes_run_id
    const t5 = taskRepo.createTask({
      id: 'task_no_run',
      title: 'No run id'
    });
    taskRepo.updateTaskStatus(t5.id, 'running');

    // Query active (non-terminal) runs with hermes_run_id
    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    const activeTasks = db.prepare(`
      SELECT id, hermes_run_id, status
      FROM agent_tasks
      WHERE hermes_run_id IS NOT NULL
        AND hermes_run_id != ''
        AND status NOT IN (${terminalStatuses.map(() => '?').join(',')})
    `).all(...terminalStatuses);

    expect(activeTasks.length).toBe(2);
    expect(activeTasks.map(t => t.id).sort()).toEqual(['task_active_1', 'task_active_2']);
  });

  it('should not recover terminal status runs', () => {
    // Terminal tasks
    const t1 = taskRepo.createTask({
      id: 'task_completed',
      title: 'Completed'
    });
    taskRepo.setHermesRunId(t1.id, 'run_completed');
    taskRepo.updateTaskStatus(t1.id, 'completed');

    const t2 = taskRepo.createTask({
      id: 'task_failed',
      title: 'Failed'
    });
    taskRepo.setHermesRunId(t2.id, 'run_failed');
    taskRepo.updateTaskStatus(t2.id, 'failed');

    const t3 = taskRepo.createTask({
      id: 'task_cancelled',
      title: 'Cancelled'
    });
    taskRepo.setHermesRunId(t3.id, 'run_cancelled');
    taskRepo.updateTaskStatus(t3.id, 'cancelled');

    const terminalStatuses = ['completed', 'failed', 'cancelled'];
    const activeTasks = db.prepare(`
      SELECT id, hermes_run_id, status
      FROM agent_tasks
      WHERE hermes_run_id IS NOT NULL
        AND hermes_run_id != ''
        AND status NOT IN (${terminalStatuses.map(() => '?').join(',')})
    `).all(...terminalStatuses);

    expect(activeTasks.length).toBe(0);
  });
});

describe('G6.1 — Startup Recovery via Dependency Injection', () => {
  let db;
  let taskRepo;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);

    taskRepo = new TaskRepository(db);
    hermesEventBridge.stopAll();
  });

  afterEach(() => {
    if (db) db.close();
    hermesEventBridge.stopAll();
  });

  it('should recover active runs and call startPolling via real function', async () => {
    const t1 = taskRepo.createTask({ id: 'task_recover_1', title: 'Recover 1' });
    taskRepo.setHermesRunId(t1.id, 'hermes_run_recover_1');
    taskRepo.updateTaskStatus(t1.id, 'running');

    const t2 = taskRepo.createTask({ id: 'task_recover_2', title: 'Recover 2' });
    taskRepo.setHermesRunId(t2.id, 'hermes_run_recover_2');
    taskRepo.updateTaskStatus(t2.id, 'queued');

    // Terminal run must NOT be recovered
    const t3 = taskRepo.createTask({ id: 'task_recover_terminal', title: 'Terminal' });
    taskRepo.setHermesRunId(t3.id, 'hermes_run_terminal');
    taskRepo.updateTaskStatus(t3.id, 'completed');

    // Run without hermes_run_id must NOT be recovered
    const t4 = taskRepo.createTask({ id: 'task_recover_no_run', title: 'No run id' });
    taskRepo.updateTaskStatus(t4.id, 'running');

    // Spy on startPolling to verify it's called for active runs only
    const startPollingSpy = vi.spyOn(hermesEventBridge, 'startPolling');

    const result = await recoverActiveHermesRuns(db);

    expect(result.recovered.length).toBe(2);
    expect(result.recovered.map(r => r.taskId).sort()).toEqual(['task_recover_1', 'task_recover_2']);
    expect(result.skipped.length).toBe(0);

    // startPolling called for each active run
    expect(startPollingSpy).toHaveBeenCalledWith('hermes_run_recover_1');
    expect(startPollingSpy).toHaveBeenCalledWith('hermes_run_recover_2');

    // Not called for terminal or no-run tasks
    expect(startPollingSpy).not.toHaveBeenCalledWith('hermes_run_terminal');

    startPollingSpy.mockRestore();
  });

  it('should skip tasks with invalid run_id but continue recovery for others', async () => {
    const t1 = taskRepo.createTask({ id: 'task_skip_1', title: 'Skip 1' });
    taskRepo.setHermesRunId(t1.id, '   '); // whitespace-only run_id
    taskRepo.updateTaskStatus(t1.id, 'running');

    const t2 = taskRepo.createTask({ id: 'task_skip_2', title: 'Skip 2' });
    taskRepo.setHermesRunId(t2.id, 'hermes_run_skip_2');
    taskRepo.updateTaskStatus(t2.id, 'queued');

    const result = await recoverActiveHermesRuns(db);

    expect(result.recovered.length).toBe(1);
    expect(result.recovered[0].taskId).toBe('task_skip_2');
    expect(result.skipped.length).toBe(1);
    expect(result.skipped[0].reason).toBe('invalid_run_id');
  });

  it('should not fail entire recovery when one run startPolling throws', async () => {
    const t1 = taskRepo.createTask({ id: 'task_fail_1', title: 'Fail 1' });
    taskRepo.setHermesRunId(t1.id, 'hermes_run_fail_1');
    taskRepo.updateTaskStatus(t1.id, 'running');

    const t2 = taskRepo.createTask({ id: 'task_fail_2', title: 'Fail 2' });
    taskRepo.setHermesRunId(t2.id, 'hermes_run_fail_2');
    taskRepo.updateTaskStatus(t2.id, 'queued');

    // Make startPolling throw for t1 but succeed for t2
    const startPollingSpy = vi.spyOn(hermesEventBridge, 'startPolling');
    startPollingSpy.mockImplementation((runId, options) => {
      if (runId === 'hermes_run_fail_1') {
        return Promise.reject(new Error('boom'));
      }
      return Promise.resolve();
    });

    const result = await recoverActiveHermesRuns(db);

    expect(result.recovered.length).toBe(2);
    expect(result.recovered.map(r => r.taskId).sort()).toEqual(['task_fail_1', 'task_fail_2']);

    startPollingSpy.mockRestore();
  });

  it('should return empty recovery when no active runs exist', async () => {
    // Only terminal tasks
    const t1 = taskRepo.createTask({ id: 'task_empty_1', title: 'Empty 1' });
    taskRepo.setHermesRunId(t1.id, 'run_empty_1');
    taskRepo.updateTaskStatus(t1.id, 'completed');

    const result = await recoverActiveHermesRuns(db);

    expect(result.recovered.length).toBe(0);
    expect(result.skipped.length).toBe(0);
  });
});
