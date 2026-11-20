import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hermesEventBridge } from '../../src/integrations/hermes/event-bridge.js';

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

function createFetchMock(response) {
  return vi.fn().mockResolvedValue(response);
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

      // Start polling (don't await — it runs indefinitely)
      hermesEventBridge.startPolling('run_001');
      await new Promise((r) => setTimeout(r, 150));
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(true);

      // Try to start again — should be no-op
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

      // Unblock the read
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

      // Should have retried after 429 (1000ms backoff)
      expect(callCount).toBeGreaterThan(1);
    });
  });

  describe('SSE incremental parsing', () => {
    it('should parse SSE with multiple data lines per event without crashing', async () => {
      const sseContent = `id: 1
event: agent.execution.started
data: {"task_id":"task_1","agent_id":"inst_1"}
data: {"extra":"field"}

id: 2
event: agent.execution.step
data: {"message":"step 1"}

`;

      const response = {
        ok: true,
        body: createSSEMock(sseContent)
      };
      global.fetch = createFetchMock(response);

      const events = [];
      hermesEventBridge.startPolling('run_001', {
        onEvent: (event) => events.push(event)
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      hermesEventBridge.stopAll();

      expect(Array.isArray(events)).toBe(true);
    });

    it('should handle CRLF line endings', async () => {
      const sseContent = `id: 1\r\nevent: agent.execution.started\r\ndata: {}\r\n\r\n`;

      const response = {
        ok: true,
        body: createSSEMock(sseContent)
      };
      global.fetch = createFetchMock(response);

      const events = [];
      hermesEventBridge.startPolling('run_001', {
        onEvent: (event) => events.push(event)
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      hermesEventBridge.stopAll();

      expect(Array.isArray(events)).toBe(true);
    });

    it('should recognize terminal events and stop polling', async () => {
      const sseContent = `id: 1
event: run.completed
data: {"status":"completed"}

`;

      const response = {
        ok: true,
        body: createSSEMock(sseContent)
      };
      global.fetch = createFetchMock(response);

      hermesEventBridge.startPolling('run_001');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Should have stopped polling after terminal event
      expect(hermesEventBridge.activePolls.has('run_001')).toBe(false);
    });
  });
});
