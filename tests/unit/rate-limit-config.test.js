// Auth rate-limit configuration tests.
//
// Security contract:
// - Production default is 30 attempts / 15 min and CANNOT be raised by any
//   environment variable.
// - AUTH_RATE_LIMIT_MAX is honored only under NODE_ENV === 'test'.
// - Development keeps the secure default.
// - Brute-force protection still actively blocks (integration proof below).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { resolveAuthRateLimitMax } from '../../src/middleware/rate-limit.js';

vi.mock('dotenv', () => ({ default: { config: () => ({ parsed: {} }) } }));

describe('resolveAuthRateLimitMax — environment matrix', () => {
  it('production always uses the secure default (30)', () => {
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'production' })).toBe(30);
  });

  it('production IGNORES any AUTH_RATE_LIMIT_MAX override', () => {
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'production', AUTH_RATE_LIMIT_MAX: '999999' })).toBe(30);
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'production', AUTH_RATE_LIMIT_MAX: '0' })).toBe(30);
  });

  it('test environment defaults to headroom (300) without an override', () => {
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'test' })).toBe(300);
  });

  it('test environment honors a valid positive override', () => {
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'test', AUTH_RATE_LIMIT_MAX: '5' })).toBe(5);
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'test', AUTH_RATE_LIMIT_MAX: '1000' })).toBe(1000);
  });

  it('test environment rejects invalid overrides and falls back to 300', () => {
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'test', AUTH_RATE_LIMIT_MAX: 'abc' })).toBe(300);
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'test', AUTH_RATE_LIMIT_MAX: '-5' })).toBe(300);
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'test', AUTH_RATE_LIMIT_MAX: '0' })).toBe(300);
  });

  it('development keeps the secure default and ignores overrides', () => {
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'development' })).toBe(30);
    expect(resolveAuthRateLimitMax({ NODE_ENV: 'development', AUTH_RATE_LIMIT_MAX: '999999' })).toBe(30);
    expect(resolveAuthRateLimitMax({})).toBe(30);
  });
});

describe('authLimiter integration — brute-force protection stays active', () => {
  let app;
  let sessionStore;
  let closeDatabase;

  beforeAll(async () => {
    // Test-only configuration: a tiny limit proves the limiter still blocks.
    // resetModules so rate-limit.js re-evaluates with AUTH_RATE_LIMIT_MAX=3
    // (the static import above already cached a default-configured limiter).
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    process.env.DATABASE_PATH = ':memory:';
    process.env.SESSION_SECRET = 'rate-limit-test-secret-0123456789abcdef0123456789abcdef';
    process.env.INITIAL_DIRECTOR_EMAIL = 'director@bangron.office';
    process.env.INITIAL_DIRECTOR_PASSWORD = 'TestPass123456';
    process.env.HERMES_WEBHOOK_SECRET = 'rate-limit-test-webhook-secret';
    delete process.env.ENABLE_TEST_ROUTES;

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
    delete process.env.AUTH_RATE_LIMIT_MAX;
  });

  it('blocks login attempts beyond the configured test limit with 429', async () => {
    const attempt = () =>
      request(app)
        .post('/api/auth/login')
        .send({ email: 'director@bangron.office', password: 'definitely-wrong-password' });

    // First 3 attempts are processed (401 = bad credentials, NOT rate limit).
    for (let i = 0; i < 3; i++) {
      const res = await attempt();
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_FAILED');
    }
    // 4th attempt within the window is blocked.
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('AUTH_RATE_LIMIT_EXCEEDED');
  });
});