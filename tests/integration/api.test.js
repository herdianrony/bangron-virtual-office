import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../../src/app.js';
import { getDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrations/runner.js';
import { seedInitialOffice } from '../../src/database/seeds/initial_office.js';
import { seedDemoData } from '../../src/database/seeds/demo_seed.js';
import { computeHmacSha256 } from '../../src/utils/crypto.js';
import { hermesConfig } from '../../src/config/index.js';

describe('Bangron Virtual Office API Integration Test Suite', () => {
  let app;
  let db;
  let authCookie;
  let csrfToken;

  beforeAll(async () => {
    const mainDb = getDatabase();
    runMigrations(mainDb);
    await seedInitialOffice(mainDb);
    seedDemoData(mainDb);

    const instance = createApp(mainDb);
    app = instance.app;
  });

  afterAll(() => {
    // clean up if needed
  });

  it('authenticates Director via /api/auth/login and receives session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'director@bangron.office',
        password: 'DirectorPass123!'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe('director@bangron.office');
    expect(res.body.data.user.role).toBe('director');

    authCookie = res.headers['set-cookie'];
    expect(authCookie).toBeDefined();

    csrfToken = res.body.data.csrfToken;
  });

  it('fetches Director Dashboard metrics', async () => {
    const res = await request(app)
      .get('/api/director/dashboard')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.metrics.totalAgents).toBeGreaterThanOrEqual(5);
    // Hermes adapter now connects to real Hermes API server
    expect(res.body.data.hermesHealth.connected).toBe(true);
    expect(res.body.data.hermesHealth.status).toContain('CONNECTED');
  });

  it('fetches Virtual Office complete state snapshot', async () => {
    const res = await request(app)
      .get('/api/virtual-office/state')
      .set('Cookie', authCookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rooms.length).toBe(14);
    expect(res.body.data.workstations.length).toBeGreaterThanOrEqual(12);
    expect(res.body.data.agents.length).toBeGreaterThanOrEqual(5);
  });

  it('receives and verifies authentic Hermes webhook event with HMAC signature', async () => {
    const payload = {
      event: 'agent:step',
      instance_id: 'inst_demo_backend',
      task_id: 'task_demo_sub_backend',
      data: { thought: 'Optimizing SQL query indexes' }
    };

    const rawBody = JSON.stringify(payload);
    const signature = computeHmacSha256(rawBody, hermesConfig.webhookSecret);

    const res = await request(app)
      .post('/api/integrations/hermes/events')
      .set('Content-Type', 'application/json')
      .set('X-Hermes-Signature', signature)
      .set('X-Hermes-Timestamp', Math.floor(Date.now() / 1000).toString())
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.reconciled_status).toBe('processed');
  });

  it('rejects Hermes webhook with invalid signature', async () => {
    const payload = { event: 'agent:step' };

    const res = await request(app)
      .post('/api/integrations/hermes/events')
      .set('Content-Type', 'application/json')
      .set('X-Hermes-Signature', 'sha256=invalidhex000000000000000000000000000000000000000000000000000000000000')
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('approves a pending approval request and releases task', async () => {
    const res = await request(app)
      .post('/api/approvals/appr_demo_deploy/approve')
      .set('Cookie', authCookie)
      .set('X-CSRF-Token', csrfToken)
      .send({ reviewNotes: 'Verified deployment bundle' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('approved');
  });

  it('runs demo step simulation cleanly', async () => {
    const res = await request(app)
      .post('/api/demo/step')
      .set('Cookie', authCookie)
      .set('X-CSRF-Token', csrfToken);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.step).toBeDefined();
  });
});
