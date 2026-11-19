import { test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3003' });

test('debug svg visibility timing', async ({ page, context }) => {
  const lr = await context.request.post('/api/auth/login', {
    data: { email: 'director@bangron.office', password: 'TestPass123456' }
  });
  const setCookie = lr.headers()['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of cookies) {
    const m = c.match(/bvo_session=([^;]+)/);
    if (m) await context.addCookies([{ name: 'bvo_session', value: m[1], domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  }

  const t0 = Date.now();
  await page.goto('/office');

  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(1000);
    const loc = page.locator('#office-svg-canvas');
    const count = await loc.count();
    const visible = count > 0 ? await loc.isVisible() : null;
    const box = count > 0 ? await loc.boundingBox() : null;
    console.log(`+${((Date.now()-t0)/1000).toFixed(0)}s count=${count} visible=${visible} box=${JSON.stringify(box)}`);
    if (count > 0 && visible) break;
  }
  await page.screenshot({ path: 'tests/e2e/screenshots/debug-visibility.png', fullPage: true });
});
