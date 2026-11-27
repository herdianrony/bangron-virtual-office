import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Hermes capability detection', () => {
  beforeEach(() => { vi.resetModules(); });

  it('caches capabilities and exposes feature flags', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        object: 'hermes.api_server.capabilities',
        features: { run_submission: true, run_events_sse: true, run_stop: true }
      })
    }));
    globalThis.fetch = fetchMock;
    const { HermesAdapter } = await import('../../src/integrations/hermes/adapter.js');
    const a = new HermesAdapter({ apiUrl: 'http://127.0.0.1:1', apiKey: 'k', runtimeVerified: true });
    const caps = await a.getCapabilities();
    expect(caps.features.run_submission).toBe(true);
    await a.getCapabilities();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.supports('run_stop')).toBe(true);
    expect(a.supports('run_approval')).toBe(false);
  });

  it('fails closed when capabilities cannot be fetched', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    const { HermesAdapter } = await import('../../src/integrations/hermes/adapter.js');
    const a = new HermesAdapter({ apiUrl: 'http://127.0.0.1:1', apiKey: 'k', runtimeVerified: true });
    const caps = await a.getCapabilities();
    expect(caps.features).toEqual({});
    expect(a.supports('run_submission')).toBe(false);
  });
});
