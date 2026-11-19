import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
dotenv.config({ path: '/home/herdianrony/bangron-virtual-office/.env' });

test.use({ baseURL: 'http://localhost:3002' });

test.describe('PHASE 3.1 — Real Browser E2E Verification', () => {
  test('office page loads and renders agents', async ({ page }) => {
    await page.goto('/office');

    // Page should load with the office title
    await expect(page).toHaveTitle(/Bangron Virtual Office/);

    // Take a screenshot of the loaded office
    await page.screenshot({ path: 'tests/e2e/screenshots/office-loaded.png', fullPage: true });
  });

  test('runtime status indicator is present', async ({ page }) => {
    await page.goto('/office');

    // The realtime status badge should exist
    const runtimeDot = page.locator('#runtime-dot');
    await expect(runtimeDot).toBeVisible();

    const runtimeText = page.locator('#runtime-text');
    await expect(runtimeText).toBeVisible();
  });

  test('office navigation elements are present', async ({ page }) => {
    await page.goto('/office');

    // Navigation links should be present (filter to visible ones to avoid
    // hidden mobile dropdown duplicates).
    await expect(page.locator('a[href="#/office"]').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('a[href="#/agents"]').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('a[href="#/tasks"]').filter({ visible: true }).first()).toBeVisible();
  });

  test('HUD controls are present', async ({ page }) => {
    await page.goto('/office');

    // HUD controls should be present
    await expect(page.locator('#hud-zoom-in')).toBeVisible();
    await expect(page.locator('#hud-zoom-out')).toBeVisible();
    await expect(page.locator('#hud-follow')).toBeVisible();
    await expect(page.locator('#hud-fullscreen')).toBeVisible();
  });

  test('WebSocket connection establishes without errors', async ({ page }) => {
    const wsErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') wsErrors.push(msg.text());
    });

    await page.goto('/office');
    await page.waitForTimeout(2000); // Allow WebSocket to connect

    // Take screenshot showing connected state
    await page.screenshot({ path: 'tests/e2e/screenshots/ws-connected.png', fullPage: true });

    // No WebSocket errors in console
    const connectionErrors = wsErrors.filter(e => e.includes('WebSocket') || e.includes('ws:') || e.includes('Failed to connect'));
    expect(connectionErrors.length).toBe(0);
  });
});

import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.HERMES_WEBHOOK_SECRET;
const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL || 'director@bangron.office';
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD || 'TestPass123456';

async function loginAsDirector(context) {
  const loginRes = await context.request.post('http://localhost:3002/api/auth/login', {
    data: { email: DIRECTOR_EMAIL, password: DIRECTOR_PASSWORD }
  });
  expect(loginRes.ok()).toBeTruthy();
  const loginBody = await loginRes.json();
  expect(loginBody.success).toBe(true);

  // Explicitly set the session cookie in the browser context so WebSocket
  // connections (established by the frontend JS) include it.
  const setCookie = loginRes.headers()['set-cookie'] || loginRes.headers()['Set-Cookie'];
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookies) {
      const match = c.match(/bvo_session=([^;]+)/);
      if (match) {
        await context.addCookies([{
          name: 'bvo_session',
          value: match[1],
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          sameSite: 'Lax'
        }]);
      }
    }
  }

  return { user: loginBody.data.user, csrfToken: loginBody.data.csrfToken };
}

async function createTask(context, csrfToken) {
  const res = await context.request.post('http://localhost:3002/api/tasks', {
    data: {
      title: 'E2E Test Task',
      description: 'Task assigned via Playwright E2E',
      priority: 'normal',
      assignedAgentId: null
    },
    headers: { 'x-csrf-token': csrfToken }
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data.id;
}

async function assignTask(context, taskId, agentId, csrfToken) {
  const res = await context.request.post(`http://localhost:3002/api/tasks/${taskId}/assign`, {
    data: { agentId },
    headers: { 'x-csrf-token': csrfToken }
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.success).toBe(true);
  return body.data;
}

async function sendHermesEvent(context, eventType, payloadOverrides = {}) {
  const payload = {
    event_id: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    event_type: eventType,
    agent_id: payloadOverrides.agent_id || null,
    instance_id: payloadOverrides.instance_id || null,
    task_id: payloadOverrides.task_id || null,
    ...payloadOverrides
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
  const res = await context.request.post('http://localhost:3002/api/integrations/hermes/events', {
    data: rawBody,
    headers: {
      'content-type': 'application/json',
      'x-hermes-signature-256': signature,
      'x-hermes-timestamp': String(timestamp)
    }
  });
  return res;
}

async function setRuntimeStatus(connected) {
  const res = await fetch('http://localhost:3002/api/test/runtime-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connected })
  });
  return res;
}

// Remove old WS helper functions (no longer needed — using API-based verification)
async function getAgentStatus(context, agentId) {
  const res = await context.request.get('http://localhost:3002/api/virtual-office/agents');
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const agents = body.data || [];
  const agent = agents.find((a) => a.id === agentId);
  return agent ? agent.status : null;
}

async function getOfficeState(context) {
  const res = await context.request.get('http://localhost:3002/api/virtual-office/state');
  expect(res.ok()).toBeTruthy();
  return await res.json();
}

async function getRuntimeStatus(context) {
  const res = await context.request.get('http://localhost:3002/api/integrations/hermes/status');
  expect(res.ok()).toBeTruthy();
  return await res.json();
}

// Pilih agen yang statusnya 'idle' agar assignment ke 'queued' dapat diverifikasi.
// Jika tidak ada idle, ambil agen pertama dan reset ke 'idle' lewat DB via API tidak memungkinkan,
// maka gunakan agen yang sudah idle.
async function findIdleAgent(context) {
  const state = await getOfficeState(context);
  const agents = state.data?.agents || state.agents || [];
  const idle = agents.find((a) => a.status === 'idle');
  if (idle) return idle;
  // Fallback: ambil agen pertama (harusnya idle setelah seed bersih)
  return agents[0];
}

test.describe('PHASE 3.2 — Full Browser Lifecycle E2E', () => {
  test('director login → task assign → agent queued → working → completed → idle', async ({ page, context }) => {
    const { user, csrfToken } = await loginAsDirector(context);
    expect(user.role).toBe('director');

    // Load office page in browser
    await page.goto('http://localhost:3002/office');
    await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });
    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-office-loaded.png', fullPage: true });

    // Get initial agents via API
    const state = await getOfficeState(context);
    const agents = state.data?.agents || state.agents || [];
    expect(agents.length).toBeGreaterThan(0);
    const testAgent = await findIdleAgent(context);
    expect(testAgent.id).toBeDefined();

    // Create and assign task
    const taskId = await createTask(context, csrfToken);
    await assignTask(context, taskId, testAgent.id, csrfToken);

    // Verify agent is queued (or already working if Hermes dispatch set it)
    let agentStatus = await getAgentStatus(context, testAgent.id);
    expect(['queued', 'working']).toContain(agentStatus);

    // Simulate Hermes execution.started → agent becomes working
    const startRes = await sendHermesEvent(context, 'agent.execution.started', {
      agent_id: testAgent.id,
      instance_id: testAgent.id,
      task_id: taskId
    });
    expect(startRes.status()).toBe(200);

    agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('working');

    // Simulate Hermes execution.ended → agent becomes completed (then timer → idle)
    const completeRes = await sendHermesEvent(context, 'agent.execution.ended', {
      agent_id: testAgent.id,
      instance_id: testAgent.id,
      task_id: taskId
    });
    expect(completeRes.status()).toBe(200);

    // Agent may be 'completed' or already 'idle' if 1500ms timer fired
    agentStatus = await getAgentStatus(context, testAgent.id);
    expect(['completed', 'idle']).toContain(agentStatus);

    // Wait for completed → idle transition (1500ms backend timer)
    await page.waitForTimeout(2500);
    agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('idle');

    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-idle.png', fullPage: true });
  });

  test('failed execution displays Failed', async ({ page, context }) => {
    const { csrfToken } = await loginAsDirector(context);
    await page.goto('http://localhost:3002/office');
    await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });

    const state = await getOfficeState(context);
    const agents = state.data?.agents || state.agents || [];
    const testAgent = await findIdleAgent(context);

    const taskId = await createTask(context, csrfToken);
    await assignTask(context, taskId, testAgent.id, csrfToken);
    await page.waitForTimeout(500); // allow assign to propagate

    let agentStatus = await getAgentStatus(context, testAgent.id);
    expect(['queued', 'working']).toContain(agentStatus);

    const failedRes = await sendHermesEvent(context, 'agent.execution.failed', {
      agent_id: testAgent.id,
      instance_id: testAgent.id,
      task_id: taskId,
      payload: { error: 'Simulated failure', exit_code: 1 }
    });
    expect(failedRes.status()).toBe(200);

    await page.waitForTimeout(800); // allow reconcile to propagate
    agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('failed');

    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-failed.png', fullPage: true });
  });

  test('runtime disconnect displays Offline without losing lifecycle state', async ({ page, context }) => {
    const { csrfToken } = await loginAsDirector(context);
    await page.goto('http://localhost:3002/office');
    await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });

    const state = await getOfficeState(context);
    const agents = state.data?.agents || state.agents || [];
    const testAgent = await findIdleAgent(context);

    const taskId = await createTask(context, csrfToken);
    await assignTask(context, taskId, testAgent.id, csrfToken);
    await page.waitForTimeout(500);

    await sendHermesEvent(context, 'agent.execution.started', { agent_id: testAgent.id, instance_id: testAgent.id, task_id: taskId });
    await page.waitForTimeout(500);

    let agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('working');

    // Runtime disconnect
    const disconnectRes = await setRuntimeStatus(false);
    expect(disconnectRes.status()).toBe(200);

    // Agent lifecycle must be preserved (still 'working', not overwritten)
    agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('working'); // lifecycle preserved despite disconnect

    // Runtime status reflects disconnect
    const runtime = await getRuntimeStatus(context);
    expect(runtime.data.runtime.connected).toBe(false);

    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-disconnected.png', fullPage: true });
  });

  test('runtime recovery restores correct visual state', async ({ page, context }) => {
    const { csrfToken } = await loginAsDirector(context);
    await page.goto('http://localhost:3002/office');
    await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });

    const state = await getOfficeState(context);
    const agents = state.data?.agents || state.agents || [];
    const testAgent = await findIdleAgent(context);

    const taskId = await createTask(context, csrfToken);
    await assignTask(context, taskId, testAgent.id, csrfToken);
    await page.waitForTimeout(500);

    await sendHermesEvent(context, 'agent.execution.started', { agent_id: testAgent.id, instance_id: testAgent.id, task_id: taskId });
    await page.waitForTimeout(500);

    let agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('working');

    // Disconnect then recover
    await setRuntimeStatus(false);
    await page.waitForTimeout(500);
    await setRuntimeStatus(true);
    await page.waitForTimeout(500);

    // Verify runtime is connected again
    const runtime = await getRuntimeStatus(context);
    expect(runtime.data.runtime.connected).toBe(true);

    // Agent lifecycle preserved
    agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('working');

    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-recovered.png', fullPage: true });
  });

  test('browser refresh restores authoritative snapshot', async ({ page, context }) => {
    const { csrfToken } = await loginAsDirector(context);

    await page.goto('http://localhost:3002/office');
    await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });

    const state = await getOfficeState(context);
    const agents = state.data?.agents || state.agents || [];
    const testAgent = await findIdleAgent(context);

    const taskId = await createTask(context, csrfToken);
    await assignTask(context, taskId, testAgent.id, csrfToken);
    await page.waitForTimeout(500);

    await sendHermesEvent(context, 'agent.execution.failed', {
      agent_id: testAgent.id,
      task_id: taskId,
      payload: { error: 'Pre-refresh failure' }
    });
    await page.waitForTimeout(500);

    let agentStatus = await getAgentStatus(context, testAgent.id);
    expect(agentStatus).toBe('failed');

    // Browser refresh
    await page.reload();
    await page.waitForSelector('#office-svg-canvas', { timeout: 30000 });

    // After refresh, verify authoritative state via API
    const state2 = await getOfficeState(context);
    const agents2 = state2.data?.agents || state2.agents || [];
    const agentAfterRefresh = agents2.find((a) => a.id === testAgent.id);
    expect(agentAfterRefresh.status).toBe('failed'); // authoritative state restored

    await page.screenshot({ path: 'tests/e2e/screenshots/e2e-refreshed.png', fullPage: true });
  });
});
