// Failed-execution regression tests (Phase 3.2.2 §6).
//
// Verifies the FULL failure chain, not just unrelated unit behavior:
//   Hermes wire event → normalization → StateReconciler → agent lifecycle
//   'failed' → task lifecycle 'failed' → WebSocket publication → frontend
//   store reception.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { StateReconciler } from '../../src/integrations/hermes/state-reconciler.js';
import { normalizeHermesEvent } from '../../src/integrations/hermes/event-normalizer.js';
import { AgentRepository } from '../../src/database/repositories/agent.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';
import { ActivityRepository } from '../../src/database/repositories/activity.repository.js';
import { eventPublisher } from '../../src/realtime/event-publisher.js';
// Frontend store + realtime event handler are plain JS (no DOM at import
// time), so the WS → store contract can be exercised directly in Node.
import { realtimeClient } from '../../public/assets/js/realtime/websocket-client.js';
import { store } from '../../public/assets/js/core/store.js';

// Seed requires a director password of at least 12 characters.
process.env.INITIAL_DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD || 'TestPass123456';

describe('Failed execution — normalization, reconciliation, WS, frontend store', () => {
  let db;
  let reconciler;
  let agentRepo;
  let taskRepo;
  let activityRepo;
  let publishSpy;

  beforeEach(async () => {
    publishSpy = vi.spyOn(eventPublisher, 'publish');
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);

    reconciler = new StateReconciler(db);
    agentRepo = new AgentRepository(db);
    taskRepo = new TaskRepository(db);
    activityRepo = new ActivityRepository(db);

    agentRepo.createInstance({
      id: 'inst_fail_dev',
      profileId: 'prof_dev_backend',
      displayName: 'Failure Test Dev',
      status: 'working',
      currentRoomId: 'room_dev'
    });
    taskRepo.createTask({
      id: 'task_fail_api',
      title: 'Task that will fail',
      assignedAgentId: 'inst_fail_dev'
    });
    taskRepo.updateTaskStatus('task_fail_api', 'running');
  });

  afterEach(() => {
    publishSpy.mockRestore();
    if (reconciler?._pendingCompletedTimers) {
      for (const timer of reconciler._pendingCompletedTimers.values()) clearTimeout(timer);
      reconciler._pendingCompletedTimers.clear();
    }
    if (db) db.close();
  });

  const failedEvent = (overrides = {}) => ({
    event_id: `evt_fail_${Math.random().toString(36).slice(2)}`,
    event_type: 'agent.execution.failed',
    instance_id: 'inst_fail_dev',
    task_id: 'task_fail_api',
    payload: { error: 'Simulated failure', exit_code: 1 },
    ...overrides
  });

  /* ---------------- normalization ---------------- */

  it('normalizes SSE run.failed into agent.execution.failed with error payload', () => {
    const norm = normalizeHermesEvent({
      event: 'run.failed',
      run_id: 'run_123',
      instance_id: 'inst_fail_dev',
      task_id: 'task_fail_api',
      error: 'Model timeout'
    });
    expect(norm.event_type).toBe('agent.execution.failed');
    expect(norm.instance_id).toBe('inst_fail_dev');
    expect(norm.task_id).toBe('task_fail_api');
    expect(norm.payload.error).toBe('Model timeout');
  });

  it('passes explicit agent.execution.failed through with ids and payload intact', () => {
    const norm = normalizeHermesEvent({
      event_type: 'agent.execution.failed',
      event_id: 'evt_wire_1',
      agent_id: 'prof_dev_backend',
      instance_id: 'inst_fail_dev',
      task_id: 'task_fail_api',
      payload: { error: 'Simulated failure', exit_code: 1 }
    });
    expect(norm.event_type).toBe('agent.execution.failed');
    expect(norm.event_id).toBe('evt_wire_1');
    expect(norm.instance_id).toBe('inst_fail_dev');
    expect(norm.task_id).toBe('task_fail_api');
    expect(norm.payload).toEqual({ error: 'Simulated failure', exit_code: 1 });
  });

  /* ---------------- reconciliation ---------------- */

  it('marks the correct agent instance AND task failed, with the error summary', () => {
    const result = reconciler.reconcile(failedEvent());
    expect(result.status).toBe('processed');

    expect(agentRepo.getInstanceById('inst_fail_dev').status).toBe('failed');
    const task = taskRepo.getTaskById('task_fail_api');
    expect(task.status).toBe('failed');
    expect(task.result_summary).toContain('Simulated failure');
  });

  it('publishes agent.status.updated(failed) and task.status.updated over WS', () => {
    reconciler.reconcile(failedEvent());

    const agentCall = publishSpy.mock.calls.find(
      ([t, d]) => t === 'agent.status.updated' && d.agent_instance_id === 'inst_fail_dev'
    );
    expect(agentCall).toBeTruthy();
    expect(agentCall[1].status).toBe('failed');

    const taskCall = publishSpy.mock.calls.find(
      ([t, d]) => t === 'task.status.updated' && d.id === 'task_fail_api'
    );
    expect(taskCall).toBeTruthy();
    expect(taskCall[1].status).toBe('failed');
  });

  it('records an execution.failed activity with the failure payload', () => {
    reconciler.reconcile(failedEvent());
    const activities = activityRepo.getRecentActivities(10, { taskId: 'task_fail_api' });
    const failure = activities.find((a) => a.activity_type === 'execution.failed');
    expect(failure).toBeTruthy();
    expect(failure.description).toContain('Simulated failure');
  });

  it('fails the agent even when the event carries no task_id', () => {
    reconciler.reconcile(failedEvent({ task_id: null }));
    expect(agentRepo.getInstanceById('inst_fail_dev').status).toBe('failed');
  });

  it('ends the Hermes session as failed when session_id is present', () => {
    agentRepo.createSession({
      id: 'sess_fail_1',
      agentInstanceId: 'inst_fail_dev',
      taskId: 'task_fail_api',
      metadata: {}
    });
    reconciler.reconcile(failedEvent({ session_id: 'sess_fail_1' }));
    const session = agentRepo.getSessionById('sess_fail_1');
    expect(session.status).toBe('failed');
  });

  it('treats execution.ended with success:false as a failure', () => {
    reconciler.reconcile({
      event_id: 'evt_end_fail',
      event_type: 'agent.execution.ended',
      instance_id: 'inst_fail_dev',
      task_id: 'task_fail_api',
      payload: { success: false, error: 'boom' }
    });
    expect(agentRepo.getInstanceById('inst_fail_dev').status).toBe('failed');
    expect(taskRepo.getTaskById('task_fail_api').status).toBe('failed');
  });

  it('treats execution.ended with exit_code 1 as a failure', () => {
    reconciler.reconcile({
      event_id: 'evt_end_exit1',
      event_type: 'agent.execution.ended',
      instance_id: 'inst_fail_dev',
      task_id: 'task_fail_api',
      payload: { exit_code: 1 }
    });
    expect(agentRepo.getInstanceById('inst_fail_dev').status).toBe('failed');
    expect(taskRepo.getTaskById('task_fail_api').status).toBe('failed');
  });

  it('deduplicates a repeated failure event', () => {
    const event = failedEvent({ event_id: 'evt_fail_dup' });
    expect(reconciler.reconcile(event).status).toBe('processed');
    expect(reconciler.reconcile(event).status).toBe('ignored');
  });

  /* ---------------- frontend store reception ---------------- */

  it('frontend store applies agent.status.updated(failed) from the WS envelope', () => {
    store.setAgents([{ id: 'inst_fail_dev', display_name: 'Failure Test Dev', status: 'working' }]);
    // Use the REAL envelope produced by the reconciler's publication.
    reconciler.reconcile(failedEvent());
    const agentCall = publishSpy.mock.calls.find(
      ([t, d]) => t === 'agent.status.updated' && d.agent_instance_id === 'inst_fail_dev'
    );
    const envelope = { type: agentCall[0], data: agentCall[1] };
    realtimeClient.handleEvent(envelope);
    expect(store.getAgent('inst_fail_dev').status).toBe('failed');
  });

  it('frontend store applies task.status.updated(failed) from the WS envelope', () => {
    store.setState({ tasks: [{ id: 'task_fail_api', status: 'running' }] });
    reconciler.reconcile(failedEvent());
    const taskCall = publishSpy.mock.calls.find(
      ([t, d]) => t === 'task.status.updated' && d.id === 'task_fail_api'
    );
    realtimeClient.handleEvent({ type: taskCall[0], data: taskCall[1] });
    expect(store.state.tasks.find((t) => t.id === 'task_fail_api').status).toBe('failed');
  });

  it('frontend store tracks runtime disconnect separately from lifecycle', () => {
    store.setAgents([{ id: 'inst_fail_dev', display_name: 'Failure Test Dev', status: 'working' }]);
    realtimeClient.handleEvent({
      type: 'runtime.status.changed',
      data: { connected: false, reason: 'runtime_unavailable', timestamp: new Date().toISOString() }
    });
    expect(store.state.runtimeStatus.connected).toBe(false);
    // Lifecycle untouched by runtime availability.
    expect(store.getAgent('inst_fail_dev').status).toBe('working');
  });
});