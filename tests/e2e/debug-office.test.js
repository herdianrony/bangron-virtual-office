import { test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3002' });

test('debug office load', async ({ page, context }) => {
  const errors = [];
  const consoleMsgs = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => consoleMsgs.push(`${msg.type()}: ${msg.text()}`));

  // login via API + set cookie
  const loginRes = await context.request.post('/api/auth/login', {
    data: { email: 'director@bangron.office', password: 'TestPass123456' }
  });
  console.log('LOGIN status', loginRes.status());
  const setCookie = loginRes.headers()['set-cookie'];
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookies) {
      const m = c.match(/bvo_session=([^;]+)/);
      if (m) {
        await context.addCookies([{ name: 'bvo_session', value: m[1], domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
        console.log('COOKIE set');
      }
    }
  }

  await page.goto('/office');
  await page.waitForTimeout(5000);

  const svg = await page.locator('#office-svg-canvas').count();
  console.log('SVG count after goto+5s:', svg);
  const title = await page.title();
  console.log('TITLE:', title);
  const url = page.url();
  console.log('URL:', url);

  // show body html snippet
  const body = await page.evaluate(() => document.body.innerHTML.slice(0, 2000));
  console.log('BODY SNIPPET:', body);

  console.log('--- CONSOLE ---');
  consoleMsgs.forEach(m => console.log(m));
  console.log('--- ERRORS ---');
  errors.forEach(e => console.log(e));

  await page.screenshot({ path: 'tests/e2e/screenshots/debug-office.png', fullPage: true });
});
