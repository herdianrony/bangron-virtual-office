import { defineConfig, devices } from '@playwright/test';
import { E2E_ENV, E2E_PORT } from './tests/e2e/e2e-env.js';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',
  // Lifecycle tests share global server state (runtime.status.changed is
  // broadcast to every WS client, agents live in one database). They MUST
  // run serially — parallel workers would race on runtime status and agent
  // lifecycle assertions.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    // Provision the isolated E2E database FIRST, then start the app server.
    // Playwright starts webServer before globalSetup, so the DB must be
    // seeded before the server opens it (see tests/e2e/prepare-db.js).
    command: 'node tests/e2e/prepare-db.js && node src/server.js',
    env: E2E_ENV,
    port: E2E_PORT,
    baseURL: `http://localhost:${E2E_PORT}`,
    // Never reuse an existing server: the dev service on 3002 has different
    // env/DB. The E2E server must own the isolated test environment.
    reuseExistingServer: false,
    timeout: 30000
  }
});