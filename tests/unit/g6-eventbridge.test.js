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

  return {
    chunks,
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
    getReader: () => ({
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
    })
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

describe('G6.1.2 — SSE Incremental Processing', () => {
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
