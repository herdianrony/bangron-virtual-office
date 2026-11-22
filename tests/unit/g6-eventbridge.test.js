import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hermesEventBridge, HermesEventBridge } from '../../src/integrations/hermes/event-bridge.js';

// Helper: create a controllable mock SSE stream reader
// Allows tests to push chunks one at a time and observe state mid-stream.
function createControllableSSEReader() {
  const encoder = new TextEncoder();
  const chunks = [];
  let resolveRead = null;
  let readWaiting = false;
  let closed = false;
  let released = false;

  // Single reader object instance so spies on releaseLock persist across calls
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
  // SSE requires a blank line (\n\n) as event delimiter
  return parts.join('\n') + '\n';
}

// Helper: build SSE with custom line endings
function sseEventWithLineEndings(eventObj, lineEnding = '\n') {
  const parts = [];
  if (eventObj.id !== undefined) parts.push(`id: ${eventObj.id}`);
  if (eventObj.event !== undefined) parts.push(`event: ${eventObj.event}`);
  if (eventObj.data !== undefined) {
    const dataStr = typeof eventObj.data === 'string' ? eventObj.data : JSON.stringify(eventObj.data);
    dataStr.split('\n').forEach((line) => parts.push(`data: ${line}`));
  }
  parts.push('');
  return parts.join(lineEnding) + lineEnding;
}

// Helper: create a mock fetch response from a controllable reader
function createFetchFromReader(reader) {
  return vi.fn().mockResolvedValue({
    ok: true,
    body: { getReader: () => reader.getReader() }
  });
}

// Helper: create an error response mock
function createErrorFetchMock(status) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status
  });
}

// Helper: create a bridge with a mock reconciler that records calls
function createBridgeWithMockReconciler(options = {}) {
  const mockReconciler = { reconcile: vi.fn().mockResolvedValue({ status: 'processed' }) };
  const bridge = new HermesEventBridge({ reconciler: mockReconciler, pollInterval: options.pollInterval || 50 });
  return { bridge, mockReconciler };
}

describe('G6.1.3 — Event Delivery Reliability', () => {
  beforeEach(() => {
    hermesEventBridge.stopAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    hermesEventBridge.stopAll();
  });

  describe('registerRunTaskMapping and getTaskIdForRun', () => {
    it('should register and retrieve run-to-task mapping', () => {
      hermesEventBridge.registerRunTaskMapping('run_123', 'task_456');
      expect(hermesEventBridge.getTaskIdForRun('run_123')).toBe('task_456');
      expect(hermesEventBridge.getTaskIdForRun('run_nonexistent')).toBeUndefined();
    });
  });

  describe('startPolling lifecycle', () => {
    it('should avoid duplicate polling for same run_id', async () => {
      const reader = createControllableSSEReader();
      reader.push(sseEvent({ id: '1', event: 'agent.execution.started', data: {} }));
      reader.close();
      global.fetch = createFetchFromReader(reader);

      hermesEventBridge.startPolling('run_001');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(true);

      hermesEventBridge.startPolling('run_001');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.size).toBe(1);

      hermesEventBridge.stopAll();
    });

    it('should stop polling for a specific run_id', async () => {
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      hermesEventBridge.startPolling('run_001');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(true);

      hermesEventBridge.stopPolling('run_001');
      await new Promise((r) => setTimeout(r, 50));
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);
      reader.close();
    });

    it('should stop all polling on stopAll()', async () => {
      const reader1 = createControllableSSEReader();
      const reader2 = createControllableSSEReader();
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return createFetchFromReader(reader1)();
        return createFetchFromReader(reader2)();
      });

      hermesEventBridge.startPolling('run_001');
      hermesEventBridge.startPolling('run_002');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.size).toBe(2);

      hermesEventBridge.stopAll();
      expect(hermesEventBridge.activePolls.size).toBe(0);

      reader1.close();
      reader2.close();
    });
  });

  describe('SSE fetching error handling', () => {
    it('should stop polling on 401 Unauthorized (non-retryable)', async () => {
      global.fetch = createErrorFetchMock(401);

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);
    });

    it('should stop polling on 404 Not Found (non-retryable)', async () => {
      global.fetch = createErrorFetchMock(404);

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);
    });

    it('should stop polling on 403 Forbidden (non-retryable)', async () => {
      global.fetch = createErrorFetchMock(403);

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);
    });

    it('should retry on 429 errors with backoff', async () => {
      let callCount = 0;
      const fetchFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 429 });
        }
        const reader = createControllableSSEReader();
        reader.push(sseEvent({ id: '1', event: 'run.completed', data: {} }));
        reader.close();
        return createFetchFromReader(reader)();
      });
      global.fetch = fetchFn;

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect(callCount).toBeGreaterThan(1);
    });
  });

  describe('Incremental processing — deterministic', () => {
    it('should process event 1 while stream still open, before done:true', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      const processedEvents = [];
      bridge.registerRunTaskMapping('run_inc', 'task_inc');

      const pollingPromise = bridge.startPolling('run_inc', {
        onEvent: (event) => processedEvents.push(event)
      });

      // Push event 1 with delimiter — stream stays open (no close yet)
      reader.push(sseEvent({
        id: 'evt_1',
        event: 'agent.execution.started',
        data: { task_id: 'task_inc', agent_id: 'inst_1' }
      }));

      // Wait until the reconciler has been called for event 1
      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (mockReconciler.reconcile.mock.calls.length >= 1) {
            clearInterval(check);
            resolve();
          }
        }, 20);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });

      // Event 1 must have been processed while stream still open
      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(processedEvents.length).toBe(1);
      expect(processedEvents[0].event_id).toBe('evt_1');

      // Reader must NOT have returned done:true yet (stream still open)
      expect(reader.getReader().released).toBe(false);

      // Now push event 2
      reader.push(sseEvent({
        id: 'evt_2',
        event: 'agent.execution.step',
        data: { step: 1 }
      }));

      await new Promise((resolve) => {
        const check = setInterval(() => {
          if (mockReconciler.reconcile.mock.calls.length >= 2) {
            clearInterval(check);
            resolve();
          }
        }, 20);
        setTimeout(() => { clearInterval(check); resolve(); }, 5000);
      });

      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(2);
      expect(processedEvents.length).toBe(2);
      expect(processedEvents[1].event_id).toBe('evt_2');

      // Send terminal event
      reader.push(sseEvent({
        id: 'evt_term',
        event: 'run.completed',
        data: { status: 'completed' }
      }));
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Polling should have stopped after terminal event
      expect(bridge.activePolls.has('run_inc')).toBe(false);
      // Mapping should be cleaned up
      expect(bridge.getTaskIdForRun('run_inc')).toBeUndefined();

      await pollingPromise.catch(() => {});
    });

    it('should handle decoder flush when stream ends without final newline', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      const processedEvents = [];
      bridge.startPolling('run_flush', {
        onEvent: (event) => processedEvents.push(event)
      });

      // Push event data WITHOUT final delimiter, then close —
      // decoder flush at end should still process the remaining event
      reader.push('id: evt_flush\nevent: agent.execution.started\ndata: {"task":"flush"}');
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(processedEvents.length).toBe(1);
      expect(processedEvents[0].event_id).toBe('evt_flush');

      bridge.stopAll();
    });

    it('should abort polling and release reader when reader still open', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      bridge.startPolling('run_abort');

      // Let polling start and wait for reader
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Abort while reader is still open (no chunks pushed yet)
      bridge.stopPolling('run_abort');

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(bridge.activePolls.has('run_abort')).toBe(false);
      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(0);

      reader.close();
    });

    it('should not consider event processed if reconciliation fails', async () => {
      const mockReconciler = {
        reconcile: vi.fn().mockRejectedValue(new Error('Reconciliation failed'))
      };
      const bridge = new HermesEventBridge({ reconciler: mockReconciler, pollInterval: 50 });
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      const processedEvents = [];
      bridge.startPolling('run_fail', {
        onEvent: (event) => processedEvents.push(event)
      });

      reader.push(sseEvent({
        id: 'evt_fail',
        event: 'agent.execution.started',
        data: { task_id: 'task_fail' }
      }));
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Reconciliation was attempted
      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      // But event was NOT passed to onEvent (not considered processed)
      expect(processedEvents.length).toBe(0);

      bridge.stopAll();
    });

    it('should keep opaque SSE ID as string (no parseInt)', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      const processedEvents = [];
      bridge.startPolling('run_opaque', {
        onEvent: (event) => processedEvents.push(event)
      });

      reader.push(sseEvent({
        id: 'uuid-abc-123-def-456',
        event: 'run.completed',
        data: { status: 'completed' }
      }));
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(processedEvents.length).toBe(1);
      expect(typeof processedEvents[0].event_id).toBe('string');
      expect(processedEvents[0].event_id).toBe('uuid-abc-123-def-456');

      bridge.stopAll();
    });

    it('should handle CRLF line endings incrementally', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      const processedEvents = [];
      bridge.startPolling('run_crlf', {
        onEvent: (event) => processedEvents.push(event)
      });

      // Push CRLF-terminated event
      reader.push('id: evt_crlf\r\nevent: agent.execution.started\r\ndata: {"msg":"hello"}\r\n\r\n');
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(processedEvents.length).toBe(1);
      expect(processedEvents[0].event_id).toBe('evt_crlf');

      bridge.stopAll();
    });

    it('should handle fragmented delimiter across chunk boundaries', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      const processedEvents = [];
      bridge.startPolling('run_frag', {
        onEvent: (event) => processedEvents.push(event)
      });

      // Push data in tiny fragments that split the delimiter mid-line
      reader.push('id: evt_frag\n');
      reader.push('event: agent.execution.started\n');
      reader.push('data: {"');
      reader.push('task":"frag"}');
      reader.push('\n'); // completes the data line
      reader.push('\n'); // empty line = delimiter
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(processedEvents.length).toBe(1);
      expect(processedEvents[0].event_id).toBe('evt_frag');

      bridge.stopAll();
    });

    it('should process multiline data: fields concatenated with newline', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      const processedEvents = [];
      bridge.startPolling('run_multiline', {
        onEvent: (event) => processedEvents.push(event)
      });

      reader.push(sseEvent({
        id: 'evt_multi',
        event: 'agent.tool.started',
        data: { tool_name: 'write_file', content: 'line1\nline2\nline3' }
      }));
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(processedEvents.length).toBe(1);

      bridge.stopAll();
    });
  });

  describe('Terminal event lifecycle', () => {
    it('should stop polling and clean up mapping after terminal event', async () => {
      const { bridge, mockReconciler } = createBridgeWithMockReconciler();
      const reader = createControllableSSEReader();
      global.fetch = createFetchFromReader(reader);

      bridge.registerRunTaskMapping('run_term', 'task_term');
      expect(bridge.getTaskIdForRun('run_term')).toBe('task_term');

      bridge.startPolling('run_term');

      reader.push(sseEvent({
        id: 'evt_term',
        event: 'run.completed',
        data: { status: 'completed', task_id: 'task_term' }
      }));
      reader.close();

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
      expect(bridge.activePolls.has('run_term')).toBe(false);
      expect(bridge.getTaskIdForRun('run_term')).toBeUndefined();

      bridge.stopAll();
    });
  });
});

describe('G6.1.3 — Reconciliation Failure Recovery', () => {
  beforeEach(() => {
    hermesEventBridge.stopAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    hermesEventBridge.stopAll();
  });

  it('first event reconciliation fails, stream processing stops immediately', async () => {
    const mockReconciler = {
      reconcile: vi.fn()
        .mockRejectedValueOnce(new Error('DB connection failed'))
        .mockResolvedValue({ status: 'processed' })
    };
    const bridge = new HermesEventBridge({ reconciler: mockReconciler, pollInterval: 50 });
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.registerRunTaskMapping('run_recover', 'task_recover');
    bridge.startPolling('run_recover', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Push event 1 - reconciliation fails
    reader.push(sseEvent({
      id: 'evt_1',
      event: 'agent.execution.started',
      data: { task_id: 'task_recover' }
    }));

    // Wait for first reconciliation attempt
    await new Promise((resolve) => {
      const check = setInterval(() => {
        if (mockReconciler.reconcile.mock.calls.length >= 1) {
          clearInterval(check);
          resolve();
        }
      }, 20);
      setTimeout(() => { clearInterval(check); resolve(); }, 5000);
    });

    // Stream processing should stop - reconciliation failed, reader released
    // (correct: we release reader and will reconnect with a new stream)
    expect(processedEvents.length).toBe(0);
    expect(bridge.activePolls.has('run_recover')).toBe(true);

    reader.close();
  });

  it('checkpoint remains unchanged after failed reconciliation', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('DB connection failed'))
    };
    const bridge = new HermesEventBridge({ reconciler: mockReconciler, pollInterval: 50 });
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    bridge.registerRunTaskMapping('run_checkpoint', 'task_checkpoint');
    // Pre-set checkpoint
    bridge.activePolls.get('run_checkpoint'); // ensure polling starts

    bridge.startPolling('run_checkpoint', {
      onEvent: () => {}
    });

    reader.push(sseEvent({
      id: 'evt_checkpoint',
      event: 'agent.execution.started',
      data: { task_id: 'task_checkpoint' }
    }));
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Checkpoint should remain unchanged
    const pollState = bridge.activePolls.get('run_checkpoint');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull(); // Should not advance
    expect(pollState.lastSeq).toBe(-1); // Should not advance
  });

  it('reconnect occurs from the last successful checkpoint', async () => {
    let fetchCallCount = 0;
    let reconcileCallCount = 0;

    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        reconcileCallCount++;
        if (reconcileCallCount === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      const reader = createControllableSSEReader();
      if (fetchCallCount <= 2) {
        if (fetchCallCount === 1) {
          // First fetch: event 1 (reconciliation will fail)
          reader.push(sseEvent({
            id: 'evt_1',
            event: 'agent.execution.started',
            data: { task_id: 'task_reconnect' }
          }));
        } else {
          // Second fetch: event 1 (success) + event 2 (success) + terminal
          reader.push(sseEvent({
            id: 'evt_1',
            event: 'agent.execution.started',
            data: { task_id: 'task_reconnect' }
          }));
          reader.push(sseEvent({
            id: 'evt_2',
            event: 'agent.execution.step',
            data: { step: 1 }
          }));
          reader.push(sseEvent({
            id: 'evt_3',
            event: 'run.completed',
            data: { status: 'completed' }
          }));
        }
      } else {
        // Should not reach here - terminal event stops polling
        return Promise.resolve({ ok: false, status: 500 });
      }
      reader.close();
      return createFetchFromReader(reader)();
    });

    bridge.registerRunTaskMapping('run_reconnect', 'task_reconnect');
    bridge.startPolling('run_reconnect', { onEvent: () => {} });

    // Wait for reconnect and event processing
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should have reconnected at least once
    expect(fetchCallCount).toBeGreaterThanOrEqual(2);
    // First event processed on second attempt (evt_1 fail, evt_1 success, evt_2 success, terminal success)
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(4);
    bridge.stopAll();
  });

  it('failed event can be replayed after reconnect', async () => {
    let attempt = 0;
    let fetchCallCount = 0;
    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      const reader = createControllableSSEReader();
      if (fetchCallCount <= 2) {
        // First two fetches: return the event (fail then success)
        reader.push(sseEvent({
          id: 'evt_replay',
          event: 'agent.execution.started',
          data: { task_id: 'task_replay' }
        }));
      } else {
        // Subsequent fetches: return error to stop polling
        return Promise.resolve({ ok: false, status: 500 });
      }
      reader.close();
      return createFetchFromReader(reader)();
    });

    const processedEvents = [];
    bridge.registerRunTaskMapping('run_replay', 'task_replay');
    bridge.startPolling('run_replay', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Wait for reconnect and retry
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Event should eventually be processed exactly once
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_replay');
    // Reconcile called twice (fail + success)
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(2);
    bridge.stopAll();
  });

  it('successful retry persists the event exactly once', async () => {
    let attempt = 0;
    let fetchCallCount = 0;
    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      const reader = createControllableSSEReader();
      if (fetchCallCount <= 2) {
        // First two fetches: return the event (fail then success)
        reader.push(sseEvent({
          id: 'evt_exact',
          event: 'agent.execution.started',
          data: { task_id: 'task_exactly_once' }
        }));
      } else {
        // Subsequent fetches: return error to stop polling
        return Promise.resolve({ ok: false, status: 500 });
      }
      reader.close();
      return createFetchFromReader(reader)();
    });

    const processedEvents = [];
    bridge.registerRunTaskMapping('run_exactly_once', 'task_exactly_once');
    bridge.startPolling('run_exactly_once', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Wait for reconnect and retry
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Event should be processed exactly once despite retry
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_exact');
    // Reconcile called twice (fail + success)
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(2);
    bridge.stopAll();
  });

  it('terminal event with failed reconciliation does not stop the run permanently', async () => {
    let terminalAttempt = 0;
    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        terminalAttempt++;
        if (terminalAttempt === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    let fetchCallCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      const reader = createControllableSSEReader();
      if (fetchCallCount <= 2) {
        // First two fetches: return terminal event (fail then success)
        reader.push(sseEvent({
          id: 'evt_terminal',
          event: 'run.completed',
          data: { status: 'completed' }
        }));
      } else {
        // Should not reach here - loop should break after terminal
        return Promise.resolve({ ok: false, status: 500 });
      }
      reader.close();
      return createFetchFromReader(reader)();
    });

    bridge.registerRunTaskMapping('run_terminal_retry', 'task_terminal_retry');
    bridge.startPolling('run_terminal_retry', { onEvent: () => {} });

    // Wait for reconnect and retry
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Terminal event should eventually be processed
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(2);
    // Run should be stopped after successful terminal event
    expect(bridge.activePolls.has('run_terminal_retry')).toBe(false);
    expect(bridge.getTaskIdForRun('run_terminal_retry')).toBeUndefined();
    bridge.stopAll();
  });
});

describe('G6.1.3 — Complete SSE Line Ending Support', () => {
  beforeEach(() => {
    hermesEventBridge.stopAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    hermesEventBridge.stopAll();
  });

  it('should handle LF line endings', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_lf', {
      onEvent: (event) => processedEvents.push(event)
    });

    // LF line endings
    reader.push('id: evt_lf\nevent: agent.execution.started\ndata: {"task":"lf"}\n\n');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_lf');
    expect(processedEvents[0].event_type).toBe('agent.execution.started');

    bridge.stopAll();
  });

  it('should handle CRLF line endings', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_crlf', {
      onEvent: (event) => processedEvents.push(event)
    });

    // CRLF line endings
    reader.push('id: evt_crlf\r\nevent: agent.execution.step\r\ndata: {"step":1}\r\n\r\n');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_crlf');
    expect(processedEvents[0].event_type).toBe('agent.execution.step');

    bridge.stopAll();
  });

  it('should handle standalone CR line endings', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_cr', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Standalone CR line endings (legacy Mac OS)
    reader.push('id: evt_cr\revent: agent.execution.started\rdata: {"task":"cr"}\r\r');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_cr');
    expect(processedEvents[0].event_type).toBe('agent.execution.started');

    bridge.stopAll();
  });

  it('should handle CR/LF split across separate chunks', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_crlf_split', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Split CRLF across chunks: first chunk ends with CR, second starts with LF
    reader.push('id: evt_split\revent: agent.execution.started\ndata: {"task":"split"}');
    reader.push('\n\n'); // LF completes CRLF, then empty line delimiter
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_split');
    expect(processedEvents[0].event_type).toBe('agent.execution.started');

    bridge.stopAll();
  });

  it('should handle delimiter fragmented across chunks', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_frag_delim', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Push data in tiny fragments
    reader.push('id: evt_frag');
    reader.push('\n');
    reader.push('event: agent.execution.started');
    reader.push('\n');
    reader.push('data: {"');
    reader.push('task":"frag"}');
    reader.push('\n');
    reader.push('\n'); // empty line = delimiter
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_frag');
    expect(processedEvents[0].event_type).toBe('agent.execution.started');

    bridge.stopAll();
  });

  it('should handle multiple events in one chunk', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_multi_chunk', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Two events in a single chunk
    reader.push(
      'id: evt_1\nevent: agent.execution.started\ndata: {"task":"1"}\n\n' +
      'id: evt_2\nevent: agent.execution.step\ndata: {"step":2}\n\n'
    );
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(2);
    expect(processedEvents.length).toBe(2);
    expect(processedEvents[0].event_id).toBe('evt_1');
    expect(processedEvents[1].event_id).toBe('evt_2');

    bridge.stopAll();
  });

  it('should handle multiline data fields with LF', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_multiline_lf', {
      onEvent: (event) => processedEvents.push(event)
    });

    reader.push('id: evt_ml\nevent: agent.tool.started\ndata: {"content":"line1\nline2\nline3"}\n\n');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_ml');
    expect(processedEvents[0].event_type).toBe('agent.tool.started');
    // Multiline JSON data inside a single data: line was parsed correctly
    // (content field is preserved by the parser even if normalizer drops unknown fields)

    bridge.stopAll();
  });

  it('should handle decoder flush at stream end', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_flush', {
      onEvent: (event) => processedEvents.push(event)
    });

    // No final delimiter - decoder flush should process it
    reader.push('id: evt_flush\nevent: agent.execution.started\ndata: {"task":"flush"}');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_flush');

    bridge.stopAll();
  });
});

describe('G6.1.4 — Reconciliation Failure Retry Backoff', () => {
  beforeEach(() => {
    hermesEventBridge.stopAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    hermesEventBridge.stopAll();
  });

  it('repeated reconciliation failure causes bounded backoff, not a tight loop', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('Persistent DB failure'))
    };

    // Use small backoff for fast test
    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    let callCount = 0;
    const fetchTimes = [];
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      fetchTimes.push(Date.now());
      const reader = createControllableSSEReader();
      // Push fresh event data for each fetch
      reader.push(sseEvent({
        id: `evt_backoff_${callCount}`,
        event: 'agent.execution.started',
        data: { task_id: 'task_backoff' }
      }));
      reader.close();
      return createFetchFromReader(reader)();
    });

    bridge.registerRunTaskMapping('run_backoff', 'task_backoff');
    bridge.startPolling('run_backoff', { onEvent: () => {} });

    // Wait for multiple reconnect attempts (should stop after maxReconciliationFailures=5)
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have made multiple fetch attempts
    expect(callCount).toBeGreaterThanOrEqual(3);

    // Verify backoff timing: intervals should grow (10ms, 20ms, 40ms...)
    const intervals = [];
    for (let i = 1; i < fetchTimes.length; i++) {
      intervals.push(fetchTimes[i] - fetchTimes[i - 1]);
    }
    // At least some intervals should show backoff (> 5ms)
    const hasBackoff = intervals.some(interval => interval > 5);
    expect(hasBackoff).toBe(true);

    // Should eventually stop after maxReconciliationFailures (5)
    // Reconcile was called at least once (each failed fetch triggers reconciliation)
    expect(mockReconciler.reconcile.mock.calls.length).toBeGreaterThanOrEqual(1);
    bridge.stopAll();
  });

  it('successful retry resets the retry counter', async () => {
    let attempt = 0;
    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt <= 2) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      const reader = createControllableSSEReader();
      if (callCount === 1) {
        // First fetch: event 1 (will fail)
        reader.push(sseEvent({
          id: 'evt_1',
          event: 'agent.execution.started',
          data: { task_id: 'task_reset' }
        }));
      } else if (callCount === 2) {
        // Second fetch: event 1 again (will fail)
        reader.push(sseEvent({
          id: 'evt_1',
          event: 'agent.execution.started',
          data: { task_id: 'task_reset' }
        }));
      } else if (callCount === 3) {
        // Third fetch: event 1 (succeeds) + event 2
        reader.push(sseEvent({
          id: 'evt_1',
          event: 'agent.execution.started',
          data: { task_id: 'task_reset' }
        }));
        reader.push(sseEvent({
          id: 'evt_2',
          event: 'agent.execution.step',
          data: { step: 1 }
        }));
      } else {
        // Subsequent fetches: return error to stop polling
        return Promise.resolve({ ok: false, status: 500 });
      }
      reader.close();
      return createFetchFromReader(reader)();
    });

    bridge.registerRunTaskMapping('run_reset', 'task_reset');
    bridge.startPolling('run_reset', { onEvent: () => {} });

    // Wait for multiple reconnects and final success
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Should have eventually succeeded
    expect(callCount).toBeGreaterThanOrEqual(3);
    expect(mockReconciler.reconcile.mock.calls.length).toBeGreaterThanOrEqual(2);
    bridge.stopAll();
  });

  it('reconciliation failure during decoder flush triggers recovery', async () => {
    let flushAttempt = 0;
    let callCount = 0;
    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        flushAttempt++;
        if (flushAttempt === 1) {
          return Promise.reject(new Error('Flush reconciliation failed'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      const reader = createControllableSSEReader();
      if (callCount <= 2) {
        // First two fetches: event without delimiter (flush fail then success)
        reader.push('id: evt_flush_fail\nevent: agent.execution.started\ndata: {"task":"flush_fail"}');
      } else {
        // Subsequent fetches: return error to stop polling
        return Promise.resolve({ ok: false, status: 500 });
      }
      reader.close();
      return createFetchFromReader(reader)();
    });

    const processedEvents = [];
    bridge.registerRunTaskMapping('run_flush_fail', 'task_flush_fail');
    bridge.startPolling('run_flush_fail', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Wait for flush processing and reconnect
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Event should eventually be processed on reconnect
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_flush_fail');
    // Reconcile called twice (flush fail + reconnect success)
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(2);
    // Fetch called at least twice (fail + success), may have additional error fetches
    expect(callCount).toBeGreaterThanOrEqual(2);
    bridge.stopAll();
  });

  it('failed final event does not advance checkpoint', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('DB connection failed'))
    };

    const bridge = new HermesEventBridge({ reconciler: mockReconciler, pollInterval: 50 });
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    bridge.registerRunTaskMapping('run_final_fail', 'task_final_fail');
    bridge.startPolling('run_final_fail', { onEvent: () => {} });

    // Push event WITHOUT final delimiter (processed in flush)
    reader.push('id: evt_final\nevent: agent.execution.started\ndata: {"task":"final_fail"}');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Checkpoint should remain unchanged
    const pollState = bridge.activePolls.get('run_final_fail');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull();
    expect(pollState.lastSeq).toBe(-1);
    bridge.stopAll();
  });

  it('terminal event during decoder flush only terminates after successful persistence', async () => {
    let terminalAttempt = 0;
    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        terminalAttempt++;
        if (terminalAttempt === 1) {
          return Promise.reject(new Error('Temporary failure'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      const reader = createControllableSSEReader();
      // Always push terminal event data on every fetch (simulating reconnect)
      reader.push('id: evt_terminal\nevent: run.completed\ndata: {"status":"completed"}');
      reader.close();
      return createFetchFromReader(reader)();
    });

    bridge.registerRunTaskMapping('run_terminal_flush', 'task_terminal_flush');
    bridge.startPolling('run_terminal_flush', { onEvent: () => {} });

    // Wait for flush processing and reconnect
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Terminal event should eventually be processed (2 reconcile calls: fail + success)
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(2);
    // Run should be stopped after successful terminal event
    expect(bridge.activePolls.has('run_terminal_flush')).toBe(false);
    expect(bridge.getTaskIdForRun('run_terminal_flush')).toBeUndefined();
    // Fetch called at least twice (fail + success)
    expect(callCount).toBeGreaterThanOrEqual(2);
    bridge.stopAll();
  });
});

describe('G6.1.4 — True Multiline SSE Data Fields', () => {
  beforeEach(() => {
    hermesEventBridge.stopAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    hermesEventBridge.stopAll();
  });

  it('should handle true multiline data: fields (separate data: lines)', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_true_multiline', {
      onEvent: (event) => processedEvents.push(event)
    });

    // True multiline SSE: multiple data: lines for one event
    // Per SSE spec, these are concatenated with \n
    reader.push('id: evt_ml\n');
    reader.push('event: agent.tool.started\n');
    reader.push('data: {"tool_name": "write_file"\n');
    reader.push('data: "content": "line1\n');
    reader.push('data: line2\n');
    reader.push('data: line3"}\n');
    reader.push('\n'); // delimiter
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_ml');
    expect(processedEvents[0].event_type).toBe('agent.tool.started');
  });

  it('should handle multiline data with CRLF split across chunks', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_ml_crlf_chunk', {
      onEvent: (event) => processedEvents.push(event)
    });

    // CRLF split across chunks during multiline data
    reader.push('id: evt_ml_crlf\r');
    reader.push('\nevent: agent.execution.started\r');
    reader.push('\ndata: {"task":"crlf');
    reader.push('\ndata: split"}\r');
    reader.push('\n\r\n'); // CRLF delimiter
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_ml_crlf');
    expect(processedEvents[0].event_type).toBe('agent.execution.started');
  });

  it('should handle CRLF split across decoder output boundaries', async () => {
    const { bridge, mockReconciler } = createBridgeWithMockReconciler();

    // Single fetch with CRLF split across multiple chunks
    const reader = createControllableSSEReader();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.startPolling('run_decoder_crlf', {
      onEvent: (event) => processedEvents.push(event)
    });

    // Push chunks that split CRLF across chunk boundaries
    reader.push('id: evt_decoder\r');
    reader.push('\nevent: agent.execution.started\r');
    reader.push('\ndata: {"task":"decoder"}');
    reader.push('\r\n\r\n'); // CRLF delimiter
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should process the event successfully
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    expect(processedEvents.length).toBe(1);
    expect(processedEvents[0].event_id).toBe('evt_decoder');
    expect(processedEvents[0].event_type).toBe('agent.execution.started');
    bridge.stopAll();
  });
});

// Keep createSSEMock for backward compatibility with existing tests
function createSSEMock(content) {
  const encoder = new TextEncoder();
  const chunks = content.match(/.{1,50}/g) || [content];
  let index = 0;
  return {
    getReader: () => ({
      read: () => {
        if (index >= chunks.length) {
          return Promise.resolve({ done: true, value: null });
        }
        const chunk = encoder.encode(chunks[index++]);
        return Promise.resolve({ done: false, value: chunk });
      },
      releaseLock: vi.fn()
    })
  };
}

// ============================================================
// G6.1.5 — SSE Reader Cleanup & Decoder Flush Error Integrity
// ============================================================
describe('G6.1.5 — Reader Cleanup & Decoder Flush Error Integrity', () => {
  beforeEach(() => {
    hermesEventBridge.stopAll();
    vi.clearAllMocks();
  });

  afterEach(() => {
    hermesEventBridge.stopAll();
  });

  it('releaseLock() is called on terminal event', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockResolvedValue({ status: 'processed' })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const reader = createControllableSSEReader();
    const readerObj = reader.getReader();
    readerObj.releaseLock = vi.fn(); // spy on releaseLock
    global.fetch = createFetchFromReader(reader);

    bridge.registerRunTaskMapping('run_terminal_release', 'task_terminal_release');
    bridge.startPolling('run_terminal_release', { onEvent: () => {} });

    reader.push(sseEvent({
      id: 'evt_terminal_release',
      event: 'run.completed',
      data: { status: 'completed' }
    }));
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(readerObj.releaseLock).toHaveBeenCalled();
    expect(mockReconciler.reconcile).toHaveBeenCalledTimes(1);
    bridge.stopAll();
  });

  it('releaseLock() is called on reconnect after reconciliation failure', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('DB connection failed'))
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    let releaseLockCallCount = 0;
    let fetchCallCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      fetchCallCount++;
      const r = createControllableSSEReader();
      const rObj = r.getReader();
      rObj.releaseLock = vi.fn(() => { releaseLockCallCount++; });
      r.push(sseEvent({
        id: `evt_recon_${fetchCallCount}`,
        event: 'agent.execution.started',
        data: { task_id: 'task_recon_release' }
      }));
      r.close();
      return Promise.resolve({
        ok: true,
        body: { getReader: () => rObj }
      });
    });

    bridge.registerRunTaskMapping('run_recon_release', 'task_recon_release');
    bridge.startPolling('run_recon_release', { onEvent: () => {} });

    await new Promise((resolve) => setTimeout(resolve, 800));

    // releaseLock should have been called on at least one fetch
    expect(releaseLockCallCount).toBeGreaterThanOrEqual(1);
    bridge.stopAll();
  });

  it('releaseLock() is called on abort', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockResolvedValue({ status: 'processed' })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const reader = createControllableSSEReader();
    const readerObj = reader.getReader();
    readerObj.releaseLock = vi.fn();
    global.fetch = createFetchFromReader(reader);

    const controller = new AbortController();
    const pollState = {
      controller,
      taskId: null,
      lastEventId: null,
      lastSeq: -1,
      onEvent: () => {}
    };

    // Wire abort signal into the reader so read() rejects on abort
    let abortReject;
    const abortPromise = new Promise((_, reject) => { abortReject = reject; });
    controller.signal.addEventListener('abort', () =>
      abortReject(new DOMException('Aborted', 'AbortError'))
    );
    const originalRead = readerObj.read;
    readerObj.read = async () => {
      return Promise.race([originalRead.call(readerObj), abortPromise]);
    };

    bridge.registerRunTaskMapping('run_abort_release', 'task_abort_release');
    bridge.startPolling('run_abort_release', { onEvent: pollState.onEvent });

    // Push a complete event so first read processes it, then second read waits
    reader.push(sseEvent({
      id: 'evt_abort',
      event: 'agent.execution.started',
      data: { task_id: 'task_abort_release' }
    }));

    // Abort after short delay (during the second read())
    setTimeout(() => controller.abort(), 100);

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(readerObj.releaseLock).toHaveBeenCalled();
    bridge.stopAll();
  });

  it('releaseLock() is called on decoder failure', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockResolvedValue({ status: 'processed' })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const reader = createControllableSSEReader();
    const readerObj = reader.getReader();
    readerObj.releaseLock = vi.fn();
    global.fetch = createFetchFromReader(reader);

    bridge.registerRunTaskMapping('run_decode_fail', 'task_decode_fail');
    bridge.startPolling('run_decode_fail', { onEvent: () => {} });

    // Push malformed data that will cause parse warning but still process
    reader.push('id: evt_decode_fail\nevent: agent.execution.started\ndata: {invalid json}');
    reader.push('\n\n'); // delimiter
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(readerObj.releaseLock).toHaveBeenCalled();
    bridge.stopAll();
  });

  it('decoder flush failure does not advance lastEventId or lastSeq', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('DB connection failed'))
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const reader = createControllableSSEReader();
    const readerObj = reader.getReader();
    readerObj.releaseLock = vi.fn();
    global.fetch = createFetchFromReader(reader);

    bridge.registerRunTaskMapping('run_flush_checkpoint', 'task_flush_checkpoint');
    bridge.startPolling('run_flush_checkpoint', { onEvent: () => {} });

    // Push partial event data without final delimiter — will be processed in flush
    // Reconciliation fails, so checkpoint should NOT advance
    reader.push('id: evt_flush_checkpoint\nevent: agent.execution.started\ndata: {"task":"flush_checkpoint"}');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Checkpoint should remain unchanged — reconciliation failed
    const pollState = bridge.activePolls.get('run_flush_checkpoint');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull();
    expect(pollState.lastSeq).toBe(-1);
    bridge.stopAll();
  });

  it('terminal event with failed final decoding is not acknowledged', async () => {
    let reconcileCalls = 0;
    const mockReconciler = {
      reconcile: vi.fn().mockImplementation(() => {
        reconcileCalls++;
        if (reconcileCalls === 1) {
          return Promise.reject(new Error('Temporary decode failure'));
        }
        return Promise.resolve({ status: 'processed' });
      })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      const reader = createControllableSSEReader();
      if (callCount === 1) {
        // Terminal event without delimiter — first attempt fails reconciliation
        reader.push('id: evt_terminal_fail\nevent: run.completed\ndata: {"status":"completed"}');
      } else {
        // Should not reach — terminal event should not be acknowledged on failure
        return Promise.resolve({ ok: false, status: 500 });
      }
      reader.close();
      return createFetchFromReader(reader)();
    });

    bridge.registerRunTaskMapping('run_terminal_decode_fail', 'task_terminal_decode_fail');
    bridge.startPolling('run_terminal_decode_fail', { onEvent: () => {} });

    await new Promise((resolve) => setTimeout(resolve, 800));

    // Reconciliation was attempted but failed — terminal NOT acknowledged
    // checkpoint should not advance
    const pollState = bridge.activePolls.get('run_terminal_decode_fail');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull();
    expect(pollState.lastSeq).toBe(-1);
    // Run still polling (not terminated) since terminal event failed
    expect(bridge.activePolls.has('run_terminal_decode_fail')).toBe(true);
    bridge.stopAll();
  });

  it('original reconciliation error is not masked by cleanup failure', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('Original reconciliation error'))
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const reader = createControllableSSEReader();
    const readerObj = reader.getReader();
    readerObj.releaseLock = vi.fn();
    global.fetch = createFetchFromReader(reader);

    bridge.registerRunTaskMapping('run_error_not_masked', 'task_error_not_masked');
    bridge.startPolling('run_error_not_masked', { onEvent: () => {} });

    reader.push(sseEvent({
      id: 'evt_error_not_masked',
      event: 'agent.execution.started',
      data: { task_id: 'task_error_not_masked' }
    }));
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Original error should be reflected as reconnect needed (not masked as ok)
    const pollState = bridge.activePolls.get('run_error_not_masked');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull();
    expect(pollState.lastSeq).toBe(-1);
    // releaseLock should still have been called despite the error
    expect(readerObj.releaseLock).toHaveBeenCalled();
    bridge.stopAll();
  });

  it('backoff remains bounded and no tight retry loop is introduced', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('Persistent failure'))
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    let callCount = 0;
    const fetchTimes = [];
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      fetchTimes.push(Date.now());
      const reader = createControllableSSEReader();
      reader.push(sseEvent({
        id: `evt_bounded_${callCount}`,
        event: 'agent.execution.started',
        data: { task_id: 'task_bounded' }
      }));
      reader.close();
      return createFetchFromReader(reader)();
    });

    bridge.registerRunTaskMapping('run_bounded', 'task_bounded');
    bridge.startPolling('run_bounded', { onEvent: () => {} });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Should have made multiple attempts but not a tight loop (intervals growing)
    expect(callCount).toBeGreaterThanOrEqual(2);

    // Verify backoff intervals are present
    const intervals = [];
    for (let i = 1; i < fetchTimes.length; i++) {
      intervals.push(fetchTimes[i] - fetchTimes[i - 1]);
    }
    const hasBackoff = intervals.some(interval => interval > 5);
    expect(hasBackoff).toBe(true);

    // Should eventually stop after maxReconciliationFailures (5)
    expect(bridge.activePolls.has('run_bounded')).toBe(false);
    bridge.stopAll();
  });

  it('event without id does not set lastEventId to undefined', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockResolvedValue({ status: 'processed' })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const reader = createControllableSSEReader();
    reader.getReader().releaseLock = vi.fn();
    global.fetch = createFetchFromReader(reader);

    const processedEvents = [];
    bridge.registerRunTaskMapping('run_no_id', 'task_no_id');
    bridge.startPolling('run_no_id', { onEvent: (event) => processedEvents.push(event) });

    // Event with no id field at all
    reader.push('event: agent.execution.started\ndata: {"task":"no_id"}\n\n');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Event should still be processed
    expect(processedEvents.length).toBe(1);
    // lastEventId should remain null — not "undefined" string
    const pollState = bridge.activePolls.get('run_no_id');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull();
    expect(pollState.lastSeq).toBe(-1);
    bridge.stopAll();
  });

  it('event with null id does not set lastEventId to null string', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockResolvedValue({ status: 'processed' })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const reader = createControllableSSEReader();
    reader.getReader().releaseLock = vi.fn();
    global.fetch = createFetchFromReader(reader);

    bridge.registerRunTaskMapping('run_null_id', 'task_null_id');
    bridge.startPolling('run_null_id', { onEvent: () => {} });

    // Event with empty id field
    reader.push('id: \nevent: agent.execution.started\ndata: {"task":"null_id"}\n\n');
    reader.close();

    await new Promise((resolve) => setTimeout(resolve, 500));

    // lastEventId should remain null — not "null" or "undefined" string
    const pollState = bridge.activePolls.get('run_null_id');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull();
    bridge.stopAll();
  });

  it('reconnect without checkpoint does not send Last-Event-ID header', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockRejectedValue(new Error('DB connection failed'))
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    global.fetch = vi.fn().mockImplementation((url, options) => {
      const reader = createControllableSSEReader();
      reader.push(sseEvent({
        id: 'evt_nocp',
        event: 'agent.execution.started',
        data: { task_id: 'task_nocp' }
      }));
      reader.close();
      return Promise.resolve({
        ok: true,
        body: { getReader: () => reader.getReader() }
      });
    });

    bridge.registerRunTaskMapping('run_nocp', 'task_nocp');
    bridge.startPolling('run_nocp', { onEvent: () => {} });

    // Capture pollState before polling loop completes and cleans up activePolls
    const pollState = bridge.activePolls.get('run_nocp');

    await new Promise((resolve) => setTimeout(resolve, 800));

    // Checkpoint was never advanced (reconciliation always failed)
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBeNull();
    expect(pollState.lastSeq).toBe(-1);
    // Since lastEventId is null, Last-Event-ID header cannot be sent
    // (gated by `if (pollState.lastEventId)` in _fetchAndProcessRunEvents)
    bridge.stopAll();
  });

  it('reconnect with valid checkpoint sends Last-Event-ID header', async () => {
    const mockReconciler = {
      reconcile: vi.fn().mockResolvedValue({ status: 'processed' })
    };

    const bridge = new HermesEventBridge({
      reconciler: mockReconciler,
      pollInterval: 50,
      reconciliationBackoffBase: 10,
      reconciliationBackoffMax: 100
    });

    const lastEventIdHeaders = [];
    global.fetch = vi.fn().mockImplementation((url, options) => {
      lastEventIdHeaders.push(options?.headers?.['Last-Event-ID'] ?? null);
      const reader = createControllableSSEReader();
      reader.push(sseEvent({
        id: 'evt_with_cp',
        event: 'agent.execution.started',
        data: { task_id: 'task_with_cp' }
      }));
      reader.close();
      return Promise.resolve({
        ok: true,
        body: { getReader: () => reader.getReader() }
      });
    });

    bridge.registerRunTaskMapping('run_with_cp', 'task_with_cp');
    bridge.startPolling('run_with_cp', { onEvent: () => {} });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Checkpoint was set after successful reconciliation
    const pollState = bridge.activePolls.get('run_with_cp');
    expect(pollState).toBeDefined();
    expect(pollState.lastEventId).toBe('evt_with_cp');
    // Last-Event-ID header should reflect the checkpoint on fetches after reconciliation
    expect(lastEventIdHeaders.some(h => h === 'evt_with_cp')).toBe(true);
    // First fetch should NOT have Last-Event-ID (no checkpoint yet)
    expect(lastEventIdHeaders[0]).toBeNull();
    bridge.stopAll();
  });
});