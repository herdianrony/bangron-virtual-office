// Session authentication regression tests.
//
// Root cause being guarded against: the login handler used to emit a SECOND,
// UNSIGNED manual `bvo_session` cookie that overrode express-session's signed
// cookie. cookieParser/express-session (and the WS handshake) only accept the
// signed `s:<sid>.<hmac>` form, so every authenticated request failed.
//
// These tests boot the real Express app against an isolated in-memory SQLite
// database and drive it with supertest (real HTTP semantics, real cookies).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import request from 'supertest';

// Fully controlled environment — never depend on the repo .env here.
vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) } }));

const DIRECTOR_EMAIL = 'director@bangron.office';
const DIRECTOR_PASSWORD = 'TestPass123456';

let app;
let sessionStore;
let db;
let securityConfig;
let closeDatabase;

function sessionCookieFrom(res) {
  const headers = res.headers['set-cookie'] || [];
  const list = Array.isArray(headers) ? headers : [headers];
  return list.filter((h) => h.startsWith('bvo_session='));
}

function cookieValue(setCookieHeader) {
  return decodeURIComponent(setCookieHeader.split(';')[0].split('=').slice(1).join('='));
}

async function login() {
  return request(app)
    .post('/api/auth/login')
    .send({ email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD });
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_PATH = ':memory:';
  process.env.SESSION_SECRET = 'unit-test-session-secret-0123456789abcdef0123456789abcdef';
  process.env.INITIAL_DIRECTOR_EMAIL = DIRECTOR_EMAIL;
  process.env.INITIAL_DIRECTOR_PASSWORD = DIRECTOR_PASSWORD;
  process.env.HERMES_WEBHOOK_SECRET = 'unit-test-webhook-secret';
  delete process.env.AUTH_RATE_LIMIT_MAX;
  delete process.env.ENABLE_TEST_ROUTES;

  const connection = await import('../../src/database/connection.js');
  closeDatabase = connection.closeDatabase;
  const { runMigrations } = await import('../../src/database/migrations/runner.js');
  const { seedInitialOffice } = await import('../../src/database/seeds/initial_office.js');
  db = connection.getDatabase();
  runMigrations(db);
  await seedInitialOffice(db);

  const { createApp } = await import('../../src/app.js');
  ({ app, sessionStore } = createApp());
  ({ securityConfig } = await import('../../config/security.js'));
});

afterAll(() => {
  if (sessionStore) sessionStore.stopCleanup();
  if (closeDatabase) closeDatabase();
});

describe('Express session cookie behavior', () => {
  it('login emits exactly ONE signed bvo_session cookie with secure flags', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.role).toBe('director');
    expect(res.body.data.csrfToken).toMatch(/^[0-9a-f]{48}$/);

    const cookies = sessionCookieFrom(res);
    expect(cookies).toHaveLength(1); // no unsigned duplicate
    const value = cookieValue(cookies[0]);
    expect(value.startsWith('s:')).toBe(true); // express-session signature prefix
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[0]).toContain('Path=/');
    // Non-production: Secure must NOT be set (would break http:// localhost).
    expect(cookies[0]).not.toContain('Secure');
  });

  it('the emitted cookie unsigns to a real session persisted in SQLite', async () => {
    const cookieParser = (await import('cookie-parser')).default;
    const res = await login();
    const value = cookieValue(sessionCookieFrom(res)[0]);
    const sid = cookieParser.signedCookie(value, securityConfig.sessionSecret);
    expect(typeof sid).toBe('string'); // false would mean invalid signature

    const sess = await new Promise((resolve, reject) =>
      sessionStore.get(sid, (err, s) => (err ? reject(err) : resolve(s)))
    );
    expect(sess).toBeTruthy();
    expect(sess.userId).toBeTruthy();
    expect(sess.csrfToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it('session middleware recognizes the login cookie on subsequent requests', async () => {
    const res = await login();
    const cookie = sessionCookieFrom(res)[0].split(';')[0];
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.isAuthenticated).toBe(true);
    expect(me.body.data.user.email).toBe(DIRECTOR_EMAIL);
    expect(me.body.data.csrfToken).toBe(res.body.data.csrfToken);
  });

  it('treats an UNSIGNED session cookie as anonymous (the historical bug stays fixed)', async () => {
    const res = await login();
    const signed = cookieValue(sessionCookieFrom(res)[0]);
    const rawSid = signed.slice(2).split('.')[0]; // strip s: and signature
    const cookie = `bvo_session=${rawSid}`;

    // /me boleh 200 untuk tamu, tapi TIDAK boleh mengaku terautentikasi.
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.success).toBe(true);
    expect(me.body.data.isAuthenticated).toBe(false);
    expect(me.body.data.user).toBeNull();

    // Cookie tak bertanda tidak boleh membuka endpoint terproteksi.
    const protectedRes = await request(app).get('/api/tasks').set('Cookie', cookie);
    expect(protectedRes.status).toBe(401);
    expect(protectedRes.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('answers anonymous /me with 200 isAuthenticated=false (no boot 401 spam)', async () => {
    const me = await request(app).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.success).toBe(true);
    expect(me.body.data.isAuthenticated).toBe(false);
    expect(me.body.data.user).toBeNull();

    const protectedRes = await request(app).get('/api/tasks');
    expect(protectedRes.status).toBe(401);
    expect(protectedRes.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('regenerates the session on login (session fixation protection)', async () => {
    const pre = await request(app).get('/api/auth/csrf');
    const preCookies = sessionCookieFrom(pre);
    expect(preCookies.length).toBe(1);
    const preSid = cookieValue(preCookies[0]).slice(2).split('.')[0];

    const res = await login();
    const postSid = cookieValue(sessionCookieFrom(res)[0]).slice(2).split('.')[0];
    expect(postSid).not.toBe(preSid);
  });

  it('logout destroys the session and clears the cookie', async () => {
    const res = await login();
    const cookie = sessionCookieFrom(res)[0].split(';')[0];
    const csrfToken = res.body.data.csrfToken;

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .set('x-csrf-token', csrfToken);
    expect(out.status).toBe(200);
    const cleared = sessionCookieFrom(out);
    expect(cleared.length).toBe(1);
    expect(cleared[0]).toMatch(/Expires=Thu, 01 Jan 1970/);

    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.isAuthenticated).toBe(false);
    expect(me.body.data.user).toBeNull();

    // Sesi yang sudah dihancurkan tidak boleh membuka endpoint terproteksi.
    const protectedRes = await request(app).get('/api/tasks').set('Cookie', cookie);
    expect(protectedRes.status).toBe(401);
  });
});

describe('CSRF protection (independent of session auth)', () => {
  it('rejects mutating requests without a CSRF token', async () => {
    const res = await login();
    const cookie = sessionCookieFrom(res)[0].split(';')[0];
    const noToken = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'CSRF probe' });
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects mutating requests with a wrong CSRF token', async () => {
    const res = await login();
    const cookie = sessionCookieFrom(res)[0].split(';')[0];
    const bad = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .set('x-csrf-token', 'wrong-token')
      .send({ title: 'CSRF probe' });
    expect(bad.status).toBe(403);
    expect(bad.body.error.code).toBe('CSRF_INVALID');
  });

  it('accepts mutating requests with the session CSRF token', async () => {
    const res = await login();
    const cookie = sessionCookieFrom(res)[0].split(';')[0];
    const ok = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .set('x-csrf-token', res.body.data.csrfToken)
      .send({ title: 'CSRF valid probe' });
    expect(ok.status).toBe(201);
    expect(ok.body.success).toBe(true);
  });

  it('login itself is CSRF-exempt (it issues the token)', async () => {
    const res = await login();
    expect(res.status).toBe(200);
  });
});