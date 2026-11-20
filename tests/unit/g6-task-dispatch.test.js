import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { TaskService } from '../../src/modules/tasks/task.service.js';
import { hermesAdapter } from '../../src/integrations/hermes/adapter.js';
import { hermesEventBridge } from '../../src/integrations/hermes/event-bridge.js';

vi.mock('../../src/integrations/hermes/adapter.js', () => ({
  hermesAdapter: {
    dispatchTaskInstruction: vi.fn()
  }
}));

function createAgentAndTask(db) {
  const agentRepo = new (require('../../src/database/repositories/agent.repository.js').default)(db);
  agentRepo.createInstance({
    id: 'inst_test_agent',
    profileId: 'prof_dev_backend',
    displayName: 'Test Agent',
    status: 'idle',
    currentRoomId: 'room_dev'
  });

  const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
  taskRepo.createTask({
    id: 'task_dispatch_001',
    title: 'Test dispatch task',
    description: 'Test task for G6.1',
    priority: 'normal',
    assignedAgentId: null,
    createdBy: 'director'
  });

  return { agentRepo, taskRepo };
}

describe('G6.1 — TaskService Hermes Dispatch & EventBridge Integration', () => {
  let db;
  let taskService;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    await seedInitialOffice(db);

    taskService = new TaskService(db);
    createAgentAndTask(db);

    hermesEventBridge.stopAll();
  });

  afterEach(() => {
    if (db) db.close();
    hermesEventBridge.stopAll();
    vi.resetAllMocks();
  });

  it('should persist assignment and queued status BEFORE dispatch', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_123',
      runtimeAvailable: true
    });

    const result = await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    // Agent must be queued before polling/dispatch completes
    const agentRepo = new (require('../../src/database/repositories/agent.repository.js').default)(db);
    const agent = agentRepo.getInstanceById('inst_test_agent');
    expect(agent.status).toBe('queued');

    // Task assignment persisted
    const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.assigned_agent_id).toBe('inst_test_agent');

    expect(result.hermesRunId).toBe('hermes_run_123');
    expect(hermesEventBridge.getTaskIdForRun('hermes_run_123')).toBe('task_dispatch_001');
  });

  it('should persist run_id before mapping and polling', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_order',
      runtimeAvailable: true
    });

    await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.hermes_run_id).toBe('hermes_run_order');
    expect(hermesEventBridge.getTaskIdForRun('hermes_run_order')).toBe('task_dispatch_001');
    expect(hermesEventBridge.activePolls.has('hermes_run_order')).toBe(true);

    hermesEventBridge.stopAll();
  });

  it('should reject empty string run_id', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: '',
      runtimeAvailable: true
    });

    await expect(taskService.assignAgent('task_dispatch_001', 'inst_test_agent'))
      .rejects.toThrow('Hermes returned invalid run_id');

    // No run_id persisted, no mapping registered
    const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.hermes_run_id).toBeNull();
  });

  it('should reject whitespace-only run_id', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: '   ',
      runtimeAvailable: true
    });

    await expect(taskService.assignAgent('task_dispatch_001', 'inst_test_agent'))
      .rejects.toThrow('Hermes returned invalid run_id');

    const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.hermes_run_id).toBeNull();
  });

  it('should reject null run_id', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: null,
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

    const agentRepo = new (require('../../src/database/repositories/agent.repository.js').default)(db);
    const agent = agentRepo.getInstanceById('inst_test_agent');
    expect(agent.status).toBe('queued'); // still queued, not 'running'

    const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.hermes_run_id).toBeNull();
    expect(result.hermesRunId).toBeNull();
    expect(hermesEventBridge.activePolls.size).toBe(0);
  });

  it('should throw when Hermes dispatch returns missing run_id', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runtimeAvailable: true
    });

    await expect(taskService.assignAgent('task_dispatch_001', 'inst_test_agent'))
      .rejects.toThrow('Hermes returned invalid run_id');
  });

  it('should not leave mapping before event terminal processed (lifecycle safety)', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_lifecycle',
      runtimeAvailable: true
    });

    const result = await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    expect(result.hermesRunId).toBe('hermes_run_lifecycle');
    expect(hermesEventBridge.getTaskIdForRun('hermes_run_lifecycle')).toBe('task_dispatch_001');

    hermesEventBridge.stopPolling('hermes_run_lifecycle');
    expect(hermesEventBridge.activePolls.has('hermes_run_lifecycle')).toBe(false);
  });

  it('should start polling asynchronously without awaiting SSE completion', async () => {
    let pollingStarted = false;
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_async',
      runtimeAvailable: true
    });

    // Replace startPolling with a tracking mock (avoid spy recursion)
    const originalStartPolling = hermesEventBridge.startPolling;
    let trackingMock;
    trackingMock = async (runId, options) => {
      pollingStarted = true;
      return originalStartPolling(runId, options);
    };
    hermesEventBridge.startPolling = trackingMock;

    const result = await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    expect(pollingStarted).toBe(true);
    expect(result.hermesRunId).toBe('hermes_run_async');

    hermesEventBridge.startPolling = originalStartPolling;
    hermesEventBridge.stopAll();
  });

  // Regression test: fast event overwriting queued state
  it('should keep agent status queued when execution.started arrives before polling completes', async () => {
    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_race',
      runtimeAvailable: true
    });

    const eventOrder = [];
    const originalStartPolling = hermesEventBridge.startPolling.bind(hermesEventBridge);
    vi.spyOn(hermesEventBridge, 'startPolling').mockImplementation(async (runId, options) => {
      eventOrder.push('polling_started');
      // Simulate SSE sending execution.started immediately
      if (options && options.onEvent) {
        setTimeout(() => {
          options.onEvent({
            id: 'evt_race_1',
            event: 'agent.execution.started',
            data: { task_id: 'task_dispatch_001', agent_id: 'inst_test_agent', status: 'working' }
          });
        }, 50);
      }
      return originalStartPolling(runId, options);
    });

    const result = await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Agent should remain queued — the execution.started event must NOT flip
    // status back to working and then be overwritten by queued state
    const agentRepo = new (require('../../src/database/repositories/agent.repository.js').default)(db);
    const agent = agentRepo.getInstanceById('inst_test_agent');
    expect(agent.status).toBe('queued');

    hermesEventBridge.stopAll();
  });
});
