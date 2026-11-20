# Bangron Virtual Office — Server Test Plan

**Project:** Bangron Virtual Office
**Environment:** Development / Staging / Production
**Version:** 1.0.0-rc.1 (target)
**Last Updated:** 2026-11-20 (rev 1.1 — evidence-boundary correction)

---

## Evidence Boundaries — Executed vs Planned (read first)

**Executed and verified (historical evidence, preserved):**
- Phase 3.2.2 at tested code SHA `22d66b69ccccb12004d855432f9c90c3feff270f`: **98 unit/integration tests passed / 0 failed / 0 skipped** (13 files), **10 Playwright E2E passed / 0 failed / 0 skipped** (5 Phase 3.1 smoke + 5 Phase 3.2 lifecycle, chromium), CSS build success.
- CI re-verification at `5d56112d22c4920ac4808a9abb46eacea2f52ae6` (PR #2, run [44670861607](https://github.com/herdianrony/bangron-virtual-office/actions/runs/44670861607)) on **GitHub-hosted `ubuntu-latest` runners**: same suites green + dependency audit (0 critical/high).

**Hermes evidence boundary:**
- Every Hermes event in the executed unit/E2E/CI lifecycle tests is **simulated** through the HMAC-signed webhook contract with `HERMES_RUNTIME_VERIFIED=false` and a dead-port `HERMES_API_URL` (the watchdog cannot reach a live runtime).
- `HERMES_RUNTIME_VERIFIED=false` means **live Hermes integration is NOT verified**. Simulated tests never count as live verification.
- **Live Hermes runtime integration remains outstanding — Gate G6 production-readiness blocker** (kanban `t_e15f8a03`, software-house board). Scheduled around Phase 5 / Gate G3; must pass before G6.
- **GitHub-hosted runners execute routine CI.** The homelab is reserved for the application runtime and for live Hermes integration verification — CI never runs on the homelab and never dispatches to the live Hermes API.

**Planned, NOT yet executed:** `integration-e2e.test.js`, `approval-e2e.test.js`, `task-lifecycle-e2e.test.js`, `hermes-live-e2e.test.js`, `security-e2e.test.js`, and the live Hermes API health checks in §4. These remain in the plan (Phases 4–7 / G6 gate); no results exist for them yet. Planned live-integration tests are deliberately retained, not removed.

---

## Test Infrastructure

### Isolation Strategy
- **Development:** Local SQLite (`:memory:` for unit tests, file for integration)
- **Staging:** Dedicated VM/container mirroring production infra
- **Production:** Never execute destructive tests against production
- **Test Database:** Fresh schema + seed per test suite run
- **Hermes:** Simulated HMAC-signed webhook events for ALL executed unit/integration/E2E/CI tests (`HERMES_RUNTIME_VERIFIED=false`, dead-port `HERMES_API_URL`). Live gateway verification is **planned only** (Gate G6 outstanding) and will run on the homelab/staging — never in CI. (Superseded: the earlier "live gateway (localhost:8642) for integration/E2E" statement — no executed test used a live gateway.)

### Test Data Management
- Each test suite gets isolated database instance
- Seeded with: office layout, rooms, workstations, 6 agent profiles, 1 Director user
- No shared state between test files
- Cleanup: `afterEach` closes DB connections

---

## Test Categories

### 1. Server Health Check
**Frequency:** Every test run + continuous monitoring
**Target:** < 5s execution

| Check | Command | Expected | Failure Action |
|-------|---------|----------|----------------|
| HTTP server responds | `curl -f http://localhost:3002/healthz` | 200 OK, JSON `{status:"ok"}` | Alert |
| Database connectivity | `npm run health-check` | `database: "connected"` | Alert |
| WebSocket server accepts | `wscat -c ws://localhost:3002/ws` | 101 Switching Protocols | Alert |
| Memory usage | `process.memoryUsage().heapUsed < 500MB` | Pass | Warn |
| Event loop lag | `< 50ms` | Pass | Warn |

### 2. Database Connectivity & Migrations
**Frequency:** Every test run + pre-deploy

| Test | Command | Expected |
|------|---------|----------|
| Migration up (v1, v2) | `npm run migrate` | All applied, no errors |
| Migration down (v2, v1) | `npm run migrate:down` | All reverted, schema clean |
| Idempotent re-apply | `npm run migrate && npm run migrate` | No errors, no duplicate data |
| Seed data integrity | `npm run seed` | Director + 6 profiles + office layout |
| Foreign key constraints | `PRAGMA foreign_key_check` | Empty result |
| Backup script | `npm run backup` | Valid `.sqlite.backup` file |
| Restore validation | `npm run restore:test` | Restored DB matches original |

### 3. Application Health
**Frequency:** Every test run

| Endpoint | Method | Auth | Expected |
|----------|--------|------|----------|
| `/healthz` | GET | None | 200, `{status:"ok",timestamp,uptime}` |
| `/readyz` | GET | None | 200 if DB + Hermes ready, 503 otherwise |
| `/metrics` | GET | None | Prometheus format, key metrics present |
| `/api/auth/csrf` | GET | Session | 200, `{csrfToken}` |
| `/api/virtual-office/state` | GET | Director | 200, full office state |
| `/api/integrations/hermes/status` | GET | Director | 200, `{runtime:{connected,verified}}` |

### 4. Hermes API Health (live-runtime checks — PLANNED, not executed)
**Frequency (planned):** Continuous (30s interval) on the homelab runtime + during the live Hermes integration verification gate (G6 blocker, kanban `t_e15f8a03`).
**Evidence boundary:** These checks target the **live** Hermes API and are NOT part of the executed unit/E2E/CI suites. In all executed tests the adapter reports `runtimeVerified:false` (`HERMES_RUNTIME_VERIFIED=false`) and the watchdog points at a dead port.

| Check | Command | Expected |
|-------|---------|----------|
| Models endpoint | `curl -H "Auth: Bearer $KEY" $HERMES_URL/v1/models` | 200, `hermes-agent` in list |
| Runtime verified | Adapter `getRuntimeStatus()` | `{connected:true, runtimeVerified:true}` |
| Dispatch dry-run | POST `/v1/runs` with test input | 200/201, returns `run_id` |
| SSE endpoint | `curl -H "Auth: Bearer $KEY" $HERMES_URL/v1/runs/{id}/events` | Stream opens, events flow |
| Webhook signature | POST `/api/integrations/hermes/events` | 200 with valid HMAC; 401 without |

**Status per row:** Models endpoint, runtime-verified, dispatch dry-run, and SSE checks are **planned live checks** — `runtimeVerified:true` may only be expected after the G6 live-integration gate passes. The webhook-signature check is **executed** in unit/E2E/CI using simulated HMAC-signed events (200 with valid signature; 401 without).

### 5. Unit Tests
**Frequency:** Every commit (CI) + pre-merge
**Command:** `npm test` (vitest)
**Target:** 100% pass, < 60s
**Verified result:** 98 passed / 0 failed / 0 skipped (13 files) at `22d66b6`; CI re-verified at `5d56112`. `npm test` includes `tests/unit/**` (the Phase 3 integration suite lives there); `tests/integration/api.test.js` exists but is outside the default vitest include. Per-suite counts below are original planning targets (superseded).

| Suite | File | Tests | Focus |
|-------|------|-------|-------|
| Database | `tests/unit/database.test.js` | 5 | Migrations, seeds, repos |
| API Integration | `tests/integration/api.test.js` | 8 | Auth, tasks, agents, WS |
| Phase 3 Integration | `tests/unit/phase3-integration.test.js` | 22 | Avatar states, WS snapshot, movement, watchdog |
| Runtime Watchdog | `tests/unit/runtime-watchdog.test.js` | 8 | Lifecycle/runtime separation, reconnect |
| Hermes Reconciler | `tests/unit/hermes-reconciler.test.js` | included in 98 | Simulated HMAC-signed events → reconciler → store/WS (no live dispatch) |
| Hermes Failure | `tests/unit/hermes-failure.test.js` | included in 98 | Simulated failure events → lifecycle mapping (no live dispatch) |
| Approval Workflow | `tests/unit/approval*.test.js` | TBD | Queue, approve/reject, audit |
| Task Management | `tests/unit/task*.test.js` | TBD | CRUD, deps, assignment, deliverables |
| Security | `tests/unit/security*.test.js` | TBD | Intercept, RBAC, headers, secrets |

**Hermes unit-test boundary:** executed Hermes unit coverage is simulated-event processing only (reconciler, failure mapping, runtime watchdog). No unit test dispatches to a live Hermes runtime. The planning name `hermes-adapter.test.js` was superseded by the actual suites above; the retry/circuit-breaker suite (`hermes-retry.test.js`) is planned for Phase 6.

### 6. CSS Build
**Frequency:** Pre-commit + CI
**Command:** `npm run build:css`
**Target:** < 10s, no errors, output file exists

```bash
npm run build:css
ls -la public/assets/css/tailwind-daisyui.bundle.css
```

### 7. Integration Tests (API + WS + Hermes)
**Status:** Executed coverage = Phase 3 integration unit suite (`tests/unit/phase3-integration.test.js`, part of the verified 98) + lifecycle E2E — all with **simulated** Hermes events. The full integration E2E below is **planned** (Phase 7); `tests/e2e/integration-e2e.test.js` does not exist yet.
**Frequency:** Per CI run (PR/push) + pre-merge for the executed suites; daily staging runs planned for Phase 7 (the implemented CI workflow has no cron trigger).
**Command (planned):** `npx playwright test tests/e2e/integration-e2e.test.js`
**Target:** 100% pass, < 120s

| Scenario | Steps | Verification |
|----------|-------|--------------|
| Auth flow | Login → CSRF → API calls → Logout | Session valid, cookie secure |
| Task lifecycle | Create → Assign → Start → Complete | DB + WS + simulated Hermes events match (executed); live event match planned for Phase 7 / G6 gate |
| Agent movement | Assign → Waypoints → Arrive | Position updates via WS |
| Approval gate | High-risk action → Approve → Execute | Audit log + state change |
| Runtime disconnect | Working agent → Disconnect → Reconnect | Lifecycle preserved, WS recovers |
| Multi-agent | 2+ agents concurrent tasks | No race conditions, isolated state |

### 8. Playwright E2E (Full Browser)
**Frequency:** Per CI run (PR/push) + pre-merge + pre-release (executed suite); daily staging runs planned for Phase 7
**Command:** `npx playwright test`
**Target:** 100% pass, < 300s
**Verified result:** 10 passed / 0 failed / 0 skipped (chromium, 1 worker) at `22d66b6`; CI re-verified at `5d56112`. Only `office-e2e.test.js` exists today; all other files below are **planned, not executed**. All executed E2E Hermes events are simulated HMAC-signed webhooks (`HERMES_RUNTIME_VERIFIED=false`); disconnect/recovery is exercised against the dead-port watchdog, not a live runtime.

| Test File | Scenarios | Key Assertions |
|-----------|-----------|----------------|
| `office-e2e.test.js` (Phase 3.1) | 5 | Page load, runtime indicator, nav, HUD, WS connect |
| `office-e2e.test.js` (Phase 3.2) | 5 (original 6 superseded — suite restructured) | Login → assign → queued → working → completed → idle; failed; disconnect; recovery; refresh |
| `approval-e2e.test.js` (planned, Phase 4) | TBD | Queue visible, approve/reject, audit trail |
| `task-lifecycle-e2e.test.js` (planned, Phase 5) | TBD | Kanban drag, deps, subagents, deliverables |
| `hermes-live-e2e.test.js` (planned — LIVE, homelab/staging, G6 gate) | TBD | Real Hermes dispatch → execution → UI update. NOT executed; simulated E2E events do not satisfy this test |
| `security-e2e.test.js` (planned, Phase 7) | TBD | RBAC, auth bypass attempts, secret exposure |

### 9. WebSocket Tests
**Frequency:** Daily + pre-merge

| Test | Method | Expected |
|------|--------|----------|
| Connection + auth | WS connect with session cookie | `wsConnected: true`, snapshot received |
| Reconnect (server restart) | Kill server, wait, restart | Client reconnects < 30s, state restored |
| Reconnect (network blip) | Block WS port 5s, restore | Exponential backoff, max 10 attempts |
| Heartbeat | 30s ping/pong | No stale connections |
| Backpressure | Flood 1000 messages | Queue drains, no OOM |
| Graceful close | Server shutdown | `onclose` clean, no errors |
| Message envelope | All event types | `{type, event_id, timestamp, correlation_id, data}` |

### 10. Runtime Lifecycle Tests
**Frequency:** Every test run (unit) + per CI run (E2E); daily staging runs planned for Phase 7
**Evidence boundary:** Executed disconnect/recovery tests simulate runtime state (dead-port `HERMES_API_URL` + explicit test-only endpoints). Watchdog verification against the LIVE API is part of the outstanding G6 gate, not yet executed.

| Scenario | Unit Test | E2E Test |
|----------|-----------|----------|
| Runtime disconnect → agent lifecycle preserved | `runtime-watchdog.test.js` | `office-e2e.test.js` "disconnect" |
| Runtime recover → agent resumes | `runtime-watchdog.test.js` | `office-e2e.test.js` "recovery" |
| Watchdog publishes `runtime.status.changed` | `runtime-watchdog.test.js` | WS message verified |
| Health check in-flight flag prevents overlap | `runtime-watchdog.test.js` | Load test |
| Agent status NOT overwritten by runtime | `runtime-watchdog.test.js` | `office-e2e.test.js` "working preserved" |
| Transient `completed` → `idle` (1500ms) | `phase3-integration.test.js` | `office-e2e.test.js` "completed→idle" |

---

## Test Execution Schedule

### Routine CI (automated — actual triggers, GitHub-hosted runners)
The implemented CI workflow (PR #2, `.github/workflows/ci.yml` on `chore/github-actions-ci`) runs on `pull_request`, `push`, and `workflow_dispatch` — **no daily cron**. All jobs run on GitHub-hosted `ubuntu-latest` runners; the homelab is reserved for the application runtime and live Hermes integration verification.
```
Per CI run:  Unit & Integration Tests | CSS Build | Playwright E2E | Security & Dependency Audit
```

Original daily planning block (SUPERSEDED — preserved for context):
```
06:00  Unit tests + CSS build
06:15  Integration tests (API + WS)
06:30  E2E tests (Playwright)
07:00  Security scan (npm audit + OWASP)
07:15  Performance baseline (k6)
07:30  Report generation + PR comments
```

### Pre-Merge (Required for PR approval)
```
1. npm test                    → 98 passed / 0 failed / 0 skipped (13 files; original 48/48 target superseded)
2. npm run build:css           → success
3. npx playwright test         → 10 passed / 0 failed / 0 skipped (original 13/13 target superseded)
4. npm audit --audit-level=high → 0 critical/high
5. Security review checklist   → all ✅
```

### Pre-Release (Day 10)
```
1. Full regression (all above)
2. Staging deployment + smoke tests
3. Live Hermes integration test
4. Director acceptance sign-off
5. Production deploy (authorized)
6. Post-deploy verification
```

---

## Test Report Generation

### Artifacts
| Artifact | Location | Retention |
|----------|----------|-----------|
| Unit test JUnit XML | `test-results/unit.xml` | 30 days |
| Playwright HTML report | `playwright-report/` | 30 days |
| Playwright JSON results | `test-results/e2e.json` | 30 days |
| Screenshots (failures) | `tests/e2e/screenshots/` | 30 days |
| Coverage report | `coverage/` | 30 days |
| Load test results | `load-test-results/` | 30 days |
| Security audit log | `security-audit-YYYY-MM-DD.json` | 90 days |

### Report Format (Daily PR Comment)
```markdown
## Daily Test Report — YYYY-MM-DD

### Summary
- **Unit & integration:** 98/98 ✅ (verified baseline at `22d66b6`; example format)
- **E2E:** 10/10 ✅ (5 smoke + 5 lifecycle; example format)
- **Security:** 0 critical, 0 high, 2 medium (deps)
- **Performance:** p95=142ms, WS=23ms

### Failures
_None_

### New Coverage
- `hermes-retry.test.js`: +15 tests
- `approval-e2e.test.js`: +8 tests

### Trends
- E2E duration: 180s → 165s (improved)
- Unit flakiness: 0% (stable)

### Action Items
- [ ] Update deps for medium vulnerabilities
- [ ] Add load test for 200 concurrent WS
```

---

## Test Commands Reference

```bash
# Unit tests only
npm test

# Unit tests with coverage
npm test -- --coverage

# Specific test file
npm test -- tests/unit/runtime-watchdog.test.js

# Watch mode
npm run test:watch

# CSS build
npm run build:css

# All E2E tests
npx playwright test

# Specific E2E project
npx playwright test --project=chromium

# Specific test file
npx playwright test tests/e2e/office-e2e.test.js

# Headed mode (debug)
npx playwright test --headed

# Debug specific test
npx playwright test tests/e2e/office-e2e.test.js --grep "director login" --headed

# Integration tests (API only)
npx playwright test tests/e2e/integration-e2e.test.js

# Health check
npm run health-check

# Database backup
npm run backup

# Database migration
npm run migrate

# Seed database
npm run seed

# Load test (k6)
k6 run load-test.js
```

---

## CI/CD Integration

### GitHub Actions Workflow (actual: `.github/workflows/ci.yml`, PR #2)

The implemented workflow lives on `chore/github-actions-ci` (PR #2, head `5d56112`, stacked on PR #1). All jobs run on **GitHub-hosted `ubuntu-latest` runners** — never on the homelab. The homelab is reserved for the application runtime and live Hermes integration verification (G6 gate).

```yaml
# .github/workflows/ci.yml (PR #2, chore/github-actions-ci)
on:
  pull_request:
    branches: [main, fix/security-hardening]
  push:
    branches: [main, fix/security-hardening, 'feat/**', 'fix/**', 'chore/**']
  workflow_dispatch:
```

Jobs (verified green in run 44670861607 at `5d56112`):
- `Unit & Integration Tests` — `npm test` (isolated in-memory SQLite); 98 passed / 0 failed / 0 skipped (13 files)
- `CSS Build` — `npm run build:css`; bundle generated successfully
- `Playwright E2E` — app server starts inside the runner (port 3102, dedicated freshly-seeded SQLite DB, synthetic CI-only credentials, `HERMES_RUNTIME_VERIFIED=false`, dead-port watchdog); 10 passed / 0 failed / 0 skipped (chromium)
- `Security & Dependency Audit` — `npm audit --audit-level=high`; 0 critical / 0 high (2 moderate baseline, non-blocking)

CI E2E Hermes events are simulated HMAC-signed webhooks; CI never connects to the homelab, production data, or the live Hermes API. Simulated CI events do NOT constitute live Hermes runtime verification (outstanding G6 gate, kanban `t_e15f8a03`).

(The original `.github/workflows/test.yml` planning snippet is superseded — no such file exists; the implemented workflow is `ci.yml` above. Required status checks / branch protection are recommended but NOT applied; applying them needs Director approval.)

---

## Acceptance Criteria for Test Infrastructure

- [ ] All test commands documented and working
- [ ] Isolated test databases (no cross-contamination)
- [x] CI runs all suites on every PR (PR #2 workflow, GitHub-hosted runners; verified green in run 44670861607 at `5d56112`)
- [ ] PR comments updated with test results automatically
- [ ] Screenshots captured on E2E failure
- [ ] Test reports retained 30 days
- [ ] No persistent scheduled jobs in production
- [ ] Destructive tests never run against production
- [x] Hermes simulated-event harness available for unit/E2E tests (HMAC-signed webhooks, `HERMES_RUNTIME_VERIFIED=false`) — exercised at `22d66b6` and in CI
- [ ] Live Hermes verification (PLANNED, G6 outstanding): homelab/staging only, never CI. Executed integration/E2E/CI suites use simulated events and do NOT verify live integration

---

**Document Version:** 1.1 (2026-11-20: evidence-boundary correction — simulated vs live Hermes, executed vs planned tests, actual CI workflow and counts; historical evidence and tested SHA `22d66b69ccccb12004d855432f9c90c3feff270f` preserved)
**Owner:** QA Automation Engineer
**Review Cycle:** Daily during acceleration; weekly thereafter