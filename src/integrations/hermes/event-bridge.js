import { hermesAdapter } from './adapter.js';
import { normalizeHermesEvent } from './event-normalizer.js';
import { StateReconciler } from './state-reconciler.js';
import { getDatabase } from '../../database/connection.js';
import logger from '../../utils/logger.js';

/**
 * EventBridge — Polls Hermes API Server SSE endpoint for run events
 * and normalizes them into Bangron internal events for reconciliation.
 */
export class HermesEventBridge {
  constructor(config = {}) {
    this.adapter = config.adapter || hermesAdapter;
    this.reconciler = config.reconciler || new StateReconciler();
    this.pollInterval = config.pollInterval || 5000; // 5 seconds
    this.maxRetries = config.maxRetries || 3;
    this.activePolls = new Map(); // runId -> AbortController
    this.running = false;
    this.runTaskMap = new Map(); // runId -> taskId mapping
  }

  /**
   * Register a run-to-task mapping for event correlation.
   */
  registerRunTaskMapping(runId, taskId) {
    this.runTaskMap.set(runId, taskId);
    logger.debug({ runId, taskId }, 'Registered run-to-task mapping');
  }

  /**
   * Get task ID for a run.
   */
  getTaskIdForRun(runId) {
    return this.runTaskMap.get(runId);
  }

  /**
   * Start polling for a specific run.
   * @param {string} runId - Hermes run ID
   * @param {Object} options - Polling options
   */
  async startPolling(runId, options = {}) {
    if (this.activePolls.has(runId)) {
      logger.debug({ runId }, 'Already polling this run');
      return;
    }

    const controller = new AbortController();
    this.activePolls.set(runId, controller);

    try {
      await this._pollRunEvents(runId, controller.signal, options);
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error({ err, runId }, 'Event bridge polling failed');
      }
    } finally {
      this.activePolls.delete(runId);
      this.runTaskMap.delete(runId);
    }
  }

  /**
   * Stop polling for a specific run.
   */
  stopPolling(runId) {
    const controller = this.activePolls.get(runId);
    if (controller) {
      controller.abort();
      this.activePolls.delete(runId);
      this.runTaskMap.delete(runId);
      logger.debug({ runId }, 'Stopped polling run events');
    }
  }

  /**
   * Stop all polling.
   */
  stopAll() {
    for (const [runId, controller] of this.activePolls) {
      controller.abort();
    }
    this.activePolls.clear();
    this.runTaskMap.clear();
    logger.info('Stopped all event polling');
  }

  /**
   * Internal polling loop for a single run.
   */
  async _pollRunEvents(runId, signal, options = {}) {
    const { 
      onEvent = () => {}, 
      lastEventId = 0,
      lastSeq = -1 
    } = options;

    let currentLastEventId = lastEventId;
    let currentLastSeq = lastSeq;

    logger.info({ runId }, 'Starting SSE event polling for run');

    while (!signal.aborted) {
      try {
        const events = await this._fetchRunEvents(runId, signal);
        
        for (const event of events) {
          if (signal.aborted) break;
          
          // Skip already processed events
          if (event.seq !== undefined && event.seq <= currentLastSeq) continue;
          if (event.id !== undefined && event.id <= currentLastEventId) continue;

          // Normalize and reconcile
          try {
            const normalized = this._normalizeSSEEvent(event, runId);
            
            // Associate with task using runId mapping
            const taskId = this.runTaskMap.get(runId);
            if (taskId && !normalized.task_id) {
              normalized.task_id = taskId;
            }
            
            const result = await this._reconcileEvent(normalized);
            
            if (result.status === 'processed') {
              onEvent(normalized);
            }
          } catch (err) {
            logger.error({ err, runId, event }, 'Failed to process SSE event');
          }
        }

        // Update last seen markers
        if (events.length > 0) {
          const last = events[events.length - 1];
          if (last.seq !== undefined) currentLastSeq = last.seq;
          if (last.id !== undefined) currentLastEventId = last.id;
        }

      } catch (err) {
        if (err.name === 'AbortError') break;
        logger.warn({ err, runId }, 'SSE polling error, retrying...');
        await this._sleep(2000);
      }

      // Wait before next poll
      await this._sleep(1000);
    }

    logger.info({ runId }, 'SSE event polling stopped');
  }

  /**
   * Fetch events from the SSE endpoint.
   * Returns array of parsed events.
   */
  async _fetchRunEvents(runId, signal) {
    const response = await fetch(`${this.adapter.baseUrl}/v1/runs/${runId}/events`, {
      headers: {
        'Authorization': `Bearer ${this.adapter.apiKey}`,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache'
      },
      signal
    });

    if (!response.ok) {
      throw new Error(`SSE fetch failed: ${response.status}`);
    }

    const events = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent = {};
        for (const line of lines) {
          if (line.startsWith('id:')) {
            currentEvent.id = parseInt(line.slice(3).trim(), 10);
          } else if (line.startsWith('event:')) {
            currentEvent.event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            try {
              const data = JSON.parse(line.slice(5).trim());
              currentEvent = { ...currentEvent, ...data };
            } catch (e) {
              // Ignore malformed data
            }
          } else if (line === '') {
            if (Object.keys(currentEvent).length > 0) {
              events.push(currentEvent);
              currentEvent = {};
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    } finally {
      reader.releaseLock();
    }

    return events;
  }

  /**
   * Normalize SSE event to Bangron internal format.
   */
  _normalizeSSEEvent(event, runId) {
    return {
      event_type: event.event || event.type || 'unknown',
      event_id: event.id || event.seq || `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      occurred_at: event.timestamp ? new Date(event.timestamp * 1000).toISOString() : new Date().toISOString(),
      source: 'hermes-sse',
      session_id: event.run_id || event.session_id,
      agent_id: event.agent_id || null,
      instance_id: event.instance_id || null,
      task_id: event.task_id || event.metadata?.bangron_task_id || null,
      payload: {
        ...event,
        run_id: event.run_id,
        delta: event.delta,
        seq: event.seq,
        output: event.output,
        usage: event.usage,
        completed: event.completed,
        failed: event.failed,
        interrupted: event.interrupted,
        turn_exit_reason: event.turn_exit_reason,
        runtime: event.runtime,
        seq: event.seq
      }
    };
  }

  /**
   * Reconcile normalized event via StateReconciler.
   */
  async _reconcileEvent(normalizedEvent) {
    return this.reconciler.reconcile(normalizedEvent);
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const hermesEventBridge = new HermesEventBridge();
export default HermesEventBridge;