import { hermesAdapter } from './adapter.js';
import { normalizeHermesEvent } from './event-normalizer.js';
import { StateReconciler } from './state-reconciler.js';
import logger from '../../utils/logger.js';

/**
 * EventBridge — Polls Hermes API Server SSE endpoint for run events
 * and normalizes them into Bangron internal events for reconciliation.
 *
 * SSE Parsing:
 * - Handles LF, CRLF, and standalone CR line endings
 * - Properly concatenates multiple data: lines per event
 * - Keeps SSE event ID as opaque string (no parseInt assumption)
 * - Processes events incrementally as delimiters are received
 * - Supports Last-Event-ID for reconnection (if API supports)
 * - Respects AbortSignal and safely releases reader
 *
 * Endpoint contract: GET /v1/runs/{runId}/events returns text/event-stream.
 * The stream may be finite (batch of events then close) or long-lived
 * (continuous SSE). This implementation handles both: every event is
 * processed as soon as its delimiter is received, without waiting for
 * the stream to end. Last-Event-ID is sent on reconnect if previously
 * observed; whether the Hermes API honors it is unverified.
 */
export class HermesEventBridge {
  constructor(config = {}) {
    this.adapter = config.adapter || hermesAdapter;
    this.reconciler = config.reconciler || new StateReconciler();
    this.pollInterval = config.pollInterval || 5000;
    this.maxRetries = config.maxRetries || 3;
    this.reconciliationBackoffBase = config.reconciliationBackoffBase || 1000;
    this.reconciliationBackoffMax = config.reconciliationBackoffMax || 30000;
    this.activePolls = new Map(); // runId -> { controller, taskId, lastEventId, lastSeq, onEvent }
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
      lastSeq: -1,
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
    let consecutiveErrors = 0;
    let reconciliationFailures = 0;
    const maxConsecutiveErrors = 5;
    const maxReconciliationFailures = 5;

    // Get taskId from mapping
    const taskId = this.runTaskMap.get(runId);
    if (taskId) {
      pollState.taskId = taskId;
    }

    logger.info({ runId, taskId, lastEventId: pollState.lastEventId }, 'Starting SSE event polling for run');

    while (!signal.aborted) {
      try {
        // Fetch and process events incrementally — each event is
        // reconciled as soon as its delimiter is received, before
        // reading the rest of the stream.
        const result = await this._fetchAndProcessRunEvents(runId, signal, pollState);
        consecutiveErrors = 0;

        if (result.terminated) {
          // Terminal event was processed and mapping cleaned up
          reconciliationFailures = 0; // Reset on successful terminal
          break;
        }

        if (result.reconnectNeeded) {
          // Reconciliation failure - apply bounded exponential backoff
          reconciliationFailures++;
          logger.warn({ runId, lastEventId: pollState.lastEventId, lastSeq: pollState.lastSeq, reconciliationFailures },
            'Reconciliation failed, will reconnect from last checkpoint with backoff');

          if (reconciliationFailures >= maxReconciliationFailures) {
            logger.error({ runId, reconciliationFailures }, 'Too many consecutive reconciliation failures, stopping poll');
            break;
          }

          const backoffMs = Math.min(this.reconciliationBackoffBase * Math.pow(2, reconciliationFailures - 1), this.reconciliationBackoffMax);
          logger.warn({ runId, retryIn: backoffMs, attempt: reconciliationFailures }, 'Reconciliation failure, retrying with backoff...');
          await this._sleep(backoffMs);
          // Don't break - the while loop will reconnect
          continue;
        }

        // Stream ended without terminal event (finite batch).
        // Successful stream cycle resets reconciliation failure counter.
        reconciliationFailures = 0;

        // Wait before re-polling to check for new events.
        await this._sleep(this.pollInterval);
      } catch (err) {
        if (err.name === 'AbortError') break;

        consecutiveErrors++;

        // Non-retryable errors: stop polling
        if (err.status && (err.status === 401 || err.status === 403 || err.status === 404)) {
          logger.error({ err, runId, status: err.status }, 'Non-retryable SSE error, stopping poll');
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
    }

    logger.info({ runId }, 'SSE event polling stopped');
  }

  /**
   * Fetch events from SSE endpoint and process each one incrementally
   * as soon as its delimiter is received.
   *
   * Returns { terminated: boolean, reconnectNeeded: boolean } —
   * terminated=true if a terminal event was processed and polling should stop.
   * reconnectNeeded=true if reconciliation failed and we should reconnect from checkpoint.
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = { dataLines: [] };
    // Stateful line ending parser state
    let lastCharWasCR = false;

    // Result accumulator — single exit point via finally
    let result = { terminated: false, reconnectNeeded: false };
    let readerReleased = false;

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Stateful line ending parser: handles LF, CRLF, and standalone CR
        // without losing delimiter state across chunk boundaries.
        const { lines, lastCharWasCR: newLastCharWasCR, remainingBuffer } = this._parseLines(buffer, lastCharWasCR);
        lastCharWasCR = newLastCharWasCR;
        buffer = remainingBuffer;

        for (const rawLine of lines) {
          const line = rawLine;

          if (line === '') {
            // Empty line = event delimiter
            if (
              currentEvent.dataLines.length > 0 ||
              currentEvent.eventType ||
              currentEvent.id
            ) {
              const parsedEvent = this._parseSSEEvent(currentEvent);
              if (parsedEvent) {
                const status = await this._processParsedEvent(
                  parsedEvent, runId, signal, pollState
                );
                if (status === 'terminal') {
                  result = { terminated: true, reconnectNeeded: false };
                  currentEvent = { dataLines: [] };
                  return result; // reader released in finally
                }
                if (status === 'aborted') {
                  result = { terminated: false, reconnectNeeded: false };
                  currentEvent = { dataLines: [] };
                  return result; // reader released in finally
                }
                if (status === 'reconnect') {
                  result = { terminated: false, reconnectNeeded: true };
                  currentEvent = { dataLines: [] };
                  return result; // reader released in finally
                }
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
            } else if (line.slice(6).trim() !== '') {
              logger.warn({ runId, raw: line }, 'Unparseable retry: value in SSE event, ignoring');
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
      // AbortError - result stays as default (terminated: false, reconnectNeeded: false)
    } finally {
      // Single cleanup point for reader lock
      if (!readerReleased) {
        try {
          reader.releaseLock();
          readerReleased = true;
        } catch (releaseErr) {
          // Ignore releaseLock errors - log but don't mask original error
          logger.debug({ err: releaseErr }, 'Reader releaseLock error (ignored)');
        }
      }

      // Decoder flush: final decode without stream:true to emit any
      // remaining buffered bytes. Process any complete events from flush.
      let flushBuffer = buffer;
      try {
        flushBuffer += decoder.decode(); // flush remaining bytes
      } catch (decodeErr) {
        // Decoder flush failure - do not advance any checkpoint
        // Log and treat as recoverable failure (reconnect needed)
        logger.error({ err: decodeErr, runId }, 'Decoder flush failed - will reconnect from last checkpoint');
        result = { terminated: false, reconnectNeeded: true };
      }

      // Process any remaining lines after flush (only if no prior error set result)
      if (!result.reconnectNeeded && !result.terminated) {
        const { lines, remainingBuffer } = this._parseLines(flushBuffer, lastCharWasCR);
        flushBuffer = remainingBuffer;

        for (const rawLine of lines) {
          const line = rawLine;
          if (line === '') {
            if (
              currentEvent.dataLines.length > 0 ||
              currentEvent.eventType ||
              currentEvent.id
            ) {
              const parsedEvent = this._parseSSEEvent(currentEvent);
              if (parsedEvent) {
                const status = await this._processParsedEvent(parsedEvent, runId, signal, pollState);
                if (status === 'terminal') {
                  result = { terminated: true, reconnectNeeded: false };
                  break;
                }
                if (status === 'reconnect') {
                  result = { terminated: false, reconnectNeeded: true };
                  break;
                }
                if (status === 'aborted') {
                  result = { terminated: false, reconnectNeeded: false };
                  break;
                }
              }
            }
            currentEvent = { dataLines: [] };
            continue;
          }
          if (line.startsWith('id:')) {
            currentEvent.id = line.slice(3).trim();
          } else if (line.startsWith('event:')) {
            currentEvent.eventType = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentEvent.dataLines.push(line.slice(5));
          } else if (line.startsWith('retry:')) {
            const retry = parseInt(line.slice(6).trim(), 10);
            if (!isNaN(retry) && retry > 0) {
              currentEvent.retry = retry;
            } else if (line.startsWith(':')) {
              continue;
            }
          }
        }
      }

      // Process any event that didn't end with a delimiter (final partial event)
      if (!result.reconnectNeeded && !result.terminated && !signal.aborted &&
        (currentEvent.dataLines.length > 0 || currentEvent.eventType || currentEvent.id)
      ) {
        const parsedEvent = this._parseSSEEvent(currentEvent);
        if (parsedEvent) {
          const status = await this._processParsedEvent(parsedEvent, runId, signal, pollState);
          if (status === 'terminal') {
            result = { terminated: true, reconnectNeeded: false };
          } else if (status === 'reconnect') {
            result = { terminated: false, reconnectNeeded: true };
          } else if (status === 'aborted') {
            result = { terminated: false, reconnectNeeded: false };
          }
        }
      }
    }

    return result;
  }

  /**
   * Stateful line parser that handles LF, CRLF, and standalone CR.
   * Returns { lines: string[], lastCharWasCR: boolean, remainingBuffer: string }.
   */
  _parseLines(input, lastCharWasCR) {
    const lines = [];
    let currentLine = '';
    let i = 0;

    // If previous chunk ended with CR, check if this chunk starts with LF
    if (lastCharWasCR) {
      if (input.length > 0 && input[0] === '\n') {
        // CRLF split across chunks - the LF completes the CRLF
        i = 1;
      } else {
        // Standalone CR - emit empty line as delimiter
        lines.push('');
      }
    }

    while (i < input.length) {
      const ch = input[i];

      if (ch === '\n') {
        // LF found - end of line
        lines.push(currentLine);
        currentLine = '';
      } else if (ch === '\r') {
        // CR found - could be CRLF or standalone CR
        if (i + 1 < input.length && input[i + 1] === '\n') {
          // CRLF - consume both
          lines.push(currentLine);
          currentLine = '';
          i++; // skip the LF
        } else {
          // Standalone CR - end of line
          lines.push(currentLine);
          currentLine = '';
        }
      } else {
        currentLine += ch;
      }
      i++;
    }

    // Track if the last character was CR (for next chunk)
    const newLastCharWasCR = input.length > 0 && input[input.length - 1] === '\r';

    return {
      lines,
      lastCharWasCR: newLastCharWasCR,
      remainingBuffer: currentLine
    };
  }

  /**
   * Process a single parsed SSE event: normalize, reconcile, update
   * tracking state, and invoke the onEvent callback.
   *
   * Returns 'terminal' if the event is terminal, 'aborted' if signal
   * was aborted, 'reconnect' if reconciliation failed (triggering reconnect),
   * 'ok' otherwise.
   *
   * If reconciliation fails, the event is NOT considered processed and
   * lastEventId/lastSeq are NOT advanced.
   */
  async _processParsedEvent(parsedEvent, runId, signal, pollState) {
    if (signal.aborted) return 'aborted';

    // Skip already processed events by seq
    if (parsedEvent.seq !== undefined && parsedEvent.seq <= pollState.lastSeq) {
      return 'ok';
    }

    try {
      const normalized = this._normalizeSSEEvent(parsedEvent, runId);

      // Associate with task using runId mapping
      const mappedTaskId = this.runTaskMap.get(runId);
      if (mappedTaskId && !normalized.task_id) {
        normalized.task_id = mappedTaskId;
      }

      const result = await this._reconcileEvent(normalized);

      if (result.status === 'processed') {
        // Only advance tracking after successful reconciliation
        pollState.onEvent(normalized);

        if (parsedEvent.seq !== undefined) {
          pollState.lastSeq = parsedEvent.seq;
        }
        if (parsedEvent.id !== undefined && typeof parsedEvent.id === 'string' && parsedEvent.id.trim() !== '') {
          pollState.lastEventId = parsedEvent.id.trim();
        }

        // Check for terminal event
        if (
          parsedEvent.event === 'run.completed' ||
          parsedEvent.event === 'run.failed' ||
          parsedEvent.event === 'run.cancelled' ||
          parsedEvent.completed === true ||
          parsedEvent.failed === true ||
          parsedEvent.interrupted === true
        ) {
          logger.info({ runId, event: parsedEvent.event }, 'Terminal event detected, stopping poll');
          // Clean up mapping after terminal event
          this.runTaskMap.delete(runId);
          return 'terminal';
        }
      } else {
        // Reconciliation returned non-processed status (duplicate, ignored, etc.)
        // Don't advance tracking, but don't trigger reconnect either
        logger.debug({ runId, eventId: parsedEvent.id, status: result.status }, 'Event not processed by reconciler');
      }
      return 'ok';
    } catch (err) {
      // Reconciliation FAILED - do NOT advance lastEventId/lastSeq
      // Return 'reconnect' to trigger reconnect from last successful checkpoint
      logger.error({ err, runId, event: parsedEvent }, 'Failed to reconcile SSE event - will reconnect from checkpoint');
      return 'reconnect';
    }
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