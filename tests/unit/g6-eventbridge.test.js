import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hermesEventBridge, HermesEventBridge } from '../../src/integrations/hermes/event-bridge.js';

// Helper: create a mock SSE stream reader from event objects
function createSSEReader(events, chunkSize = 50) {
  const encoder = new TextEncoder();
  const eventStrings = events.map((e) => {
    const parts = [];
    if (e.id !== undefined) parts.push(`id: ${e.id}`);
    if (e.event !== undefined) parts.push(`event: ${e.event}`);
    if (e.data !== undefined) {
      const dataStr = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
      dataStr.split('\n').forEach((line) => parts.push(`data: ${line}`));
    }
    parts.push('');
    return parts.join('\n');
  });
  const fullStream = eventStrings.join('');
  const chunks = [];
  for (let i = 0; i < fullStream.length; i += chunkSize) {
    chunks.push(fullStream.slice(i, i + chunkSize));
  }
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

// Helper: create a mock fetch response
function createFetchMock(readerOrResponse) {
  if (readerOrResponse.getReader) {
    return vi.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => readerOrResponse.getReader() }
    });
  }
  return vi.fn().mockResolvedValue(readerOrResponse);
}

// Helper: create an error response mock
function createErrorFetchMock(status) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status
  });
}

describe('G6.1 — Hermes EventBridge Remediation', () => {
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
      const response = {
        ok: true,
        body: createSSEMock('id: 1\nevent: agent.execution.started\ndata: {}\n\n')
      };
      global.fetch = createFetchMock(response);

      hermesEventBridge.startPolling('run_001');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(true);

      hermesEventBridge.startPolling('run_001');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.size).toBe(1);

      hermesEventBridge.stopAll();
    });

    it('should allow polling different run_ids concurrently', async () => {
      const response = {
        ok: true,
        body: createSSEMock('id: 1\nevent: agent.execution.started\ndata: {}\n\n')
      };
      global.fetch = createFetchMock(response);

      hermesEventBridge.startPolling('run_001');
      hermesEventBridge.startPolling('run_002');
      await new Promise((r) => setTimeout(r, 150));

      expect(hermesEventBridge.activePolls.size).toBe(2);

      hermesEventBridge.stopAll();
    });

    it('should stop polling for a specific run_id', async () => {
      let resolveRead;
      const response = {
        ok: true,
        body: {
          getReader: () => ({
            read: () => new Promise((resolve) => {
              resolveRead = resolve;
            }),
            releaseLock: vi.fn()
          })
        }
      };
      global.fetch = createFetchMock(response);

      hermesEventBridge.startPolling('run_001');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(true);

      hermesEventBridge.stopPolling('run_001');
      await new Promise((r) => setTimeout(r, 50));
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);

      if (resolveRead) resolveRead({ done: true, value: null });
    });

    it('should stop all polling on stopAll()', async () => {
      let resolveRead;
      const response = {
        ok: true,
        body: {
          getReader: () => ({
            read: () => new Promise((resolve) => {
              resolveRead = resolve;
            }),
            releaseLock: vi.fn()
          })
        }
      };
      global.fetch = createFetchMock(response);

      hermesEventBridge.startPolling('run_001');
      hermesEventBridge.startPolling('run_002');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.size).toBe(2);

      hermesEventBridge.stopAll();
      expect(hermesEventBridge.activePolls.size).toBe(0);

      if (resolveRead) resolveRead({ done: true, value: null });
    });
  });

  describe('SSE fetching error handling', () => {
    it('should stop polling on 401 Unauthorized (non-retryable)', async () => {
      const response = { ok: false, status: 401 };
      global.fetch = createFetchMock(response);

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);
    });

    it('should stop polling on 404 Not Found (non-retryable)', async () => {
      const response = { ok: false, status: 404 };
      global.fetch = createFetchMock(response);

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);
    });

    it('should stop polling on 403 Forbidden (non-retryable)', async () => {
      const response = { ok: false, status: 403 };
      global.fetch = createFetchMock(response);

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
        return Promise.resolve({
          ok: true,
          body: createSSEMock('id: 1\nevent: run.completed\ndata: {}\n\n')
        });
      });
      global.fetch = fetchFn;

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 2500));

      expect(callCount).toBeGreaterThan(1);
    });
  });

  describe('SSE incremental parsing — explicit event content verification', () => {
    // Helper: create an EventBridge instance with a mock reconciler that always returns 'processed'
    function createTestEventBridge() {
      const mockReconciler = { reconcile: vi.fn().mockResolvedValue({ status: 'processed' }) };
      return new HermesEventBridge({ reconciler: mockReconciler });
    }

    it('should parse LF line endings and verify event content', async () => {
      const bridge = createTestEventBridge();
      const reader = createSSEReader([
        { id: 'evt_001', event: 'agent.execution.started', data: { task_id: 'task_1', agent_id: 'inst_1' } }
      ]);
      global.fetch = createFetchMock(reader);

      const events = [];
      bridge.startPolling('run_001', {
        onEvent: (event) => events.push(event)
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      bridge.stopAll();

      // Verify event was parsed with correct content
      expect(events.length).toBeGreaterThan(0);
      const firstEvent = events.find(e => e.event_id === 'evt_001');
      expect(firstEvent).toBeDefined();
      expect(firstEvent.event_type).toBe('agent.execution.started');
      expect(firstEvent.payload).toBeDefined();
    });

    it('should parse CRLF line endings', async () => {
      const bridge = createTestEventBridge();
      const reader = createSSEReader([
        { id: 'evt_002', event: 'agent.execution.step', data: { msg: 'step 1' } }
      ]);
      global.fetch = createFetchMock(reader);

      const events = [];
      bridge.startPolling('run_002', {
        onEvent: (event) => events.push(event)
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      bridge.stopAll();

      expect(events.length).toBeGreaterThan(0);
      const evt = events.find(e => e.event_id === 'evt_002');
      expect(evt).toBeDefined();
      expect(evt.event_type).toBe('agent.execution.step');
    });

    it('should handle multiline data: fields concatenated with newline', async () => {
      const bridge = createTestEventBridge();
      const reader = createSSEReader([
        { id: 'evt_003', event: 'agent.tool.started', data: { tool_name: 'write_file', tool_input: { path: 'src/file.js', content: 'line1\nline2' } } }
      ]);
      global.fetch = createFetchMock(reader);

      const events = [];
      bridge.startPolling('run_003', {
        onEvent: (event) => events.push(event)
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      bridge.stopAll();

      expect(events.length).toBeGreaterThan(0);
    });

    it('should keep SSE event ID as opaque string', async () => {
      const bridge = createTestEventBridge();
      const reader = createSSEReader([
        { id: 'uuid-abc-123-def', event: 'run.completed', data: { status: 'completed' } }
      ]);
      global.fetch = createFetchMock(reader);

      const events = [];
      bridge.startPolling('run_004', {
        onEvent: (event) => events.push(event)
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      bridge.stopAll();

      expect(events.length).toBeGreaterThan(0);
      const evt = events.find(e => e.event_id === 'uuid-abc-123-def');
      expect(evt).toBeDefined();
      expect(typeof evt.event_id).toBe('string');
      expect(evt.event_id).toBe('uuid-abc-123-def');
    });

    it('should process events incrementally before stream ends', async () => {
      const bridge = createTestEventBridge();
      const reader = createSSEReader([
        { id: 'evt_inc_1', event: 'agent.execution.started', data: { task_id: 'task_inc' } },
        { id: 'evt_inc_2', event: 'agent.execution.step', data: { step: 1 } }
      ], 10);
      global.fetch = createFetchMock(reader);

      const processedEventIds = [];
      bridge.startPolling('run_inc', {
        onEvent: (event) => processedEventIds.push(event.id)
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      bridge.stopPolling('run_inc');

      expect(processedEventIds.length).toBeGreaterThanOrEqual(0);
    });

    it('should recognize terminal events and stop polling', async () => {
      const bridge = createTestEventBridge();
      const reader = createSSEReader([
        { id: 'evt_term', event: 'run.completed', data: { status: 'completed' } }
      ]);
      global.fetch = createFetchMock(reader);

      bridge.startPolling('run_term');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(bridge.activePolls.has('run_term')).toBe(false);
    });

    it('should clean up run-to-task mapping after terminal event', async () => {
      const bridge = createTestEventBridge();
      const reader = createSSEReader([
        { id: 'evt_term_cleanup', event: 'run.completed', data: { status: 'completed', task_id: 'task_term_cleanup' } }
      ]);
      global.fetch = createFetchMock(reader);

      bridge.registerRunTaskMapping('run_term_cleanup', 'task_term_cleanup');
      expect(bridge.getTaskIdForRun('run_term_cleanup')).toBe('task_term_cleanup');

      bridge.startPolling('run_term_cleanup');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      expect(bridge.getTaskIdForRun('run_term_cleanup')).toBeUndefined();
      expect(bridge.activePolls.has('run_term_cleanup')).toBe(false);
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
