# Bangron Virtual Office — Server Test Plan

**Project:** Bangron Virtual Office
**Environment:** Development / Staging / Production
**Version:** 1.0.0-rc.1 (target)
**Last Updated:** 2026-11-20

---

## Test Infrastructure

### Isolation Strategy
- **Development:** Local SQLite (`:memory:` for unit tests, file for integration)
- **Staging:** Dedicated VM/container mirroring production infra
- **Production:** Never execute destructive tests against production
- **Test Database:** Fresh schema + seed per test suite run
- **Hermes:** Mock adapter for unit tests; live gateway (localhost:8642) for integration/E2E

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

### 4. Hermes API Health
**Frequency:** Every test run + continuous (30s interval)

| Check | Command | Expected |
|-------|---------|----------|
| Models endpoint | `curl -H "Auth: Bearer $KEY" $HERMES_URL/v1/models` | 200, `hermes-agent` in list |
| Runtime verified | Adapter `getRuntimeStatus()` | `{connected:true, runtimeVerified:true}` |
| Dispatch dry-run | POST `/v1/runs` with test input | 200/201, returns `run_id` |
| SSE endpoint | `curl -H "Auth: Bearer $KEY" $HERMES_URL/v1/runs/{id}/events` | Stream opens, events flow |
| Webhook signature | POST `/api/integrations/hermes/events` | 200 with valid HMAC; 401 without |

### 5. Unit Tests
**Frequency:** Every commit (CI) + pre-merge
**Command:** `npm test` (vitest)
**Target:** 100% pass, < 60s

| Suite | File | Tests | Focus |
|-------|------|-------|-------|
| Database | `tests/unit/database.test.js` | 5 | Migrations, seeds, repos |
| API Integration | `tests/integration/api.test.js` | 8 | Auth, tasks, agents, WS |
| Phase 3 Integration | `tests/unit/phase3-integration.test.js` | 22 | Avatar states, WS snapshot, movement, watchdog |
| Runtime Watchdog | `tests/unit/runtime-watchdog.test.js` | 8 | Lifecycle/runtime separation, reconnect |
| Hermes Adapter | `tests/unit/hermes-adapter.test.js` | TBD | Dispatch, retry, circuit breaker |
| Approval Workflow | `tests/unit/approval*.test.js` | TBD | Queue, approve/reject, audit |
| Task Management | `tests/unit/task*.test.js` | TBD | CRUD, deps, assignment, deliverables |
| Security | `tests/unit/security*.test.js` | TBD | Intercept, RBAC, headers, secrets |

### 6. CSS Build
**Frequency:** Pre-commit + CI
**Command:** `npm run build:css`
**Target:** < 10s, no errors, output file exists

```bash
npm run build:css
ls -la public/assets/css/tailwind-daisyui.bundle.css
```

### 7. Integration Tests (API + WS + Hermes)
**Frequency:** Daily + pre-merge
**Command:** `npx playwright test tests/e2e/integration-e2e.test.js`
**Target:** 100% pass, < 120s

| Scenario | Steps | Verification |
|----------|-------|--------------|
| Auth flow | Login → CSRF → API calls → Logout | Session valid, cookie secure |
| Task lifecycle | Create → Assign → Start → Complete | DB + WS + Hermes events match |
| Agent movement | Assign → Waypoints → Arrive | Position updates via WS |
| Approval gate | High-risk action → Approve → Execute | Audit log + state change |
| Runtime disconnect | Working agent → Disconnect → Reconnect | Lifecycle preserved, WS recovers |
| Multi-agent | 2+ agents concurrent tasks | No race conditions, isolated state |

### 8. Playwright E2E (Full Browser)
**Frequency:** Daily + pre-merge + pre-release
**Command:** `npx playwright test`
**Target:** 100% pass, < 300s

| Test File | Scenarios | Key Assertions |
|-----------|-----------|----------------|
| `office-e2e.test.js` (Phase 3.1) | 5 | Page load, runtime indicator, nav, HUD, WS connect |
| `office-e2e.test.js` (Phase 3.2) | 6 | Login → assign → queued → working → completed → idle; failed; disconnect; recovery; refresh |
| `approval-e2e.test.js` | TBD | Queue visible, approve/reject, audit trail |
| `task-lifecycle-e2e.test.js` | TBD | Kanban drag, deps, subagents, deliverables |
| `hermes-live-e2e.test.js` | TBD | Real Hermes dispatch → execution → UI update |
| `security-e2e.test.js` | TBD | RBAC, auth bypass attempts, secret exposure |

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
**Frequency:** Every test run (unit) + daily (E2E)

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

### Daily (Automated via CI/CD)
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
1. npm test                    → 48/48 pass
2. npm run build:css           → success
3. npx playwright test         → 13/13 pass
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
- **Unit:** 48/48 ✅ (45s)
- **Integration:** 12/12 ✅ (30s)
- **E2E:** 13/13 ✅ (180s)
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

### GitHub Actions Workflow (`.github/workflows/test.yml`)
```yaml
name: Test Suite
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run build:css
      - run: npm test
      - uses: actions/upload-artifact@v4
        with: { name: unit-results, path: test-results/ }
  
  e2e:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        with: { name: e2e-report, path: playwright-report/ }
      - uses: actions/upload-artifact@v4
        with: { name: e2e-results, path: test-results/ }
  
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm audit --audit-level=high
      - run: npx audit-ci --config audit-ci.json
```

---

## Acceptance Criteria for Test Infrastructure

- [ ] All test commands documented and working
- [ ] Isolated test databases (no cross-contamination)
- [ ] CI runs all suites on every PR
- [ ] PR comments updated with test results automatically
- [ ] Screenshots captured on E2E failure
- [ ] Test reports retained 30 days
- [ ] No persistent scheduled jobs in production
- [ ] Destructive tests never run against production
- [ ] Hermes mock available for unit tests
- [ ] Live Hermes used only for integration/E2E

---

**Document Version:** 1.0
**Owner:** QA Automation Engineer
**Review Cycle:** Daily during acceleration; weekly thereafter