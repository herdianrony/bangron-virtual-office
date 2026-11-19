import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { StateReconciler } from '../../src/integrations/hermes/state-reconciler.js';
import { normalizeHermesEvent } from '../../src/integrations/hermes/event-normalizer.js';
import { AgentRepository } from '../../src/database/repositories/agent.repository.js';
import { TaskRepository } from '../../src/database/repositories/task.repository.js';

describe('Hermes Event Normalization, Deduplication & State Reconciliation', () => {
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

    // Create an instance for testing
    agentRepo.createInstance({
      id: 'inst_test_dev',
      profileId: 'prof_dev_backend',
      displayName: 'Test Backend Dev',
      status: 'idle',
      currentRoomId: 'room_dev'
    });

    // Create a task
    taskRepo.createTask({
      id: 'task_test_api',
      title: 'Build REST endpoints',
      assignedAgentId: 'inst_test_dev'
    });
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('normalizes external Hermes hook events into standard internal schema', () => {
    const raw = {
      event: 'agent:start',
      agent_id: 'prof_dev_backend',
      instance_id: 'inst_test_dev',
      task_id: 'task_test_api',
      data: { model: 'hermes-3' }
    };

    const norm = normalizeHermesEvent(raw);
    expect(norm.event_type).toBe('agent.execution.started');
    expect(norm.instance_id).toBe('inst_test_dev');
    expect(norm.task_id).toBe('task_test_api');
    expect(norm.payload.model).toBe('hermes-3');
  });

  it('deduplicates events with identical event_id', () => {
    const event = {
      event_id: 'evt_dup_1001',
      event_type: 'agent.execution.started',
      instance_id: 'inst_test_dev',
      task_id: 'task_test_api',
      payload: {}
    };

    const first = reconciler.reconcile(event);
    expect(first.status).toBe('processed');

    const second = reconciler.reconcile(event);
    expect(second.status).toBe('ignored');
  });

  it('RULE VERIFICATION: post_tool_call does NOT mark task completed', () => {
    // 1. Start execution
    reconciler.reconcile({
      event_id: 'evt_start_1',
      event_type: 'agent.execution.started',
      instance_id: 'inst_test_dev',
      task_id: 'task_test_api',
      payload: {}
    });

    let task = taskRepo.getTaskById('task_test_api');
    expect(task.status).toBe('running');

    // 2. Tool finishes
    reconciler.reconcile({
      event_id: 'evt_tool_done_1',
      event_type: 'agent.tool.completed',
      instance_id: 'inst_test_dev',
      task_id: 'task_test_api',
      payload: { tool_name: 'write_file', success: true }
    });

    task = taskRepo.getTaskById('task_test_api');
    // TASK MUST STILL BE RUNNING!
    expect(task.status).toBe('running');
  });

  it('intercepts high-risk tool actions and pauses task for Director approval', () => {
    reconciler.reconcile({
      event_id: 'evt_deploy_1',
      event_type: 'agent.tool.started',
      instance_id: 'inst_test_dev',
      task_id: 'task_test_api',
      payload: {
        tool_name: 'deploy_production',
        action_type: 'deploy_production'
      }
    });

    const task = taskRepo.getTaskById('task_test_api');
    expect(task.status).toBe('waiting');
    expect(task.requires_approval).toBe(1);

    const pendingApprovals = db.prepare("SELECT * FROM approval_requests WHERE task_id = 'task_test_api'").all();
    expect(pendingApprovals.length).toBe(1);
    expect(pendingApprovals[0].risk_level).toBe('critical');
    expect(pendingApprovals[0].status).toBe('pending');
  });

  it('reconciles parent task completion only when all subtasks are finished', () => {
    // Parent task
    taskRepo.createTask({ id: 'task_parent', title: 'Parent Objective' });
    // Subtask 1 & 2
    taskRepo.createTask({ id: 'sub_1', parentTaskId: 'task_parent', title: 'Sub 1' });
    taskRepo.createTask({ id: 'sub_2', parentTaskId: 'task_parent', title: 'Sub 2' });

    // End subtask 1
    reconciler.reconcile({
      event_id: 'evt_sub1_end',
      event_type: 'agent.execution.ended',
      instance_id: 'inst_test_dev',
      task_id: 'sub_1',
      payload: { success: true }
    });

    expect(taskRepo.getTaskById('sub_1').status).toBe('completed');
    expect(taskRepo.getTaskById('task_parent').status).not.toBe('completed');

    // End subtask 2
    reconciler.reconcile({
      event_id: 'evt_sub2_end',
      event_type: 'agent.execution.ended',
      instance_id: 'inst_test_dev',
      task_id: 'sub_2',
      payload: { success: true }
    });

    expect(taskRepo.getTaskById('sub_2').status).toBe('completed');
    // Now parent task is automatically reconciled as completed!
    expect(taskRepo.getTaskById('task_parent').status).toBe('completed');
  });
});
