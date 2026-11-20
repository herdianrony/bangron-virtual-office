import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { TaskService } from '../../src/modules/tasks/task.service.js';
import { hermesAdapter } from '../../src/integrations/hermes/adapter.js';
import { hermesEventBridge } from '../../src/integrations/hermes/event-bridge.js';

// Mock hermesAdapter.dispatchTaskInstruction
vi.mock('../../src/integrations/hermes/adapter.js', () => ({
  hermesAdapter: {
    dispatchTaskInstruction: vi.fn()
  }
}));

describe('G6.1 — TaskService Hermes Dispatch & EventBridge Integration', () => {
  let db;
  let taskService;
  let taskRepo;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);

    taskService = new TaskService(db);
    taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);

    // Create an agent instance and task for testing
    const agentRepo = new (require('../../src/database/repositories/agent.repository.js').default)(db);
    agentRepo.createInstance({
      id: 'inst_test_agent',
      profileId: 'prof_dev_backend',
      displayName: 'Test Agent',
      status: 'idle',
      currentRoomId: 'room_dev'
    });

    taskRepo.createTask({
      id: 'task_dispatch_001',
      title: 'Test dispatch task',
      description: 'Test task for G6.1',
      priority: 'normal',
      assignedAgentId: null,
      createdBy: 'director'
    });

    hermesEventBridge.stopAll();
  });

  afterEach(() => {
    if (db) db.close();
    hermesEventBridge.stopAll();
    vi.resetAllMocks();
  });

  it('should dispatch task, persist run_id, register mapping, and start polling', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_123',
      runtimeAvailable: true
    });

    const result = await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    expect(result.hermesRunId).toBe('hermes_run_123');
    expect(result.dispatchResult).toBeUndefined();

    // Verify run_id persisted in DB
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.hermes_run_id).toBe('hermes_run_123');

    // Verify run-to-task mapping registered
    expect(hermesEventBridge.getTaskIdForRun('hermes_run_123')).toBe('task_dispatch_001');

    // Verify dispatch was called with correct params
    expect(hermesAdapter.dispatchTaskInstruction).toHaveBeenCalledWith({
      taskId: 'task_dispatch_001',
      instruction: expect.stringContaining('Test dispatch task'),
      agentProfile: expect.objectContaining({
        slug: expect.any(String),
        name: expect.any(String)
      }),
      parameters: {}
    });
  });

  it('should throw when Hermes returns invalid run_id', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: null,
      runtimeAvailable: true
    });

    await expect(taskService.assignAgent('task_dispatch_001', 'inst_test_agent'))
      .rejects.toThrow('Hermes returned invalid run_id');
  });

  it('should throw when Hermes returns missing run_id', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runtimeAvailable: true
    });

    await expect(taskService.assignAgent('task_dispatch_001', 'inst_test_agent'))
      .rejects.toThrow('Hermes returned invalid run_id');
  });

  it('should not leave false running task when dispatch fails', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: false,
      reason: 'HERMES_RUNTIME_UNVERIFIED',
      runtimeAvailable: false
    });

    const result = await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    // Task should exist but without hermes_run_id
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.hermes_run_id).toBeNull();
    expect(result.hermesRunId).toBeNull();
  });

  it('should start polling asynchronously without awaiting SSE completion', async () => {
    let pollingStarted = false;
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_async',
      runtimeAvailable: true
    });

    // Spy on startPolling to verify it's called (not awaited)
    const originalStartPolling = hermesEventBridge.startPolling.bind(hermesEventBridge);
    vi.spyOn(hermesEventBridge, 'startPolling').mockImplementation(async (runId, options) => {
      pollingStarted = true;
      return originalStartPolling(runId, options);
    });

    const result = await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    expect(pollingStarted).toBe(true);
    expect(result.hermesRunId).toBe('hermes_run_async');
  });
});
