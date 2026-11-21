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

// Helper: create a controllable mock SSE stream reader
function createControllableSSEReader() {
  const encoder = new TextEncoder();
  const chunks = [];
  let resolveRead = null;
  let readWaiting = false;
  let closed = false;
  let released = false;

  const readerObj = {
    read: () => {
      if (chunks.length > 0) {
        return Promise.resolve({ done: false, value: chunks.shift() });
      }
      if (closed) {
        return Promise.resolve({ done: true, value: null });
      }
      return new Promise((resolve) => {
        readWaiting = true;
        resolveRead = resolve;
      });
    },
    releaseLock: () => {
      released = true;
    },
    get released() {
      return released;
    }
  };

  return {
    chunks,
    readerObj,
    push: (text) => {
      chunks.push(encoder.encode(text));
      if (readWaiting) {
        readWaiting = false;
        const r = resolveRead;
        resolveRead = null;
        r({ done: false, value: chunks.shift() });
      }
    },
    close: () => {
      closed = true;
      if (readWaiting && chunks.length === 0) {
        readWaiting = false;
        const r = resolveRead;
        resolveRead = null;
        r({ done: true, value: null });
      }
    },
    getReader: () => readerObj
  };
}

// Helper: build SSE text from event objects
function sseEvent(eventObj) {
  const parts = [];
  if (eventObj.id !== undefined) parts.push(`id: ${eventObj.id}`);
  if (eventObj.event !== undefined) parts.push(`event: ${eventObj.event}`);
  if (eventObj.data !== undefined) {
    const dataStr = typeof eventObj.data === 'string' ? eventObj.data : JSON.stringify(eventObj.data);
    dataStr.split('\n').forEach((line) => parts.push(`data: ${line}`));
  }
  parts.push('');
  return parts.join('\n') + '\n';
}

// Helper: create a mock fetch response from a controllable reader
function createFetchFromReader(reader) {
  return vi.fn().mockResolvedValue({
    ok: true,
    body: { getReader: () => reader.getReader() }
  });
}

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
  it('should correctly transition agent to working when execution.started arrives', async () => {
    // Ensure adapter has a valid baseUrl for EventBridge fetch
    hermesAdapter.baseUrl = 'http://localhost:8642';

    hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
      dispatched: true,
      runId: 'hermes_run_race',
      runtimeAvailable: true
    });

    // Create a fresh EventBridge with test database for this test
    const { StateReconciler } = await import('../../src/integrations/hermes/state-reconciler.js');
    const testReconciler = new StateReconciler(db);
    const { HermesEventBridge } = await import('../../src/integrations/hermes/event-bridge.js');
    const testEventBridge = new HermesEventBridge({
      reconciler: testReconciler,
      pollInterval: 50
    });

    // Replace the module's exported singleton
    const eventBridgeModule = await import('../../src/integrations/hermes/event-bridge.js');
    Object.defineProperty(eventBridgeModule, 'hermesEventBridge', {
      value: testEventBridge,
      writable: true,
      configurable: true
    });

    // Re-import TaskService to get the mocked EventBridge
    const { TaskService: FreshTaskService } = await import('../../src/modules/tasks/task.service.js');
    const freshTaskService = new FreshTaskService(db);

    // Create controllable SSE reader with execution.started event
    const reader = createControllableSSEReader();
    reader.push(sseEvent({
      id: 'evt_race_1',
      event: 'agent.execution.started',
      data: { task_id: 'task_dispatch_001', agent_id: 'inst_test_agent', status: 'working' }
    }));
    reader.close();

    global.fetch = createFetchFromReader(reader);

    const result = await freshTaskService.assignAgent('task_dispatch_001', 'inst_test_agent');

    // Wait for SSE polling to process the event
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify agent correctly transitioned to working when execution started
    const agentRepo = new (require('../../src/database/repositories/agent.repository.js').default)(db);
    const agent = agentRepo.getInstanceById('inst_test_agent');
    expect(agent.status).toBe('working');

    // Verify task status transitioned to running
    const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
    const task = taskRepo.getTaskById('task_dispatch_001');
    expect(task.status).toBe('running');

    // Verify event was processed (reconciled) - check event repository
    const eventRepo = new (require('../../src/database/repositories/event.repository.js').default)(db);
    const recordedEvent = eventRepo.findByEventId('evt_race_1');
    expect(recordedEvent).toBeDefined();
    expect(recordedEvent.processing_status).toBe('processed');

    testEventBridge.stopAll();
    hermesEventBridge.stopAll();
  });

  // G6.1.6 — Regression tests for instruction newline formatting
  describe('G6.1.6 — Instruction newline formatting', () => {
    it('should pass instruction with actual newline characters (not literal \\\\n)', async () => {
      hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
        dispatched: true,
        runId: 'hermes_run_newline',
        runtimeAvailable: true
      });

      await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

      const callArgs = hermesAdapter.dispatchTaskInstruction.mock.calls[0][0];
      const instruction = callArgs.instruction;

      // Verify actual newline characters exist
      expect(instruction).toContain('\n');
      // Verify no literal backslash-n sequences as separators
      expect(instruction).not.toMatch(/\\\\n/);
      // Verify structure: blank lines between sections (double newline)
      expect(instruction).toContain('\n\n');
    });

    it('should preserve Task title, Description, Priority, Assigned Agent, and execution request', async () => {
      hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
        dispatched: true,
        runId: 'hermes_run_content',
        runtimeAvailable: true
      });

      await taskService.assignAgent('task_dispatch_001', 'inst_test_agent');

      const callArgs = hermesAdapter.dispatchTaskInstruction.mock.calls[0][0];
      const instruction = callArgs.instruction;

      expect(instruction).toContain('Task: Test dispatch task');
      expect(instruction).toContain('Description: Test task for G6.1');
      expect(instruction).toContain('Priority: normal');
      expect(instruction).toContain('Assigned Agent: Test Agent (Backend Developer)');
      expect(instruction).toContain('Please execute this task and provide a summary of the work completed.');
    });

    it('should handle missing task description correctly', async () => {
      const taskRepo = new (require('../../src/database/repositories/task.repository.js').default)(db);
      taskRepo.createTask({
        id: 'task_no_desc',
        title: 'Task without description',
        description: null,
        priority: 'high',
        assignedAgentId: null,
        createdBy: 'director'
      });

      hermesAdapter.dispatchTaskInstruction.mockResolvedValue({
        dispatched: true,
        runId: 'hermes_run_no_desc',
        runtimeAvailable: true
      });

      await taskService.assignAgent('task_no_desc', 'inst_test_agent');

      const callArgs = hermesAdapter.dispatchTaskInstruction.mock.calls[0][0];
      const instruction = callArgs.instruction;

      expect(instruction).toContain('Description: No description provided.');
      expect(instruction).toContain('Priority: high');
    });
  });
});
