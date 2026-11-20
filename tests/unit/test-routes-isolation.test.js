// Test-endpoint isolation tests (Phase 3.2.2 §4).
//
// /api/test/runtime-status must:
// - exist ONLY under the explicit ENABLE_TEST_ROUTES=true flag (non-prod),
// - be disabled by default (no flag → 404),
// - require authentication AND the director role,
// - never touch the real Hermes runtime (only a simulated WS event),
// - never modify agent lifecycle state.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { resolveTestRoutesEnabled } from '../../config/app.js';

vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) } }));

const DIRECTOR_EMAIL = 'director@bangron.office';
const DIRECTOR_PASSWORD = 'TestPass123456';
const VIEWER_EMAIL = 'viewer@bangron.office';
const VIEWER_PASSWORD = 'ViewerPass123456';

describe('resolveTestRoutesEnabled — flag matrix', () => {
  it('is disabled by default', () => {
    expect(resolveTestRoutesEnabled({})).toBe(false);
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'development' })).toBe(false);
  });

  it('requires the EXACT explicit flag value true', () => {
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'test', ENABLE_TEST_ROUTES: 'true' })).toBe(true);
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'test', ENABLE_TEST_ROUTES: '1' })).toBe(false);
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'test', ENABLE_TEST_ROUTES: 'yes' })).toBe(false);
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'test', ENABLE_TEST_ROUTES: 'false' })).toBe(false);
  });

  it('production hard-locks the flag off even when ENABLE_TEST_ROUTES=true', () => {
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'production', ENABLE_TEST_ROUTES: 'true' })).toBe(false);
  });

  it('isProduction === false alone is NOT a sufficient boundary', () => {
    // Development without the explicit flag must stay disabled.
    expect(resolveTestRoutesEnabled({ NODE_ENV: 'development', ENABLE_TEST_ROUTES: undefined })).toBe(false);
  });
});

describe('/api/test/runtime-status — enabled test environment', () => {
  let app;
  let sessionStore;
  let db;
  let closeDatabase;
  let eventPublisher;
  let HermesAdapter;
  let publishSpy;
  let runtimeSpy;

  async function loginAs(email, password) {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] || []).find((h) => h.startsWith('bvo_session='));
    return { cookie: cookie.split(';')[0], csrfToken: res.body.data.csrfToken };
  }

  beforeAll(async () => {
    // resetModules so config/app.js re-evaluates with ENABLE_TEST_ROUTES=true
    // (the static import above already cached a disabled appConfig).
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_TEST_ROUTES = 'true';
    process.env.DATABASE_PATH = ':memory:';
    process.env.SESSION_SECRET = 'test-routes-secret-0123456789abcdef0123456789abcdef';
    process.env.INITIAL_DIRECTOR_EMAIL = DIRECTOR_EMAIL;
    process.env.INITIAL_DIRECTOR_PASSWORD = DIRECTOR_PASSWORD;
    process.env.HERMES_WEBHOOK_SECRET = 'test-routes-webhook-secret';
    delete process.env.AUTH_RATE_LIMIT_MAX;

    const connection = await import('../../src/database/connection.js');
    closeDatabase = connection.closeDatabase;
    const { runMigrations } = await import('../../src/database/migrations/runner.js');
    const { seedInitialOffice } = await import('../../src/database/seeds/initial_office.js');
    db = connection.getDatabase();
    runMigrations(db);
    await seedInitialOffice(db);

    // A non-director user for the authorization test.
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO users (name, email, password_hash, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)'
    ).run('Viewer', VIEWER_EMAIL, bcrypt.hashSync(VIEWER_PASSWORD, 10), 'viewer', now, now);

    const { createApp } = await import('../../src/app.js');
    ({ app, sessionStore } = createApp());
    ({ eventPublisher } = await import('../../src/realtime/event-publisher.js'));
    ({ HermesAdapter } = await import('../../src/integrations/hermes/adapter.js'));
  });

  afterAll(() => {
    if (sessionStore) sessionStore.stopCleanup();
    if (closeDatabase) closeDatabase();
    delete process.env.ENABLE_TEST_ROUTES;
  });

  it('rejects unauthenticated requests with 401 (past the CSRF layer)', async () => {
    // An anonymous session provides a valid CSRF token but no userId, so the
    // request passes verifyCsrf and must be stopped by authenticate.
    const csrfRes = await request(app).get('/api/auth/csrf');
    const anonCookie = (csrfRes.headers['set-cookie'] || []).find((h) => h.startsWith('bvo_session='));
    const res = await request(app)
      .post('/api/test/runtime-status')
      .set('Cookie', anonCookie.split(';')[0])
      .set('x-csrf-token', csrfRes.body.data.csrfToken)
      .send({ connected: false });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects unauthenticated requests without CSRF token at the CSRF layer', async () => {
    const res = await request(app).post('/api/test/runtime-status').send({ connected: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects authenticated non-director users with 403', async () => {
    const viewer = await loginAs(VIEWER_EMAIL, VIEWER_PASSWORD);
    const res = await request(app)
      .post('/api/test/runtime-status')
      .set('Cookie', viewer.cookie)
      .set('x-csrf-token', viewer.csrfToken)
      .send({ connected: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('requires a valid CSRF token', async () => {
    const director = await loginAs(DIRECTOR_EMAIL, DIRECTOR_PASSWORD);
    const res = await request(app)
      .post('/api/test/runtime-status')
      .set('Cookie', director.cookie)
      .send({ connected: false });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('validates the body (connected must be boolean)', async () => {
    const director = await loginAs(DIRECTOR_EMAIL, DIRECTOR_PASSWORD);
    const res = await request(app)
      .post('/api/test/runtime-status')
      .set('Cookie', director.cookie)
      .set('x-csrf-token', director.csrfToken)
      .send({ connected: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('publishes a simulated WS event WITHOUT touching the real Hermes runtime or lifecycle', async () => {
    publishSpy = vi.spyOn(eventPublisher, 'publish');
    runtimeSpy = vi.spyOn(HermesAdapter.prototype, 'getRuntimeStatus');
    const { AgentRepository } = await import('../../src/database/repositories/agent.repository.js');
    const agentRepo = new AgentRepository(db);
    agentRepo.createInstance({
      id: 'inst_iso_working',
      profileId: 'prof_dev_backend',
      displayName: 'Isolation Working Agent',
      status: 'working',
      currentRoomId: 'room_dev'
    });

    const director = await loginAs(DIRECTOR_EMAIL, DIRECTOR_PASSWORD);
    const res = await request(app)
      .post('/api/test/runtime-status')
      .set('Cookie', director.cookie)
      .set('x-csrf-token', director.csrfToken)
      .send({ connected: false });
    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(false);

    // Only a simulated runtime event is published (source: e2e-test).
    const runtimeCall = publishSpy.mock.calls.find(([t]) => t === 'runtime.status.changed');
    expect(runtimeCall).toBeTruthy();
    expect(runtimeCall[1].connected).toBe(false);
    expect(runtimeCall[1].source).toBe('e2e-test');

    // No agent lifecycle events, no real runtime interaction.
    const agentCalls = publishSpy.mock.calls.filter(([t]) => t === 'agent.status.updated');
    expect(agentCalls).toHaveLength(0);
    expect(runtimeSpy).not.toHaveBeenCalled();
    expect(agentRepo.getInstanceById('inst_iso_working').status).toBe('working');

    publishSpy.mockRestore();
    runtimeSpy.mockRestore();
  });
});

describe('/api/test/runtime-status — flag disabled (default)', () => {
  let app;
  let sessionStore;
  let closeDatabase;

  beforeAll(async () => {
    // Fresh module registry so config/app.js re-reads the disabled flag.
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_TEST_ROUTES;
    process.env.DATABASE_PATH = ':memory:';
    process.env.SESSION_SECRET = 'test-routes-off-secret-0123456789abcdef0123456789abcdef';
    process.env.INITIAL_DIRECTOR_EMAIL = DIRECTOR_EMAIL;
    process.env.INITIAL_DIRECTOR_PASSWORD = DIRECTOR_PASSWORD;
    process.env.HERMES_WEBHOOK_SECRET = 'test-routes-off-webhook-secret';

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
  });

  it('is not mounted at all without the explicit flag (404 even for director)', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD });
    expect(login.status).toBe(200);
    const cookie = (login.headers['set-cookie'] || []).find((h) => h.startsWith('bvo_session='));
    const res = await request(app)
      .post('/api/test/runtime-status')
      .set('Cookie', cookie.split(';')[0])
      .set('x-csrf-token', login.body.data.csrfToken)
      .send({ connected: false });
    expect(res.status).toBe(404);
  });
});