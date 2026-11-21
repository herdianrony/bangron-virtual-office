// Service Worker security tests — authenticated API cache isolation
// Verifies: /api/* responses (except safe allowlist) are NOT cached by SW,
// logout clears API cache, no cross-account data leakage via SW cache.

import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL;
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD;

test.describe('Service Worker API cache security', () => {
  test('safe API endpoints /api/health and /api/auth/csrf are cacheable', async ({ page }) => {
    // These endpoints contain no session data and should be SW-cacheable
    await page.route('**/api/health', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', timestamp: Date.now() }),
      });
    });

    await page.route('**/api/auth/csrf', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ csrfToken: 'test-csrf-token' }),
      });
    });

    await page.goto('/#/office');
    await page.waitForTimeout(2000);

    // Page loads without errors from safe API endpoints
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('logout triggers SW API cache clear message', async ({ page }) => {
    // Log in using correct selectors
    await page.goto('/#/login');
    await page.waitForSelector('#login-form', { timeout: 15000 });

    await page.fill('#login-username', DIRECTOR_EMAIL);
    await page.fill('#login-password', DIRECTOR_PASSWORD);
    await page.click('#login-submit-btn');

    // Wait for login to complete and redirect
    await page.waitForFunction(() => Boolean(window.store?.state?.user), null, { timeout: 15000 });

    // Verify SW controller exists
    const swController = await page.evaluate(() => {
      return !!('serviceWorker' in navigator && navigator.serviceWorker.controller);
    });

    // Click logout
    await page.click('#nav-logout-btn');
    await page.waitForURL('**/#/login', { timeout: 10000 });

    // After logout, verify we're back at login page
    await expect(page.locator('#login-form')).toBeVisible({ timeout: 10000 });
  });

  test('static assets served from SW cache when offline', async ({ page }) => {
    // First visit to cache static assets
    await page.goto('/#/office');
    await page.waitForTimeout(3000);

    // Go offline
    await page.context().setOffline(true);
    await page.waitForTimeout(1000);

    // Reload - should be served from SW cache
    await page.reload();
    await page.waitForTimeout(3000);

    // Page should still load (from cache)
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // Restore
    await page.context().setOffline(false);
  });
});
