import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Hermes API Server surface', () => {
  let adapter;
  let fetchMock;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.fn(async (url) => ({
      ok: true,
      json: async () => {
        if (String(url).includes('/api/model/options')) return { providers: [{ slug: 'nous', models: ['m1'] }], model: 'm1' };
        if (String(url).includes('/health/detailed')) return { status: 'ok', readiness: { status: 'ok' } };
        if (String(url).includes('/api/sessions')) return { object: 'list', data: [{ id: 's1' }] };
        if (String(url).endsWith('/api/jobs')) return { jobs: [{ id: 'j1' }] };
        if (String(url).includes('/v1/capabilities')) return { features: { run_approval: true, run_clarify: false } };
        return { ok: true };
      }
    }));
    globalThis.fetch = fetchMock;
    const { HermesAdapter } = await import('../../src/integrations/hermes/adapter.js');
    adapter = new HermesAdapter({ apiUrl: 'http://127.0.0.1:1', apiKey: 'k', runtimeVerified: true });
  });

  it('reads model options, detailed health, sessions and jobs', async () => {
    expect((await adapter.getModelOptions()).providers).toHaveLength(1);
    expect((await adapter.getHealthDetailed()).status).toBe('ok');
    expect((await adapter.listSessions()).data).toHaveLength(1);
    expect((await adapter.listJobs()).jobs).toHaveLength(1);
  });

  it('creates and controls jobs', async () => {
    await adapter.createJob({ prompt: 'x', schedule: '0 0 * * *' });
    await adapter.controlJob('j1', 'pause');
    await adapter.deleteJob('j1');
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain('http://127.0.0.1:1/api/jobs');
    expect(urls).toContain('http://127.0.0.1:1/api/jobs/j1/pause');
  });

  it('gates run controls on advertised capabilities', async () => {
    await adapter.getCapabilities();
    expect(adapter.supports('run_approval')).toBe(true);
    expect(adapter.supports('run_clarify')).toBe(false);
    await expect(adapter.resolveApproval('r1', {})).resolves.toBeDefined();
    await expect(adapter.clarifyRun('r1', {})).resolves.toEqual({ error: 'CAPABILITY_UNSUPPORTED' });
  });
});
