// Playwright globalSetup: validate the E2E environment contract ONLY.
//
// Database provisioning lives in tests/e2e/prepare-db.js and runs as the first
// half of the webServer command (`node tests/e2e/prepare-db.js && node src/server.js`).
//
// WHY: Playwright starts webServer BEFORE globalSetup. If globalSetup deleted
// and re-seeded the SQLite file, the already-running server would keep an open
// handle to the deleted inode (a database with no director user), and every
// login would fail with "Invalid email, username, or password". Provisioning
// inside the webServer command guarantees the DB is fully seeded BEFORE the
// server process opens it, regardless of Playwright's hook ordering.
import dotenv from 'dotenv';
import { requireE2ECredentials } from './prepare-db.js';

dotenv.config(); // repo-root .env; real environment variables take precedence

export default async function globalSetup() {
  requireE2ECredentials();
}