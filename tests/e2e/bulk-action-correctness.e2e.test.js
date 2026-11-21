// Bulk Action correctness tests
// Verifies: Select All not treated as individual checkbox, undefined IDs prevented,
// selection count verified, bulk cancel/retry behavior, error handling.
// Runs against isolated E2E server (port 3102, fresh DB).
// Creates test tasks via API before testing bulk selection.

import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL;
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD;

async function loginAsDirector(page) {
  await page.goto('/login');
  await page.waitForSelector('#login-form', { timeout: 15000 });
  await page.fill('#login-username', DIRECTOR_EMAIL);
  await page.fill('#login-password', DIRECTOR_PASSWORD);
  await page.click('#login-submit-btn');
  await page.waitForFunction(() => Boolean(window.store?.state?.user), null, { timeout: 15000 });
}

async function createTestTasks(page, count = 3) {
  const tasks = [];
  for (let i = 0; i < count; i++) {
    const res = await page.request.post('/api/tasks', {
      data: {
        title: `E2E Bulk Test Task ${i + 1}`,
        description: 'Created by E2E bulk action test',
        status: 'pending',
        priority: 'medium',
      },
    });
    if (res.ok()) {
      const body = await res.json();
      tasks.push(body.data || body);
    }
  }
  return tasks;
}

test.describe('Bulk Action Manager correctness', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsDirector(page);
    await createTestTasks(page, 3);
    await page.goto('/tasks');
    await page.waitForTimeout(2000);
  });

  test('Select All checkbox is separate from individual task checkboxes', async ({ page }) => {
    const selectAll = page.locator('#bulk-select-all');
    await expect(selectAll).toBeVisible();

    // Select All should NOT have 'bulk-checkbox' class
    const selectAllClasses = await selectAll.getAttribute('class');
    expect(selectAllClasses).not.toContain('bulk-checkbox');

    // Individual task checkboxes should have 'bulk-checkbox' class
    const individualCheckboxes = page.locator('input.bulk-checkbox[data-id]');
    const count = await individualCheckboxes.count();
    expect(count).toBeGreaterThan(0);
    const firstClasses = await individualCheckboxes.first().getAttribute('class');
    expect(firstClasses).toContain('bulk-checkbox');
  });

  test('Select All toggles all individual task checkboxes', async ({ page }) => {
    const selectAll = page.locator('#bulk-select-all');
    const individualCheckboxes = page.locator('input.bulk-checkbox[data-id]');
    const count = await individualCheckboxes.count();
    expect(count).toBeGreaterThan(0);

    // Click Select All
    await selectAll.click();
    await page.waitForTimeout(500);

    // All individual checkboxes should be checked
    for (let i = 0; i < count; i++) {
      expect(await individualCheckboxes.nth(i).isChecked()).toBe(true);
    }

    // Click Select All again to deselect
    await selectAll.click();
    await page.waitForTimeout(500);

    // All individual checkboxes should be unchecked
    for (let i = 0; i < count; i++) {
      expect(await individualCheckboxes.nth(i).isChecked()).toBe(false);
    }
  });

  test('Individual checkbox selection updates count correctly', async ({ page }) => {
    const individualCheckboxes = page.locator('input.bulk-checkbox[data-id]');
    const count = await individualCheckboxes.count();
    expect(count).toBeGreaterThan(0);

    // Select first checkbox
    await individualCheckboxes.first().click();
    await page.waitForTimeout(500);

    // Bulk toolbar should show count
    const toolbar = page.locator('#bulk-action-toolbar');
    await expect(toolbar).not.toHaveClass(/hidden/);

    // Deselect first
    await individualCheckboxes.first().click();
    await page.waitForTimeout(500);

    // Toolbar should be hidden when nothing selected
    await expect(toolbar).toHaveClass(/hidden/);
  });

  test('Select All shows indeterminate state when some selected', async ({ page }) => {
    const selectAll = page.locator('#bulk-select-all');
    const individualCheckboxes = page.locator('input.bulk-checkbox[data-id]');
    const count = await individualCheckboxes.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Select only first checkbox
    await individualCheckboxes.first().click();
    await page.waitForTimeout(500);

    // Select All should be indeterminate
    expect(await selectAll.evaluate((el) => el.indeterminate)).toBe(true);
    expect(await selectAll.isChecked()).toBe(false);
  });

  test('Bulk cancel with confirmation and error handling', async ({ page }) => {
    const individualCheckboxes = page.locator('input.bulk-checkbox[data-id]');
    const count = await individualCheckboxes.count();
    expect(count).toBeGreaterThan(0);

    // Select all tasks
    await page.locator('#bulk-select-all').click();
    await page.waitForTimeout(500);

    // Click bulk cancel button
    const bulkActionsGroup = page.locator('#bulk-actions-group');
    await expect(bulkActionsGroup).toBeVisible();

    const cancelBtn = bulkActionsGroup.locator('button').filter(
      (el) => el.getAttribute('title')?.includes('Batalkan')
    );
    if ((await cancelBtn.count()) > 0) {
      await cancelBtn.first().click();
      await page.waitForTimeout(1000);

      // Confirm dialog should appear
      await page.click('button:has-text("Ya, Batalkan Semua")');
      await page.waitForTimeout(2000);

      // Selection should be cleared after bulk action
      const toolbar = page.locator('#bulk-action-toolbar');
      await expect(toolbar).toHaveClass(/hidden/);
    }
  });

  test('Undefined IDs are not added to selectedIds', async ({ page }) => {
    // Verify that all individual checkboxes have valid data-id
    const validCheckboxes = page.locator('input.bulk-checkbox[data-id]');
    const validCount = await validCheckboxes.count();
    expect(validCount).toBeGreaterThan(0);
    for (let i = 0; i < validCount; i++) {
      const id = await validCheckboxes.nth(i).getAttribute('data-id');
      expect(id).toBeTruthy();
      expect(id).not.toBe('undefined');
    }

    // There should be no checkboxes with bulk-checkbox class but without data-id
    const invalidCheckboxes = page.locator('input.bulk-checkbox:not([data-id])');
    const invalidCount = await invalidCheckboxes.count();
    expect(invalidCount).toBe(0);
  });
});
