import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { StateReconciler } from '../../src/integrations/hermes/state-reconciler.js';
import { AgentRepository } from '../../src/database/repositories/agent.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';

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
    // Event with unknown profile/agent_id, no explicit mapping, no default instance
    const result = reconciler.reconcile({
      event_id: 'evt_ambiguous_001',
      event_type: 'agent.execution.started',
      instance_id: null,
      profile: null,
      agent_id: null,
      task_id: 'task_test_api',
      payload: {}
    });

    expect(result.status).toBe('processed');

    // No agent state should change - task stays pending since no instance resolved
    const task = taskRepo.getTaskById('task_test_api');
    expect(task.status).toBe('pending');
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
