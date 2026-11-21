// Production security configuration tests (Phase 3.2.2 §2–4).
//
// Boots the REAL Express app with NODE_ENV=production and adversarial env
// leaks (ENABLE_TEST_ROUTES=true, AUTH_RATE_LIMIT_MAX=999999) to prove:
// - session cookies are signed AND carry the Secure flag,
// - test endpoints are never mounted in production,
// - the auth rate limit cannot be raised in production,
// - production refuses to boot without a strong SESSION_SECRET.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { resolveAuthRateLimitMax } from '../../src/middleware/rate-limit.js';
import { resolveTestRoutesEnabled } from '../../config/app.js';

vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) } }));

const DIRECTOR_EMAIL = 'director@bangron.office';
const DIRECTOR_PASSWORD = 'TestPass123456';
const PROD_SECRET = 'production-test-secret-0123456789abcdef0123456789abcdef';

let app;
let sessionStore;
let closeDatabase;

function sessionCookieFrom(res) {
  const headers = res.headers['set-cookie'] || [];
  const list = Array.isArray(headers) ? headers : [headers];
  return list.filter((h) => h.startsWith('bvo_session='));
}

beforeAll(async () => {
  vi.resetModules();
  process.env.NODE_ENV = 'production';
  process.env.SESSION_SECRET = PROD_SECRET;
  process.env.DATABASE_PATH = ':memory:';
  process.env.INITIAL_DIRECTOR_EMAIL = DIRECTOR_EMAIL;
  process.env.INITIAL_DIRECTOR_PASSWORD = DIRECTOR_PASSWORD;
  process.env.HERMES_WEBHOOK_SECRET = 'production-test-webhook-secret';
  // Adversarial leaks: production must ignore BOTH of these.
  process.env.ENABLE_TEST_ROUTES = 'true';
  process.env.AUTH_RATE_LIMIT_MAX = '999999';

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
  delete process.env.ENABLE_TEST_ROUTES;
  delete process.env.AUTH_RATE_LIMIT_MAX;
});

describe('production session cookies', () => {
  it('login emits a signed cookie with the Secure flag in production', async () => {
    // Production cookies are Secure: express-session only emits them over
    // HTTPS. Simulate the TLS-terminating reverse proxy (trust proxy = 1).
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD });
    expect(res.status).toBe(200);
    const cookies = sessionCookieFrom(res);
    expect(cookies).toHaveLength(1);
    const value = decodeURIComponent(cookies[0].split(';')[0].split('=').slice(1).join('='));
    expect(value.startsWith('s:')).toBe(true);
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[0]).toContain('Secure'); // HTTPS-only in production
  });
});

describe('production test-endpoint isolation', () => {
  it('never mounts /api/test/runtime-status even with ENABLE_TEST_ROUTES=true leaked', async () => {
    expect(resolveTestRoutesEnabled(process.env)).toBe(false);
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD });
    expect(login.status).toBe(200);
    const cookie = sessionCookieFrom(login)[0].split(';')[0];
    const res = await request(app)
      .post('/api/test/runtime-status')
      .set('Cookie', cookie)
      .set('x-csrf-token', login.body.data.csrfToken)
      .send({ connected: false });
    expect(res.status).toBe(404);
  });
});

describe('production rate limiting', () => {
  it('keeps the secure default despite AUTH_RATE_LIMIT_MAX leak', () => {
    expect(resolveAuthRateLimitMax(process.env)).toBe(30);
  });
});

describe('production SESSION_SECRET enforcement', () => {
  it('refuses to boot without a configured secret', async () => {
    vi.resetModules();
    delete process.env.SESSION_SECRET;
    await expect(import('../../config/security.js')).rejects.toThrow(/SESSION_SECRET/);
  });

  it('refuses to boot with a short secret (< 32 chars)', async () => {
    vi.resetModules();
    process.env.SESSION_SECRET = 'too-short';
    await expect(import('../../config/security.js')).rejects.toThrow(/SESSION_SECRET/);
    process.env.SESSION_SECRET = PROD_SECRET;
  });
});

describe('production Content-Security-Policy', () => {
  // PixiJS v8 membangun kode dinamis lewat `new Function`; tanpa 'unsafe-eval'
  // layer agen halaman Office tidak pernah render (terbukti: pixiCanvas 0).
  // Inline script TETAP diblokir — 'unsafe-inline' tidak boleh ditambahkan.
  it('memuat script-src self + unsafe-eval tanpa unsafe-inline', async () => {
    const res = await request(app).get('/office');
    expect(res.status).toBe(200);

    const csp = res.headers['content-security-policy'];
    expect(csp, 'CSP header must be emitted in production').toBeTruthy();

    const directive = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'));
    expect(directive, `script-src directive missing in: ${csp}`).toBeTruthy();
    expect(directive).toContain("'self'");
    expect(directive).toContain("'unsafe-eval'");
    expect(directive).not.toContain("'unsafe-inline'");
  });
});