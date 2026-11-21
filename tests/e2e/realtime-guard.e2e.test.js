// Regresi realtime client (task t_0dbb6786):
// 1. Tamu tidak boleh membuka koneksi WebSocket (server menolak 4401, klien
//    akan reconnect berulang tanpa gerbang ini).
// 2. Close 4401 tidak memicu reconnect.
// 3. Pengguna login tetap terhubung dan menerima snapshot kantor.
// 4. /login mencerminkan #/login (bukan langsung menampilkan Office).
//
// Berjalan di server E2E terisolasi (port 3102, DB sendiri) — lihat
// playwright.config.js. Kredensial datang dari environment / repo-root .env.
import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL;
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD;

function trackWebSockets(page) {
  const sockets = [];
  page.on('websocket', (ws) => sockets.push(ws));
  return sockets;
}

test.describe('realtime client guards', () => {
  test('tamu: nol koneksi WebSocket dalam 6 detik', async ({ page }) => {
    const sockets = trackWebSockets(page);
    await page.goto('/office');
    await page.waitForTimeout(6000);

    expect(sockets.length).toBe(0);
    expect(await page.evaluate(() => window.store?.state?.wsConnected)).toBe(false);
  });

  test('kontrak baru /api/auth/me 200 {isAuthenticated:false}: tamu tetap tanpa sesi', async ({ page }) => {
    // Backend (t_b57cc953) akan mengembalikan 200 untuk tamu. Klien harus
    // tetap menganggap tamu tidak punya sesi dan tidak membuka WS.
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { user: null, isAuthenticated: false, csrfToken: null }
        })
      })
    );

    const sockets = trackWebSockets(page);
    await page.goto('/office');
    await page.waitForTimeout(5000);

    expect(await page.evaluate(() => window.store?.state?.user ?? null)).toBeNull();
    expect(sockets.length).toBe(0);
    expect(await page.evaluate(() => window.store?.state?.wsConnected)).toBe(false);
  });

  test('close 4401: tepat 1 koneksi, tidak ada reconnect', async ({ page }) => {
    // Pura-pura /api/auth/me menganggap kita login, tetapi cookie sesi tidak
    // ada → server menutup WS dengan 4401. Klien harus berhenti, bukan reconnect.
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            isAuthenticated: true,
            user: { id: 1, name: 'Test Director', role: 'director' }
          }
        })
      })
    );

    const sockets = trackWebSockets(page);
    await page.goto('/#/login');
    await page.waitForFunction(() => Boolean(window.store?.state?.user), null, { timeout: 15000 });
    await page.waitForTimeout(8000);

    expect(sockets.length).toBe(1);
    expect(await page.evaluate(() => window.store?.state?.wsConnected)).toBe(false);
    expect(await page.evaluate(() => window.store?.state?.runtimeStatus?.reason)).toBe('ws_unauthorized');
  });

  test('login → reload → WS tersambung + snapshot agen', async ({ page }) => {
    const sockets = trackWebSockets(page);

    // /login (path, tanpa hash) harus memunculkan form login, bukan Office.
    await page.goto('/login');
    await page.waitForSelector('#login-form', { timeout: 15000 });
    expect(page.url()).toContain('#/login');
    expect(await page.locator('#office-svg-canvas').count()).toBe(0);

    await page.fill('#login-username', DIRECTOR_EMAIL);
    await page.fill('#login-password', DIRECTOR_PASSWORD);
    await page.click('#login-submit-btn');

    // LoginView melakukan reload halaman; WS harus tersambung lagi.
    await page.waitForFunction(() => window.store?.state?.wsConnected === true, null, { timeout: 20000 });
    await page.waitForFunction(() => window.store?.state?.agents?.size > 0, null, { timeout: 20000 });

    expect(sockets.length).toBe(1);
    expect(await page.evaluate(() => window.store?.state?.user?.role)).toBe('director');
  });
});
