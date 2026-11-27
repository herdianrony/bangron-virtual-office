import { describe, it, expect } from 'vitest';
import { normalizeHermesEvent } from '../../src/integrations/hermes/event-normalizer.js';

describe('SSE event id namespacing', () => {
  it('namespaces seq with run_id so different runs cannot collide', () => {
    const a = normalizeHermesEvent({ event: 'message.delta', run_id: 'run_aaa', seq: 0, delta: 'a' });
    const b = normalizeHermesEvent({ event: 'message.delta', run_id: 'run_bbb', seq: 0, delta: 'b' });
    expect(a.event_id).not.toBe(b.event_id);
    expect(a.event_id).toContain('run_aaa');
  });

  it('keeps explicit webhook delivery_id unchanged', () => {
    const e = normalizeHermesEvent({ hook_event_name: 'on_session_end', delivery_id: 'delivery-xyz' });
    expect(e.event_id).toBe('delivery-xyz');
  });
});
