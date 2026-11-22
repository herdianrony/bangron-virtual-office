// PHASE 3.1 + 3.2 — Real browser E2E verification.
//
// Authentication strategy:
// - Login happens through the REAL browser UI (login form). Playwright's
//   browser context manages the session cookie automatically — no manual
//   Cookie headers anywhere.
// - Authenticated API operations use browser fetch (page.evaluate) with
//   credentials: 'same-origin' and the session's CSRF token.
// - Hermes webhook events use context.request (APIRequestContext) with HMAC
//   signatures; the webhook contract is signature-based, not session-based.
//   APIRequestContext shares the browser context cookie jar — verified once
//   in the login test via /api/auth/me without any manual cookie injection.
//
// Data isolation:
// - global-setup.js provisions a fresh dedicated SQLite database with five
//   dedicated idle agents (one per lifecycle test). The dev DB is untouched.
// - Credentials come strictly from the environment (or repo-root .env).
//   There are NO hardcoded fallback credentials.
import { test, expect } from '@playwright/test';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { E2E_AGENTS } from './e2e-env.js';

dotenv.config(); // repo-root .env; real environment variables take precedence

const WEBHOOK_SECRET = process.env.HERMES_WEBHOOK_SECRET;
const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL;
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD;

const AGENT = Object.fromEntries(E2E_AGENTS.map((a) => [a.id.replace('inst_e2e_', ''), a.id]));

test.beforeAll(() => {
  const missing = ['HERMES_WEBHOOK_SECRET', 'INITIAL_DIRECTOR_EMAIL', 'INITIAL_DIRECTOR_PASSWORD']
    .filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(
      `E2E requires environment-provided credentials: ${missing.join(', ')}. ` +
      'Set them in the environment or repo-root .env. Fallback credentials are not allowed.'
    );
  }
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// Login through the real browser UI. The browser stores the signed session
// cookie set by express-session; every later request carries it automatically.
async function loginAsDirector(page) {
  await page.goto('/login#/login');
  await page.waitForSelector('#login-form', { timeout: 15000 });
  await page.fill('#login-username', DIRECTOR_EMAIL);
  await page.fill('#login-password', DIRECTOR_PASSWORD);
  await page.click('#login-submit-btn');
  // LoginView switches to #/office and reloads on success.
  await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });
  await page.waitForFunction(
    () => window.store?.state?.user?.role === 'director' && Boolean(window.store?.state?.csrfToken),
    null,
    { timeout: 15000 }
  );
}

// Authenticated API call via browser fetch. `csrf` may be true (use the
// session token), false (omit the header), or a string (explicit token).
async function apiCall(page, method, path, body = null, csrf = true) {
  return page.evaluate(
    async ({ method, path, body, csrf }) => {
      const headers = { 'Content-Type': 'application/json' };
      const token =
        typeof csrf === 'string' ? csrf : csrf ? window.store?.state?.csrfToken : null;
      if (token) headers['x-csrf-token'] = token;
      const res = await fetch(path, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === null ? undefined : JSON.stringify(body)
      });
      let json = null;
      try {
        json = await res.json();
      } catch {
        /* non-JSON response */
      }
      return { status: res.status, ok: res.ok, json };
    },
    { method, path, body, csrf }
  );
}

// Strict success assertion — never silently accept an unexpected state.
function expectApiOk(result, label) {
  expect(result.ok, `${label}: HTTP ${result.status} body=${JSON.stringify(result.json)}`).toBe(true);
  expect(result.json?.success, `${label}: body=${JSON.stringify(result.json)}`).toBe(true);
  return result.json.data;
}

async function getAgentStatus(page, agentId) {
  const agents = expectApiOk(await apiCall(page, 'GET', '/api/virtual-office/agents'), 'GET agents');
  const agent = agents.find((a) => a.id === agentId);
  expect(agent, `agent ${agentId} must exist in office state`).toBeTruthy();
  return agent.status;
}

async function getTask(page, taskId) {
  return expectApiOk(await apiCall(page, 'GET', `/api/tasks/${taskId}`), `GET task ${taskId}`);
}

// Frontend store assertion fed by WebSocket events (no page reload involved).
async function waitForStoreAgentStatus(page, agentId, status, timeout = 10000) {
  await page.waitForFunction(
    ({ id, s }) => window.store?.getAgent(id)?.status === s,
    { id: agentId, s: status },
    { timeout }
  );
}

async function createAndAssignTask(page, agentId, label) {
  const task = expectApiOk(
    await apiCall(page, 'POST', '/api/tasks', {
      title: `E2E ${label} ${Date.now()}`,
      description: `Isolated E2E task: ${label}`,
      priority: 'normal',
      assignedAgentId: null
    }),
    'create task'
  );
  expect(task.id).toBeTruthy();
  const assigned = expectApiOk(
    await apiCall(page, 'POST', `/api/tasks/${task.id}/assign`, { agentId }),
    'assign task'
  );
  // The assign endpoint must return the real updated task (regression guard
  // against the un-awaited Promise serialization bug).
  expect(assigned.id).toBe(task.id);
  expect(assigned.assigned_agent_id).toBe(agentId);
  expect(assigned.status).toBe('assigned');
  return task.id;
}

// HMAC-signed Hermes webhook via APIRequestContext. No session cookie needed
// (signature-based contract); no manual Cookie headers are injected.
// The timestamp lives INSIDE the signed body (S2 remediation: freshness is
// cryptographically bound to the signed content). The legacy unix header is
// kept and must match the body timestamp.
async function sendHermesEvent(context, eventType, overrides = {}) {
  const nowMs = Date.now();
  const payload = {
    event_id: `e2e-${nowMs}-${Math.random().toString(36).slice(2)}`,
    event_type: eventType,
    agent_id: null,
    instance_id: null,
    task_id: null,
    timestamp: new Date(nowMs).toISOString(),
    ...overrides
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(nowMs / 1000);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  const res = await context.request.post('/api/integrations/hermes/events', {
    data: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-hermes-signature-256': signature,
      'x-hermes-timestamp': String(timestamp)
    }
  });
  expect(res.status(), `webhook ${eventType}: HTTP ${res.status()}`).toBe(200);
  const body = await res.json();
  expect(body.success, `webhook ${eventType}: ${JSON.stringify(body)}`).toBe(true);
  return body.data;
}

// Test-only runtime simulation endpoint (explicit ENABLE_TEST_ROUTES flag,
// director session + CSRF required). Browser fetch → cookies automatic.
async function setRuntimeStatus(page, connected) {
  const result = await apiCall(page, 'POST', '/api/test/runtime-status', { connected });
  expectApiOk(result, `runtime-status ${connected}`);
}

async function waitForRuntimeVisual(page, connected) {
  if (connected) {
    await page.waitForFunction(() => window.store?.state?.runtimeStatus?.connected === true, null, { timeout: 10000 });
    await expect(page.locator('#runtime-text')).toHaveText('Live Realtime', { timeout: 10000 });
    await expect(page.locator('#runtime-dot')).toHaveClass(/online/, { timeout: 10000 });
    await expect(page.locator('.office-container')).not.toHaveClass(/runtime-offline/, { timeout: 10000 });
  } else {
    await page.waitForFunction(() => window.store?.state?.runtimeStatus?.connected === false, null, { timeout: 10000 });
    await expect(page.locator('#runtime-text')).toHaveText('Runtime Offline', { timeout: 10000 });
    await expect(page.locator('#runtime-dot')).toHaveClass(/offline/, { timeout: 10000 });
    await expect(page.locator('.office-container')).toHaveClass(/runtime-offline/, { timeout: 10000 });
  }
}

// Restore the dedicated agent to idle after a test so reruns stay clean.
async function cleanupAgent(context, page, agentId, taskId) {
  await sendHermesEvent(context, 'agent.execution.cancelled', {
    agent_id: agentId,
    instance_id: agentId,
    task_id: taskId,
    payload: { reason: 'E2E cleanup' }
  });
  await expect.poll(() => getAgentStatus(page, agentId), { timeout: 10000 }).toBe('idle');
}

/* ------------------------------------------------------------------ */
/* PHASE 3.1 — Smoke tests (5)                                         */
/* ------------------------------------------------------------------ */

test.describe('PHASE 3.1 — Real Browser E2E Verification', () => {
  test('office animation and SVG geometry render without runtime errors', async ({ page }) => {
    const pageErrors = [];
    const svgGeometryErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const text = message.text();
      if (/\\b<rect> attribute (?:width|height): Expected length/.test(text)) {
        svgGeometryErrors.push(text);
      }
    });

    await loginAsDirector(page);
    await expect(page.locator('#office-svg-canvas')).toBeVisible();

    // Exercise multiple animation frames and inspect the rendered hit-test
    // rectangles backed by API workstation records (which have no dimensions).
    await page.waitForTimeout(1000);
    expect(pageErrors).toEqual([]);
    expect(svgGeometryErrors).toEqual([]);
    await expect(page.locator('#hit-test-layer .td-hit-test-furniture')).toHaveCount(14);
  });

  test('office page loads and renders agents', async ({ page }) => {
    await loginAsDirector(page);
    await expect(page).toHaveTitle(/Bangron Virtual Office/);
    await expect(page.locator('#office-pixi-canvas')).toBeVisible();
    // Agents must actually be loaded into the frontend store and rendered.
    await page.waitForFunction(() => (window.store?.getAllAgents()?.length ?? 0) > 0, null, { timeout: 15000 });
    const agentCount = await page.evaluate(() => window.store.getAllAgents().length);
    expect(agentCount).toBeGreaterThanOrEqual(E2E_AGENTS.length);
    await page.screenshot({ path: 'tests/e2e/screenshots/office-loaded.png', fullPage: true });
  });

  test('runtime status indicator is present', async ({ page }) => {
    await loginAsDirector(page);
    await expect(page.locator('#runtime-dot')).toBeVisible();
    await expect(page.locator('#runtime-text')).toBeVisible();
    // With an authenticated WS connection the indicator shows live realtime.
    await expect(page.locator('#runtime-text')).toHaveText('Live Realtime', { timeout: 10000 });
  });

  test('office navigation elements are present', async ({ page }) => {
    await loginAsDirector(page);
    await expect(page.locator('a[href="#/office"]').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('a[href="#/agents"]').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('a[href="#/tasks"]').filter({ visible: true }).first()).toBeVisible();
  });

  test('HUD controls are present', async ({ page }) => {
    await loginAsDirector(page);
    await expect(page.locator('#hud-zoom-in')).toBeVisible();
    await expect(page.locator('#hud-zoom-out')).toBeVisible();
    await expect(page.locator('#hud-follow')).toBeVisible();
    await expect(page.locator('#hud-fullscreen')).toBeVisible();
  });

  test('WebSocket connection establishes without errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await loginAsDirector(page);
    // The authenticated WebSocket must be connected in the frontend store.
    await page.waitForFunction(() => window.store?.state?.wsConnected === true, null, { timeout: 15000 });
    await page.screenshot({ path: 'tests/e2e/screenshots/ws-connected.png', fullPage: true });
    const connectionErrors = consoleErrors.filter(
      (e) => e.includes('WebSocket') || e.includes('ws:') || e.includes('Failed to connect')
    );
    expect(connectionErrors, `console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* PHASE 3.2 — Full browser lifecycle E2E (5)                          */
/* ------------------------------------------------------------------ */

test.describe('PHASE 3.2 — Full Browser Lifecycle E2E', () => {
  test('director login → task assign → queued → working → completed → idle', async ({ page, context }) => {
    await loginAsDirector(page);
    const agentId = AGENT.success;

    // Session persistence through an authenticated endpoint (browser fetch).
    const me = expectApiOk(await apiCall(page, 'GET', '/api/auth/me'), 'auth/me');
    expect(me.isAuthenticated).toBe(true);
    expect(me.user.role).toBe('director');
    expect(me.user.email).toBe(DIRECTOR_EMAIL);

    // APIRequestContext cookie-jar verification: context.request shares the
    // browser context's cookies. No manual Cookie header is injected.
    const meViaContext = await context.request.get('/api/auth/me');
    expect(meViaContext.ok()).toBe(true);
    const meCtxBody = await meViaContext.json();
    expect(meCtxBody.data.isAuthenticated).toBe(true);

    // Regression guard: exactly ONE signed session cookie, proper flags.
    const cookies = await context.cookies();
    const sessionCookies = cookies.filter((c) => c.name === 'bvo_session');
    expect(sessionCookies).toHaveLength(1);
    // The jar may return the percent-encoded wire value (s%3A...) — decode.
    expect(decodeURIComponent(sessionCookies[0].value).startsWith('s:')).toBe(true); // express-session signature
    expect(sessionCookies[0].httpOnly).toBe(true);
    expect(sessionCookies[0].sameSite).toBe('Lax');

    // CSRF handling verified independently of session auth.
    const noCsrf = await apiCall(page, 'POST', '/api/tasks', { title: 'CSRF probe' }, false);
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.json.error.code).toBe('CSRF_INVALID');
    const badCsrf = await apiCall(page, 'POST', '/api/tasks', { title: 'CSRF probe' }, 'wrong-token');
    expect(badCsrf.status).toBe(403);
    expect(badCsrf.json.error.code).toBe('CSRF_INVALID');

    // Assign → agent must be QUEUED (no inference of working without evidence).
    const taskId = await createAndAssignTask(page, agentId, 'success lifecycle');
    expect(await getAgentStatus(page, agentId)).toBe('queued');
    await waitForStoreAgentStatus(page, agentId, 'queued'); // WS → frontend store
    expect((await getTask(page, taskId)).status).toBe('assigned');

    // execution.started → WORKING (backend + frontend store via WS).
    await sendHermesEvent(context, 'agent.execution.started', {
      agent_id: agentId,
      instance_id: agentId,
      task_id: taskId
    });
    expect(await getAgentStatus(page, agentId)).toBe('working');
    await waitForStoreAgentStatus(page, agentId, 'working');
    expect((await getTask(page, taskId)).status).toBe('running');

    // execution.ended (success) → COMPLETED, task completed.
    await sendHermesEvent(context, 'agent.execution.ended', {
      agent_id: agentId,
      instance_id: agentId,
      task_id: taskId,
      payload: { success: true, summary: 'E2E completed successfully' }
    });
    expect(['completed', 'idle']).toContain(await getAgentStatus(page, agentId));
    expect((await getTask(page, taskId)).status).toBe('completed');

    // Transient completed state returns to IDLE (1500ms backend timer).
    await expect.poll(() => getAgentStatus(page, agentId), { timeout: 10000 }).toBe('idle');
    await waitForStoreAgentStatus(page, agentId, 'idle');
    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-idle.png', fullPage: true });
  });

  test('failed execution displays Failed and updates task lifecycle', async ({ page, context }) => {
    await loginAsDirector(page);
    const agentId = AGENT.failure;

    const taskId = await createAndAssignTask(page, agentId, 'failed lifecycle');
    expect(await getAgentStatus(page, agentId)).toBe('queued');

    await sendHermesEvent(context, 'agent.execution.failed', {
      agent_id: agentId,
      instance_id: agentId,
      task_id: taskId,
      payload: { error: 'Simulated failure', exit_code: 1 }
    });

    // Backend lifecycle: agent failed, task failed with the error summary.
    await expect.poll(() => getAgentStatus(page, agentId), { timeout: 10000 }).toBe('failed');
    const task = await getTask(page, taskId);
    expect(task.status).toBe('failed');
    expect(task.result_summary).toContain('Simulated failure');

    // Frontend store receives the failure via WebSocket (no reload).
    await waitForStoreAgentStatus(page, agentId, 'failed');
    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-failed.png', fullPage: true });

    // Cleanup: cancel restores the dedicated agent to idle for reruns.
    await cleanupAgent(context, page, agentId, taskId);
    expect((await getTask(page, taskId)).status).toBe('cancelled');
  });

  test('runtime disconnect displays Offline without losing lifecycle state', async ({ page, context }) => {
    await loginAsDirector(page);
    const agentId = AGENT.disconnect;

    const taskId = await createAndAssignTask(page, agentId, 'disconnect lifecycle');
    await sendHermesEvent(context, 'agent.execution.started', {
      agent_id: agentId,
      instance_id: agentId,
      task_id: taskId
    });
    expect(await getAgentStatus(page, agentId)).toBe('working');
    await waitForStoreAgentStatus(page, agentId, 'working');

    // Simulate runtime disconnect through the isolated test endpoint.
    await setRuntimeStatus(page, false);

    // ACTUAL frontend Offline visual state (DOM, not just API values).
    await waitForRuntimeVisual(page, false);
    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-disconnected.png', fullPage: true });

    // Lifecycle must be preserved: still working in DB AND in the store.
    expect(await getAgentStatus(page, agentId)).toBe('working');
    const storeStatus = await page.evaluate((id) => window.store.getAgent(id)?.status, agentId);
    expect(storeStatus).toBe('working');
    expect((await getTask(page, taskId)).status).toBe('running');

    // Restore global runtime state for the following tests.
    await setRuntimeStatus(page, true);
    await waitForRuntimeVisual(page, true);
    await cleanupAgent(context, page, agentId, taskId);
  });

  test('runtime recovery restores correct visual state', async ({ page, context }) => {
    await loginAsDirector(page);
    const agentId = AGENT.recovery;

    const taskId = await createAndAssignTask(page, agentId, 'recovery lifecycle');
    await sendHermesEvent(context, 'agent.execution.started', {
      agent_id: agentId,
      instance_id: agentId,
      task_id: taskId
    });
    expect(await getAgentStatus(page, agentId)).toBe('working');
    await waitForStoreAgentStatus(page, agentId, 'working');

    // Disconnect → Offline visuals.
    await setRuntimeStatus(page, false);
    await waitForRuntimeVisual(page, false);

    // Recover → Connected visuals, lifecycle untouched.
    await setRuntimeStatus(page, true);
    await waitForRuntimeVisual(page, true);
    const storeConnected = await page.evaluate(() => window.store.state.runtimeStatus.connected);
    expect(storeConnected).toBe(true);
    expect(await getAgentStatus(page, agentId)).toBe('working');
    await waitForStoreAgentStatus(page, agentId, 'working');
    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-recovered.png', fullPage: true });

    // Cleanup: successful end → completed → idle.
    await sendHermesEvent(context, 'agent.execution.ended', {
      agent_id: agentId,
      instance_id: agentId,
      task_id: taskId,
      payload: { success: true }
    });
    await expect.poll(() => getAgentStatus(page, agentId), { timeout: 10000 }).toBe('idle');
  });

  test('browser refresh restores authoritative snapshot', async ({ page, context }) => {
    await loginAsDirector(page);
    const agentId = AGENT.refresh;

    const taskId = await createAndAssignTask(page, agentId, 'refresh lifecycle');
    await sendHermesEvent(context, 'agent.execution.failed', {
      agent_id: agentId,
      instance_id: agentId,
      task_id: taskId,
      payload: { error: 'Pre-refresh failure' }
    });
    await expect.poll(() => getAgentStatus(page, agentId), { timeout: 10000 }).toBe('failed');
    await waitForStoreAgentStatus(page, agentId, 'failed');

    // Full browser refresh — the session cookie must survive (no re-login).
    await page.reload();
    await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });
    await page.waitForFunction(() => window.store?.state?.user?.role === 'director', null, { timeout: 15000 });

    // Authoritative snapshot: the failed lifecycle is restored from the
    // backend (WS snapshot + REST), not from stale client memory.
    await waitForStoreAgentStatus(page, agentId, 'failed');
    expect(await getAgentStatus(page, agentId)).toBe('failed');
    expect((await getTask(page, taskId)).status).toBe('failed');
    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-refreshed.png', fullPage: true });

    await cleanupAgent(context, page, agentId, taskId);
  });
});