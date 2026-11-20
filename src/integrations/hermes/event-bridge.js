import { hermesAdapter } from './adapter.js';
import { normalizeHermesEvent } from './event-normalizer.js';
import { StateReconciler } from './state-reconciler.js';
import { getDatabase } from '../../database/connection.js';
import logger from '../../utils/logger.js';

/**
 * EventBridge — Polls Hermes API Server SSE endpoint for run events
 * and normalizes them into Bangron internal events for reconciliation.
 * 
 * SSE Parsing:
 * - Handles both LF and CRLF line endings
 * - Properly concatenates multiple data: lines per event
 * - Keeps SSE event ID as opaque string (no parseInt assumption)
 * - Processes events incrementally as delimiters are received
 * - Supports Last-Event-ID for reconnection (if API supports)
 * - Respects AbortSignal and safely releases reader
 */
export class HermesEventBridge {
  constructor(config = {}) {
    this.adapter = config.adapter || hermesAdapter;
    this.reconciler = config.reconciler || new StateReconciler();
    this.pollInterval = config.pollInterval || 5000;
    this.maxRetries = config.maxRetries || 3;
    this.activePolls = new Map(); // runId -> { controller, taskId, lastEventId }
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
   * @param {string} [options.lastEventId] - Last-Event-ID for resumption
   * @param {Function} [options.onEvent] - Callback for each processed event
   */
  async startPolling(runId, options = {}) {
    if (this.activePolls.has(runId)) {
      logger.debug({ runId }, 'Already polling this run, skipping duplicate');
      return;
    }

    const controller = new AbortController();
    const pollState = {
      controller,
      taskId: null,
      lastEventId: options.lastEventId || null,
      onEvent: options.onEvent || (() => {})
    };
    this.activePolls.set(runId, pollState);

    try {
      await this._pollRunEvents(runId, controller.signal, pollState, options);
    } catch (err) {
      if (err.name !== 'AbortError') {
        logger.error({ err, runId }, 'Event bridge polling failed');
      }
      throw err;
    } finally {
      this.activePolls.delete(runId);
      // Do NOT delete runTaskMap here - keep mapping until terminal event
      // Terminal event handler will clean up
    }
  }

  /**
   * Stop polling for a specific run.
   */
  stopPolling(runId) {
    const pollState = this.activePolls.get(runId);
    if (pollState) {
      pollState.controller.abort();
      this.activePolls.delete(runId);
      // Keep runTaskMap for potential reconnect
      logger.debug({ runId }, 'Stopped polling run events');
    }
  }

  /**
   * Stop all polling.
   */
  stopAll() {
    for (const [runId, pollState] of this.activePolls) {
      pollState.controller.abort();
    }
    this.activePolls.clear();
    this.runTaskMap.clear();
    logger.info('Stopped all event polling');
  }

  /**
   * Internal polling loop for a single run.
   * Processes events incrementally as SSE delimiters are received.
   */
  async _pollRunEvents(runId, signal, pollState, options = {}) {
    const { 
      lastSeq = -1 
    } = options;

    let currentLastSeq = lastSeq;
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5;

    // Get taskId from mapping
    const taskId = this.runTaskMap.get(runId);
    if (taskId) {
      pollState.taskId = taskId;
    }

    logger.info({ runId, taskId, lastEventId: pollState.lastEventId }, 'Starting SSE event polling for run');

    while (!signal.aborted) {
      try {
        // Fetch and process events incrementally
        const events = await this._fetchAndProcessRunEvents(runId, signal, pollState);
        consecutiveErrors = 0;
        
        for (const event of events) {
          if (signal.aborted) break;
          
          // Skip already processed events by seq
          if (event.seq !== undefined && event.seq <= currentLastSeq) continue;
          
          // Normalize and reconcile
          try {
            const normalized = this._normalizeSSEEvent(event, runId);
            
            // Associate with task using runId mapping
            const mappedTaskId = this.runTaskMap.get(runId);
            if (mappedTaskId && !normalized.task_id) {
              normalized.task_id = mappedTaskId;
            }
            
            const result = await this._reconcileEvent(normalized);
            
            if (result.status === 'processed') {
              pollState.onEvent(normalized);
            }
            
            // Update last seen seq
            if (event.seq !== undefined) {
              currentLastSeq = event.seq;
            }
            // Update lastEventId for potential reconnection
            if (event.id !== undefined) {
              pollState.lastEventId = String(event.id);
            }
          } catch (err) {
            logger.error({ err, runId, event }, 'Failed to process SSE event');
          }
        }

        // Check for terminal events in this batch
        const hasTerminalEvent = events.some(e => 
          e.event === 'run.completed' || 
          e.event === 'run.failed' || 
          e.event === 'run.cancelled' ||
          e.completed === true ||
          e.failed === true ||
          e.interrupted === true
        );

        if (hasTerminalEvent) {
          logger.info({ runId }, 'Terminal event detected, stopping poll');
          // Clean up mapping after terminal event
          this.runTaskMap.delete(runId);
          break;
        }

      } catch (err) {
        if (err.name === 'AbortError') break;
        
        consecutiveErrors++;
        
        // Non-retryable errors: stop polling
        if (err.status && (err.status === 401 || err.status === 403 || err.status === 404)) {
          logger.error({ err, runId, status: err.status }, 'Non-retryable SSE error, stopping poll');
          // Clean up mapping on auth/not-found errors
          this.runTaskMap.delete(runId);
          break;
        }
        
        // Too many consecutive errors: stop polling
        if (consecutiveErrors >= maxConsecutiveErrors) {
          logger.error({ err, runId, consecutiveErrors }, 'Too many consecutive SSE errors, stopping poll');
          break;
        }
        
        // Retryable errors: exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, consecutiveErrors - 1), 30000);
        logger.warn({ err, runId, retryIn: backoffMs, attempt: consecutiveErrors }, 'SSE polling error, retrying with backoff...');
        await this._sleep(backoffMs);
      }
      
      // Wait before next poll
      await this._sleep(1000);
    }

    logger.info({ runId }, 'SSE event polling stopped');
  }

  /**
   * Fetch events from SSE endpoint and parse incrementally.
   * Returns array of fully parsed events.
   * 
   * SSE Format handling:
   * - Lines separated by LF (\n) or CRLF (\r\n)
   * - Multiple data: lines concatenated with \n before JSON parse
   * - Event delimiter: empty line (after CRLF/LF normalization)
   * - id: field kept as opaque string
   * - retry: field for server-suggested reconnect delay
   */
  async _fetchAndProcessRunEvents(runId, signal, pollState) {
    const headers = {
      'Authorization': `Bearer ${this.adapter.apiKey}`,
      'Accept': 'text/event-stream',
      'Cache-Control': 'no-cache'
    };
    
    // Add Last-Event-ID if we have one for resumption
    if (pollState.lastEventId) {
      headers['Last-Event-ID'] = pollState.lastEventId;
    }

    const response = await fetch(`${this.adapter.baseUrl}/v1/runs/${runId}/events`, {
      headers,
      signal
    });

    if (!response.ok) {
      const status = response.status;
      const error = new Error(`SSE fetch failed: ${status}`);
      error.status = status;
      error.retryable = status === 429 || status >= 500;
      throw error;
    }

    const events = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = { dataLines: [] };

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        // Split on both LF and CRLF
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const rawLine of lines) {
          const line = rawLine; // Don't trim - SSE allows leading/trailing whitespace on field values
          
          if (line === '') {
            // Empty line = event delimiter
            if (currentEvent.dataLines.length > 0 || currentEvent.eventType || currentEvent.id) {
              const parsedEvent = this._parseSSEEvent(currentEvent);
              if (parsedEvent) {
                events.push(parsedEvent);
              }
            }
            currentEvent = { dataLines: [] };
            continue;
          }

          if (line.startsWith('id:')) {
            // SSE event ID - keep as opaque string
            currentEvent.id = line.slice(3).trim();
          } else if (line.startsWith('event:')) {
            currentEvent.eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            // Multiple data: lines are concatenated with \n per SSE spec
            currentEvent.dataLines.push(line.slice(5));
          } else if (line.startsWith('retry:')) {
            // Server-suggested reconnect delay (ms)
            const retry = parseInt(line.slice(6).trim(), 10);
            if (!isNaN(retry) && retry > 0) {
              currentEvent.retry = retry;
            }
          } else if (line.startsWith(':')) {
            // Comment line - ignore
            continue;
          }
          // Unknown field - ignore per SSE spec
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    } finally {
      try {
        reader.releaseLock();
      } catch (e) {
        // Ignore releaseLock errors
      }
    }

    // Process any remaining event in buffer (if stream ended without final newline)
    if ((currentEvent.dataLines.length > 0 || currentEvent.eventType || currentEvent.id) && !signal.aborted) {
      const parsedEvent = this._parseSSEEvent(currentEvent);
      if (parsedEvent) {
        events.push(parsedEvent);
      }
    }

    return events;
  }

  /**
   * Parse a complete SSE event from accumulated fields.
   * Returns null if event is malformed/empty.
   */
  _parseSSEEvent(event) {
    // Concatenate multiple data: lines with \n per SSE spec
    if (event.dataLines.length === 0 && !event.eventType && !event.id) {
      return null;
    }

    const dataStr = event.dataLines.join('\n');
    let data = {};
    
    if (dataStr.trim()) {
      try {
        data = JSON.parse(dataStr);
      } catch (e) {
        logger.warn({ dataStr, error: e.message }, 'Failed to parse SSE event data as JSON, treating as raw');
        data = { raw: dataStr };
      }
    }

    return {
      id: event.id,           // opaque string
      event: event.eventType, // event type (e.g., 'run.completed')
      ...data,                // spread parsed data
      retry: event.retry
    };
  }

  /**
   * Normalize SSE event to Bangron internal format.
   */
  _normalizeSSEEvent(event, runId) {
    // Use the event normalizer for consistent mapping
    const normalized = normalizeHermesEvent({
      ...event,
      event: event.event || event.type,
      run_id: event.run_id,
      timestamp: event.timestamp,
      metadata: event.metadata || {}
    });
    
    return normalized;
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