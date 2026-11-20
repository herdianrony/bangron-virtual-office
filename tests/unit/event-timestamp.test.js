// S3 remediation regression tests — deterministic event timestamp parsing.
//
// Covers the shared parser (event-timestamp.js) and the normalizer's
// occurred_at/timestamp resolution: unix seconds, unix milliseconds,
// ISO-8601 with zone (native Hermes format), occurred_at precedence,
// missing → ingest time, invalid → throw (never silently wrong).
import { describe, it, expect } from 'vitest';
import { parseEventTimestamp } from '../../src/integrations/hermes/event-timestamp.js';
import { normalizeHermesEvent } from '../../src/integrations/hermes/event-normalizer.js';

const BASE = { hook_event_name: 'on_session_start', delivery_id: 'dlv_ts_test' };

describe('parseEventTimestamp — supported formats', () => {
  it('parses unix seconds (number and 10-digit string) deterministically', () => {
    expect(parseEventTimestamp(1763600000)).toBe(1763600000000);
    expect(parseEventTimestamp('1763600000')).toBe(1763600000000);
    expect(parseEventTimestamp(1763600000)).toBe(parseEventTimestamp('1763600000'));
  });

  it('parses unix milliseconds (number and 13-digit string)', () => {
    expect(parseEventTimestamp(1763600000123)).toBe(1763600000123);
    expect(parseEventTimestamp('1763600000123')).toBe(1763600000123);
  });

  it('parses ISO-8601 Zulu with and without fractional seconds (native Hermes format)', () => {
    const expected = Date.UTC(2026, 10, 20, 5, 30, 0);
    expect(parseEventTimestamp('2026-11-20T05:30:00Z')).toBe(expected);
    expect(parseEventTimestamp('2026-11-20T05:30:00.123Z')).toBe(expected + 123);
    expect(parseEventTimestamp('2026-11-20T05:30:00.123456Z')).toBe(expected + 123);
  });

  it('parses ISO-8601 with positive and negative UTC offsets', () => {
    const expected = Date.UTC(2026, 10, 20, 5, 30, 0);
    expect(parseEventTimestamp('2026-11-20T12:30:00+07:00')).toBe(expected);
    expect(parseEventTimestamp('2026-11-20T00:30:00-05:00')).toBe(expected);
  });

  it('accepts the exact magnitude boundaries and rejects ambiguous ones', () => {
    expect(parseEventTimestamp(1000000000)).toBe(1000000000000); // min unix sec
    expect(parseEventTimestamp(9999999999)).toBe(9999999999000); // max unix sec
    expect(parseEventTimestamp(10000000000)).toBeNull(); // 11 digits — ambiguous
    expect(parseEventTimestamp(1000000000000)).toBe(1000000000000); // min unix ms
    expect(parseEventTimestamp(9999999999999)).toBe(9999999999999); // max unix ms
    expect(parseEventTimestamp(10000000000000)).toBeNull(); // 14 digits — ambiguous
  });
});

describe('parseEventTimestamp — invalid and missing input returns null (never guesses)', () => {
  it('rejects calendar rollover instead of silently normalizing it', () => {
    expect(parseEventTimestamp('2026-02-30T00:00:00Z')).toBeNull();
    expect(parseEventTimestamp('2026-13-01T00:00:00Z')).toBeNull();
    expect(parseEventTimestamp('2026-11-20T25:00:00Z')).toBeNull();
    expect(parseEventTimestamp('2026-11-20T00:61:00Z')).toBeNull();
  });

  it('rejects unsupported string shapes', () => {
    expect(parseEventTimestamp('not-a-date')).toBeNull();
    expect(parseEventTimestamp('2026-11-20')).toBeNull(); // date-only, no time/zone
    expect(parseEventTimestamp('1763600000.5')).toBeNull();
    expect(parseEventTimestamp('2026-11-20T05:30:00')).toBeNull(); // no zone
    expect(parseEventTimestamp('2026-11-20T05:30:00+25:00')).toBeNull();
  });

  it('rejects invalid numbers and non-string/non-number types', () => {
    expect(parseEventTimestamp(12345)).toBeNull();
    expect(parseEventTimestamp(-1)).toBeNull();
    expect(parseEventTimestamp(0)).toBeNull();
    expect(parseEventTimestamp(NaN)).toBeNull();
    expect(parseEventTimestamp(Infinity)).toBeNull();
    expect(parseEventTimestamp(1763600000.5)).toBeNull();
    expect(parseEventTimestamp(null)).toBeNull();
    expect(parseEventTimestamp(undefined)).toBeNull();
    expect(parseEventTimestamp('')).toBeNull();
    expect(parseEventTimestamp('   ')).toBeNull();
    expect(parseEventTimestamp({})).toBeNull();
    expect(parseEventTimestamp(true)).toBeNull();
  });

  it('is deterministic — repeated parses of the same input are identical', () => {
    for (const input of [1763600000, '2026-11-20T05:30:00Z', '2026-11-20T12:30:00+07:00']) {
      expect(parseEventTimestamp(input)).toBe(parseEventTimestamp(input));
    }
  });
});

describe('normalizeHermesEvent — occurred_at / timestamp resolution (S3)', () => {
  it('uses occurred_at (ISO) and produces the exact deterministic ISO value', () => {
    const out = normalizeHermesEvent({ ...BASE, occurred_at: '2026-11-20T05:30:00Z' });
    expect(out.occurred_at).toBe(new Date(Date.UTC(2026, 10, 20, 5, 30, 0)).toISOString());
  });

  it('uses a unix-seconds timestamp (the previously broken path)', () => {
    const out = normalizeHermesEvent({ ...BASE, timestamp: 1763600000 });
    expect(out.occurred_at).toBe(new Date(1763600000 * 1000).toISOString());
  });

  it('uses an ISO timestamp (native Hermes outbound-webhook format)', () => {
    const out = normalizeHermesEvent({ ...BASE, timestamp: '2026-11-20T05:30:00.123Z' });
    expect(out.occurred_at).toBe(new Date(Date.UTC(2026, 10, 20, 5, 30, 0, 123)).toISOString());
  });

  it('gives timestamp precedence over occurred_at when both are present', () => {
    const out = normalizeHermesEvent({
      ...BASE,
      timestamp: 1763600000, // 2025-11-20T05:33:20Z
      occurred_at: '2026-11-20T05:30:00Z' // different timestamp
    });
    expect(out.occurred_at).toBe(new Date(1763600000 * 1000).toISOString());
  });

  it('falls back to ingest time ONLY when no timestamp is provided (internal/demo/SSE paths)', () => {
    const before = Date.now();
    const out = normalizeHermesEvent({ ...BASE });
    const after = Date.now();
    const ms = Date.parse(out.occurred_at);
    expect(Number.isNaN(ms)).toBe(false);
    expect(ms).toBeGreaterThanOrEqual(before);
    expect(ms).toBeLessThanOrEqual(after);
  });

  it('throws on an invalid timestamp instead of silently producing a wrong value', () => {
    expect(() => normalizeHermesEvent({ ...BASE, timestamp: 'yesterday' })).toThrow(/Invalid event timestamp/);
    expect(() => normalizeHermesEvent({ ...BASE, occurred_at: '2026-02-30T00:00:00Z' })).toThrow(/Invalid event timestamp/);
  });

  it('is deterministic — identical input normalizes to identical output', () => {
    const input = { ...BASE, timestamp: '2026-11-20T12:30:00+07:00', session_id: 'sess_det' };
    expect(normalizeHermesEvent(input)).toEqual(normalizeHermesEvent(input));
  });

  it('keeps numeric event IDs as strings and uses delivery_id as the stable event ID', () => {
    expect(normalizeHermesEvent({ ...BASE, event_id: 999, timestamp: 1763600000 }).event_id).toBe('999');
    expect(normalizeHermesEvent({ ...BASE, timestamp: 1763600000 }).event_id).toBe('dlv_ts_test');
  });
});
