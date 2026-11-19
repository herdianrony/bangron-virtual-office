import { test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:3003' });

test('debug context.request ports', async ({ page, context }) => {
  const lr = await context.request.post('/api/auth/login', {
    data: { email: 'director@bangron.office', password: 'TestPass123456' }
  });
  console.log('LOGIN', lr.status());
  const setCookie = lr.headers()['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of cookies) {
    const m = c.match(/bvo_session=([^;]+)/);
    if (m) await context.addCookies([{ name: 'bvo_session', value: m[1], domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  }

  for (const port of [3002, 3003]) {
    const t0 = Date.now();
    try {
      const res = await context.request.get(`http://localhost:${port}/api/virtual-office/state`);
      console.log(`port ${port}: status=${res.status()} in ${Date.now()-t0}ms`);
    } catch (e) {
      console.log(`port ${port}: ERROR after ${Date.now()-t0}ms: ${e.message}`);
    }
  }
});
