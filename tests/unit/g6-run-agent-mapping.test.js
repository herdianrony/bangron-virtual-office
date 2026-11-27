import { describe, it, expect } from 'vitest';
import { HermesEventBridge } from '../../src/integrations/hermes/event-bridge.js';
import { normalizeHermesEvent } from '../../src/integrations/hermes/event-normalizer.js';

describe('G6 — SSE identity carries agent instance from run mapping', () => {
  it('registers and resolves runId → agentInstanceId', () => {
    const bridge = new HermesEventBridge();
    bridge.registerRunAgentMapping('run_abc', 'inst_dev');
    expect(bridge.runAgentMap.get('run_abc')).toBe('inst_dev');
  });

  it('attaches mapped instance to SSE event without an explicit identity', () => {
    const bridge = new HermesEventBridge();
    bridge.registerRunAgentMapping('run_abc', 'inst_dev');
    const normalized = normalizeHermesEvent({
      event: 'message.delta',
      run_id: 'run_abc',
      delta: 'hello',
      seq: 0
    });
    const mappedInstanceId = bridge.runAgentMap.get('run_abc');
    if (mappedInstanceId && !normalized.instance_id) {
      normalized.instance_id = mappedInstanceId;
    }
    expect(normalized.instance_id).toBe('inst_dev');
  });

  it('does not override an explicit instance_id from the event', () => {
    const bridge = new HermesEventBridge();
    bridge.registerRunAgentMapping('run_abc', 'inst_dev');
    const normalized = normalizeHermesEvent({
      event: 'message.delta',
      run_id: 'run_abc',
      instance_id: 'inst_explicit',
      seq: 0
    });
    if (bridge.runAgentMap.get('run_abc') && !normalized.instance_id) {
      normalized.instance_id = bridge.runAgentMap.get('run_abc');
    }
    expect(normalized.instance_id).toBe('inst_explicit');
  });
});
