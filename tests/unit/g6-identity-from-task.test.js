import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { StateReconciler } from '../../src/integrations/hermes/state-reconciler.js';
import { AgentRepository } from '../../src/database/repositories/agent.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';

describe('G6 — SSE identity resolution via assigned task', () => {
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

    agentRepo.createInstance({
      id: 'inst_g6_task',
      profileId: 'prof_dev_backend',
      displayName: 'G6 Task Agent',
      status: 'queued',
      currentRoomId: 'room_dev'
    });
    taskRepo.createTask({
      id: 'task_g6_task',
      title: 'Live SSE probe',
      assignedAgentId: 'inst_g6_task'
    });
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('resolves agent from assigned task when SSE event has no identity fields', () => {
    const result = reconciler.reconcile({
      event_id: 'evt_g6_task_1',
      event_type: 'agent.execution.ended',
      session_id: 'run_g6_1',
      task_id: 'task_g6_task',
      payload: { success: true, output: 'ok' }
    });

    expect(result.status).toBe('processed');
    expect(agentRepo.getInstanceById('inst_g6_task').status).toBe('completed');
    expect(taskRepo.getTaskById('task_g6_task').status).toBe('completed');
  });

  it('does NOT substitute task-assigned agent when an explicit unknown instance is provided', () => {
    reconciler.reconcile({
      event_id: 'evt_g6_task_2',
      event_type: 'agent.execution.ended',
      instance_id: 'inst_nonexistent_explicit',
      session_id: 'run_g6_2',
      task_id: 'task_g6_task',
      payload: { success: true }
    });

    expect(agentRepo.getInstanceById('inst_g6_task').status).toBe('queued');
  });
});
