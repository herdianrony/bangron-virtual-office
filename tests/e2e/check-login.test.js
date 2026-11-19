import { test } from '@playwright/test';

test('check login page', async ({ page }) => {
  await page.goto('http://localhost:3002/login');
  await page.waitForTimeout(2000);
  const html = await page.content();
  console.log(html);
});
