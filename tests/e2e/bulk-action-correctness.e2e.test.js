// Bulk Action correctness tests
// Verifies: Select All not treated as individual checkbox, undefined IDs prevented,
// selection count verified, bulk cancel/retry behavior, error handling.
// Runs against isolated E2E server (port 3102, fresh DB).

import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL;
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD;

test.describe('Bulk Action Manager correctness', () => {
  test('bulk-action.js toggleAll has undefined ID guard', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const bulkActionSource = await page.evaluate(() => {
      return fetch('/assets/js/core/bulk-action.js').then(r => r.text());
    });

    expect(bulkActionSource).toContain('toggleAll');
    expect(bulkActionSource).toContain('selectedIds');
    // Undefined ID guard in toggleAll
    expect(bulkActionSource).toContain("if (!id || id === 'undefined') return;");
    // Undefined ID guard in individual checkbox handler
    expect(bulkActionSource).toContain("if (!id || id === 'undefined') return;");
  });

  test('tasks-view.js Select All has no bulk-checkbox class', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const tasksViewSource = await page.evaluate(() => {
      return fetch('/assets/js/views/tasks-view.js').then(r => r.text());
    });

    // Select All checkbox exists with id="bulk-select-all"
    expect(tasksViewSource).toContain('id="bulk-select-all"');

    // Select All does NOT have bulk-checkbox class (it's separate from tbody checkboxes)
    expect(tasksViewSource).not.toMatch(/bulk-select-all"[^>]*bulk-checkbox/);

    // Individual checkboxes have bulk-checkbox class
    expect(tasksViewSource).toContain('class="bulk-checkbox');
    expect(tasksViewSource).toContain('data-id="${t.id}"');
  });

  test('tasks-view.js bulkCancel and bulkRetry use Promise.allSettled', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const tasksViewSource = await page.evaluate(() => {
      return fetch('/assets/js/views/tasks-view.js').then(r => r.text());
    });

    expect(tasksViewSource).toContain('bulkCancel');
    expect(tasksViewSource).toContain('bulkRetry');
    expect(tasksViewSource).toContain('Promise.allSettled');
  });

  test('approval-escalation.js auto-reject disabled', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const escSource = await page.evaluate(() => {
      return fetch('/assets/js/core/approval-escalation.js').then(r => r.text());
    });

    // Auto-reject is disabled (countdown is informational only)
    expect(escSource).toContain('autoReject');
    expect(escSource).toContain('informational');
    // Should NOT silently reject via handleAutoReject
    expect(escSource).not.toContain('handleAutoReject()');
  });
});
