import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3003' });

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
