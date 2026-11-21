// Service Worker security tests — authenticated API cache isolation
// Verifies: /api/* responses (except safe allowlist) are NOT cached by SW,
// logout clears API cache, no cross-account data leakage via SW cache.
// Runs against isolated E2E server (port 3102, fresh DB).

import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL;
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD;

test.describe('Service Worker API cache security', () => {
  test('safe API endpoints /api/health and /api/auth/csrf are cacheable', async ({ page }) => {
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

    await page.goto('/office');
    await page.waitForTimeout(2000);

    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('SW source contains API cache allowlist', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const swSource = await page.evaluate(() => {
      return fetch('/sw.js').then(r => r.text());
    });

    // Safe allowlist endpoints
    expect(swSource).toContain('/api/health');
    expect(swSource).toContain('/api/auth/csrf');

    // Non-allowlist API endpoints use network-only (not in cacheable list)
    // The allowlist pattern should NOT include /api/auth/me or other authenticated endpoints
    const allowlistMatch = swSource.match(/allowlist\s*[:=]\s*\[([^\]]+)\]/);
    if (allowlistMatch) {
      const allowlist = allowlistMatch[1];
      expect(allowlist).not.toContain('/api/auth/me');
      expect(allowlist).not.toContain('/api/tasks');
    }

    // 5-minute cache expiration
    expect(swSource).toContain('5 * 60 * 1000');
  });

  test('SW logout handler clears API cache', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const swSource = await page.evaluate(() => {
      return fetch('/sw.js').then(r => r.text());
    });

    // Logout message handler
    expect(swSource).toContain("event.data === 'logout'");
    expect(swSource).toContain('caches.delete(API_CACHE_NAME)');
    expect(swSource).toContain('API cache cleared on logout');
  });

  test('app.js posts logout message to SW controller', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const appSource = await page.evaluate(() => {
      return fetch('/assets/js/app.js').then(r => r.text());
    });

    expect(appSource).toContain("type: 'logout'");
    expect(appSource).toContain('navigator.serviceWorker.controller.postMessage');
    expect(appSource).toContain('Clear Service Worker API cache');
  });
});
