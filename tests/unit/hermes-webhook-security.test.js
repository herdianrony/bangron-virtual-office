// S1 + S2 remediation regression tests (Final Technical Review findings).
//
// S1: GET /api/integrations/hermes/status must require an authenticated
//     Director — anonymous clients get 401, non-Director 403, and never see
//     runtime metadata or recent event payloads.
// S2: /events webhook replay protection —
//     - freshness timestamp must live INSIDE the HMAC-signed body (native
//       Hermes contract: delivery_id + ISO-8601 timestamp in the signed body,
//       verified against Hermes v0.23.2 agent/outbound_webhooks.py),
//     - a stable delivery/event ID is required (no silent random IDs),
//     - invalid/missing/expired/tampered timestamps are rejected,
//     - duplicate deliveries are rejected with 409 and not reprocessed.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) } }));

const DIRECTOR_EMAIL = 'director@bangron.office';
const DIRECTOR_PASSWORD = 'TestPass123456';
const VIEWER_EMAIL = 'viewer@bangron.office';
const VIEWER_PASSWORD = 'ViewerPass123456';
const WEBHOOK_SECRET = 'webhook-security-test-secret-0123456789';

describe('Hermes webhook security — S1 status authorization + S2 replay protection', () => {
  let app;
  let sessionStore;
  let db;
  let closeDatabase;
  let eventPublisher;
  let HermesAdapter;
  let EventRepository;
  let AgentRepository;

  async function loginAs(email, password) {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] || []).find((h) => h.startsWith('bvo_session='));
    return { cookie: cookie.split(';')[0], csrfToken: res.body.data.csrfToken };
  }

  // Sign the EXACT raw bytes we send (mirrors the native Hermes contract:
  // X-Hermes-Signature-256: sha256=<hex> over the raw body).
  function signedPost(path, payload, { secret = WEBHOOK_SECRET, headers = {}, rawOverride = null } = {}) {
    const raw = rawOverride !== null ? rawOverride : JSON.stringify(payload);
    const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');
    return request(app)
      .post(path)
      .set('Content-Type', 'application/json')
      .set('X-Hermes-Signature-256', sig)
      .set(headers)
      .send(raw);
  }

  function nativePayload(overrides = {}) {
    return {
      hook_event_name: 'on_session_start',
      profile: 'default',
      session_id: `sess_whsec_${crypto.randomBytes(4).toString('hex')}`,
      instance_id: 'inst_wh_sec',
      delivery_id: crypto.randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      ...overrides
    };
  }

  beforeAll(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    process.env.SESSION_SECRET = 'webhook-security-session-secret-0123456789abcdef';
    process.env.INITIAL_DIRECTOR_EMAIL = DIRECTOR_EMAIL;
    process.env.INITIAL_DIRECTOR_PASSWORD = DIRECTOR_PASSWORD;
    process.env.HERMES_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.HERMES_API_URL = 'http://127.0.0.1:59999'; // dead port — never a live runtime
    delete process.env.AUTH_RATE_LIMIT_MAX;
    delete process.env.ENABLE_TEST_ROUTES;

    const connection = await import('../../src/database/connection.js');
    closeDatabase = connection.closeDatabase;
    const { runMigrations } = await import('../../src/database/migrations/runner.js');
    const { seedInitialOffice } = await import('../../src/database/seeds/initial_office.js');
    db = connection.getDatabase();
    runMigrations(db);
    await seedInitialOffice(db);

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run('Viewer', VIEWER_EMAIL, bcrypt.hashSync(VIEWER_PASSWORD, 10), 'viewer', now, now);

    ({ AgentRepository } = await import('../../src/database/repositories/agent.repository.js'));
    const agentRepo = new AgentRepository(db);
    agentRepo.createInstance({
      id: 'inst_wh_sec',
      profileId: 'prof_dev_backend',
      displayName: 'Webhook Security Agent',
      status: 'idle',
      currentRoomId: 'room_dev'
    });

    const { createApp } = await import('../../src/app.js');
    ({ app, sessionStore } = createApp());
    ({ eventPublisher } = await import('../../src/realtime/event-publisher.js'));
    ({ HermesAdapter } = await import('../../src/integrations/hermes/adapter.js'));
    ({ EventRepository } = await import('../../src/database/repositories/event.repository.js'));
  });

  afterAll(() => {
    if (sessionStore) sessionStore.stopCleanup();
    if (closeDatabase) closeDatabase();
  });

  describe('S1 — GET /api/integrations/hermes/status authorization', () => {
    it('rejects anonymous requests with 401 and exposes no runtime metadata', async () => {
      const res = await request(app).get('/api/integrations/hermes/status');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(res.body.data).toBeUndefined();
    });

    it('rejects authenticated non-Director users with 403', async () => {
      const viewer = await loginAs(VIEWER_EMAIL, VIEWER_PASSWORD);
      const res = await request(app)
        .get('/api/integrations/hermes/status')
        .set('Cookie', viewer.cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.data).toBeUndefined();
    });

    it('serves runtime status + recent events to an authenticated Director (settings UI path)', async () => {
      const runtimeSpy = vi.spyOn(HermesAdapter.prototype, 'getRuntimeStatus').mockResolvedValue({
        connected: false,
        runtimeVerified: false,
        apiUrl: 'http://127.0.0.1:59999',
        status: 'RUNTIME_UNVERIFIED',
        message: 'simulated for test'
      });
      const director = await loginAs(DIRECTOR_EMAIL, DIRECTOR_PASSWORD);
      const res = await request(app)
        .get('/api/integrations/hermes/status')
        .set('Cookie', director.cookie);
      expect(res.status).toBe(200);
      expect(res.body.data.runtime.runtimeVerified).toBe(false);
      expect(Array.isArray(res.body.data.recentEvents)).toBe(true);
      runtimeSpy.mockRestore();
    });
  });

  describe('S2 — /events webhook contract and replay protection', () => {
    it('accepts a valid native Hermes event (signed body timestamp, delivery_id, sha256= prefix, no timestamp header)', async () => {
      const payload = nativePayload();
      const res = await signedPost('/api/integrations/hermes/events', payload, {
        headers: { 'X-Hermes-Delivery': payload.delivery_id, 'X-Hermes-Event': 'on_session_start' }
      });
      expect(res.status).toBe(200);
      expect(res.body.data.reconciled_status).toBe('processed');
      const row = new EventRepository(db).findByEventId(payload.delivery_id);
      expect(row.processing_status).toBe('processed');
      expect(new AgentRepository(db).getInstanceById('inst_wh_sec').status).toBe('working');
    });

    it('rejects an invalid signature with 401 INVALID_SIGNATURE', async () => {
      const res = await signedPost('/api/integrations/hermes/events', nativePayload(), {
        secret: 'the-wrong-secret'
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('rejects a missing signature header with 401 MISSING_SIGNATURE', async () => {
      const payload = nativePayload();
      const res = await request(app)
        .post('/api/integrations/hermes/events')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_SIGNATURE');
    });

    it('rejects a missing signed timestamp with 401 MISSING_SIGNED_TIMESTAMP', async () => {
      const payload = nativePayload();
      delete payload.timestamp;
      const res = await signedPost('/api/integrations/hermes/events', payload);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_SIGNED_TIMESTAMP');
    });

    it('rejects an expired timestamp (past AND beyond future drift) with 401 TIMESTAMP_DRIFT', async () => {
      const past = nativePayload({ timestamp: new Date(Date.now() - 400 * 1000).toISOString() });
      const resPast = await signedPost('/api/integrations/hermes/events', past);
      expect(resPast.status).toBe(401);
      expect(resPast.body.error.code).toBe('TIMESTAMP_DRIFT');

      const future = nativePayload({ timestamp: new Date(Date.now() + 400 * 1000).toISOString() });
      const resFuture = await signedPost('/api/integrations/hermes/events', future);
      expect(resFuture.status).toBe(401);
      expect(resFuture.body.error.code).toBe('TIMESTAMP_DRIFT');
    });

    it('rejects a modified body timestamp with an unchanged signature (HMAC covers the body)', async () => {
      const payload = nativePayload();
      const originalRaw = JSON.stringify(payload);
      const tamperedRaw = JSON.stringify({ ...payload, timestamp: new Date(Date.now() + 120 * 1000).toISOString() });
      // Sign the ORIGINAL bytes, send the TAMPERED bytes with the original signature.
      const sig = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(originalRaw).digest('hex');
      const res = await request(app)
        .post('/api/integrations/hermes/events')
        .set('Content-Type', 'application/json')
        .set('X-Hermes-Signature-256', sig)
        .send(tamperedRaw);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    it('rejects a modified legacy timestamp header that disagrees with the signed body', async () => {
      const payload = nativePayload();
      const res = await signedPost('/api/integrations/hermes/events', payload, {
        headers: { 'x-hermes-timestamp': String(Math.floor(Date.now() / 1000) + 200) }
      });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('TIMESTAMP_HEADER_MISMATCH');
    });

    it('rejects a missing stable event/delivery ID with 401 MISSING_STABLE_EVENT_ID (no silent random ID)', async () => {
      const payload = nativePayload();
      delete payload.delivery_id;
      const res = await signedPost('/api/integrations/hermes/events', payload);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('MISSING_STABLE_EVENT_ID');
    });

    it('rejects a malformed timestamp with 401 INVALID_TIMESTAMP', async () => {
      const payload = nativePayload({ timestamp: 'not-a-timestamp' });
      const res = await signedPost('/api/integrations/hermes/events', payload);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TIMESTAMP');
    });

    it('rejects a duplicate delivery with 409 DUPLICATE_EVENT and does not reprocess it', async () => {
      const payload = nativePayload({ session_id: 'sess_whsec_dup' });
      const publishSpy = vi.spyOn(eventPublisher, 'publish');

      const first = await signedPost('/api/integrations/hermes/events', payload);
      expect(first.status).toBe(200);
      expect(first.body.data.reconciled_status).toBe('processed');

      const second = await signedPost('/api/integrations/hermes/events', payload);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('DUPLICATE_EVENT');

      // Exactly one lifecycle broadcast for the instance — the replay changed nothing.
      const statusCalls = publishSpy.mock.calls.filter(
        ([type, data]) => type === 'agent.status.updated' && data.agent_instance_id === 'inst_wh_sec'
      );
      expect(statusCalls).toHaveLength(1);
      expect(new EventRepository(db).findByEventId(payload.delivery_id).processing_status).toBe('processed');
      publishSpy.mockRestore();
    });

    it('still accepts the legacy Bangron contract (event_id + unix body timestamp + matching unix header)', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const payload = {
        event_id: `legacy-${crypto.randomBytes(6).toString('hex')}`,
        event_type: 'agent.execution.step',
        instance_id: 'inst_wh_sec',
        timestamp: nowSec
      };
      const res = await signedPost('/api/integrations/hermes/events', payload, {
        headers: { 'x-hermes-timestamp': String(nowSec) }
      });
      expect(res.status).toBe(200);
      expect(res.body.data.reconciled_status).toBe('processed');
    });

    it('accepts occurred_at (ISO) as the signed freshness timestamp', async () => {
      const payload = nativePayload();
      delete payload.timestamp;
      payload.occurred_at = new Date().toISOString();
      const res = await signedPost('/api/integrations/hermes/events', payload);
      expect(res.status).toBe(200);
    });
  });

  describe('S2 — /agents registration boundary (signature-only, idempotent)', () => {
    it('accepts a signed registration without an event timestamp (replay-safe by idempotence)', async () => {
      const res = await signedPost('/api/integrations/hermes/agents', {
        agents: [{ name: 'WH Security Registered Agent', department: 'Development' }]
      });
      expect(res.status).toBe(200);
      expect(res.body.data.registered[0].ok).toBe(true);
    });

    it('rejects an unsigned/forged registration with 401', async () => {
      const res = await signedPost(
        '/api/integrations/hermes/agents',
        { agents: [{ name: 'Forged Agent' }] },
        { secret: 'the-wrong-secret' }
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });
  });
});

describe('S2 — fail-closed when no webhook secret is configured', () => {
  let app;
  let sessionStore;
  let closeDatabase;

  beforeAll(async () => {
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_PATH = ':memory:';
    process.env.SESSION_SECRET = 'webhook-nosecret-session-secret-0123456789abcdef';
    process.env.INITIAL_DIRECTOR_EMAIL = DIRECTOR_EMAIL;
    process.env.INITIAL_DIRECTOR_PASSWORD = DIRECTOR_PASSWORD;
    process.env.HERMES_WEBHOOK_SECRET = '';
    process.env.HERMES_API_URL = 'http://127.0.0.1:59999';

    const connection = await import('../../src/database/connection.js');
    closeDatabase = connection.closeDatabase;
    const { runMigrations } = await import('../../src/database/migrations/runner.js');
    const { seedInitialOffice } = await import('../../src/database/seeds/initial_office.js');
    const db = connection.getDatabase();
    runMigrations(db);
    await seedInitialOffice(db);

    const { createApp } = await import('../../src/app.js');
    ({ app, sessionStore } = createApp());
  });

  afterAll(() => {
    if (sessionStore) sessionStore.stopCleanup();
    if (closeDatabase) closeDatabase();
    delete process.env.HERMES_WEBHOOK_SECRET;
  });

  it('rejects every event with 401 WEBHOOK_SECRET_NOT_CONFIGURED', async () => {
    const payload = {
      hook_event_name: 'on_session_start',
      delivery_id: 'dlv_nosecret',
      timestamp: new Date().toISOString()
    };
    const raw = JSON.stringify(payload);
    const sig = 'sha256=' + crypto.createHmac('sha256', 'any-secret').update(raw).digest('hex');
    const res = await request(app)
      .post('/api/integrations/hermes/events')
      .set('Content-Type', 'application/json')
      .set('X-Hermes-Signature-256', sig)
      .send(raw);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('WEBHOOK_SECRET_NOT_CONFIGURED');
  });
});
