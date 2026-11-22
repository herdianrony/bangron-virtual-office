// Service Worker security tests — authenticated API cache isolation.
// Only public, session-independent health responses may be cached. CSRF and
// authenticated API responses remain network-only to prevent cross-session leaks.

import { test, expect } from '@playwright/test';

async function readServiceWorker(page) {
  await page.goto('/office');
  return page.evaluate(async () => {
    const response = await fetch('/sw.js', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Unable to read /sw.js: HTTP ${response.status}`);
    return response.text();
  });
}

test.describe('Service Worker API cache security', () => {
  test('only public health endpoint is eligible for API caching', async ({ page }) => {
    const swSource = await readServiceWorker(page);

    expect(swSource).toContain("url.pathname === '/api/health'");
    expect(swSource).toContain('isPublicHealth');
    expect(swSource).toContain('networkFirstThenCache(request, API_CACHE_NAME)');
    expect(swSource).toContain(': fetch(request)');
    expect(swSource).toContain('CSRF tokens are session-bound');
    expect(swSource).not.toContain("url.pathname === '/api/auth/csrf'");
    expect(swSource).toContain('5 * 60 * 1000');
  });

  test('logout message clears the API cache', async ({ page }) => {
    const swSource = await readServiceWorker(page);

    // Accept the current object message and the legacy string message.
    expect(swSource).toContain("event.data === 'logout' || event.data?.type === 'logout'");
    expect(swSource).toContain('event.waitUntil(caches.delete(API_CACHE_NAME))');
  });

  test('application sends the logout message to the active service worker', async ({ page }) => {
    await page.goto('/office');
    const appSource = await page.evaluate(async () => {
      const response = await fetch('/assets/js/app.js', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Unable to read app.js: HTTP ${response.status}`);
      return response.text();
    });

    expect(appSource).toContain("type: 'logout'");
    expect(appSource).toContain('navigator.serviceWorker.controller.postMessage');
  });
});
