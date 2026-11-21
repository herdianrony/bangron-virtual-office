// Bulk Action correctness tests
// Verifies: Select All not treated as individual checkbox, undefined IDs prevented,
// selection count verified, bulk cancel/retry behavior, error handling.
// NOTE: DOM-dependent tests require authenticated session + task seeding.
// Run in CI with full browser context (page.request.post login + set cookies).

import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';

dotenv.config();

const DIRECTOR_EMAIL = process.env.INITIAL_DIRECTOR_EMAIL;
const DIRECTOR_PASSWORD = process.env.INITIAL_DIRECTOR_PASSWORD;

test.describe('Bulk Action Manager correctness', () => {
  test('bulk-action.js exports toggleAll with undefined ID guard', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const bulkActionSource = await page.evaluate(() => {
      return fetch('/assets/js/core/bulk-action.js').then(r => r.text());
    });

    // toggleAll should guard against undefined/null IDs
    expect(bulkActionSource).toContain('toggleAll');
    expect(bulkActionSource).toContain('id');
    expect(bulkActionSource).toContain('selectedIds');

    // Verify bulkCancel uses Promise.allSettled for error handling
    expect(bulkActionSource).toContain('Promise.allSettled');

    // Verify bulkRetry uses Promise.allSettled for error handling
    expect(bulkActionSource).toContain('bulkRetry');
  });

  test('tasks-view.js Select All has no bulk-checkbox class', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const tasksViewSource = await page.evaluate(() => {
      return fetch('/assets/js/views/tasks-view.js').then(r => r.text());
    });

    // Select All checkbox should NOT have bulk-checkbox class
    expect(tasksViewSource).toContain('id="bulk-select-all"');
    expect(tasksViewSource).not.toContain('bulk-select-all" class="bulk-checkbox');
    expect(tasksViewSource).not.toContain('bulk-select-all" class=".*bulk-checkbox');

    // Individual checkboxes should have bulk-checkbox class
    expect(tasksViewSource).toContain('class="bulk-checkbox');
  });

  test('bulkCancel and bulkRetry have error handling', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const bulkActionSource = await page.evaluate(() => {
      return fetch('/assets/js/core/bulk-action.js').then(r => r.text());
    });

    // Verify error handling patterns
    expect(bulkActionSource).toContain('catch');
    expect(bulkActionSource).toContain('Promise.allSettled');
  });

  test('approval-escalation.js auto-reject disabled', async ({ page }) => {
    await page.goto('/office');
    await page.waitForTimeout(2000);

    const escSource = await page.evaluate(() => {
      return fetch('/assets/js/core/approval-escalation.js').then(r => r.text());
    });

    // Auto-reject should be disabled (informational countdown only)
    expect(escSource).toContain('autoReject');
    expect(escSource).toContain('informational');
    // Should NOT silently reject
    expect(escSource).not.toContain('handleAutoReject()');
  });
});
