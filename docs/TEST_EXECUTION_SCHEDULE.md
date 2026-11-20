# Bangron Virtual Office — Test Execution Schedule

**Project:** Bangron Virtual Office
**Acceleration Period:** 10 Working Days (2026-11-20 → 2026-12-04)
**Schedule Version:** 1.2
**Timezone:** WIB (UTC+07:00)

> **PR numbering (finalized 2026-11-20):** PR #1 = security hardening & Phase 3.2; PR #2 = GitHub Actions CI (`chore/github-actions-ci`, stacked on PR #1); PR #3 = Phase 4 (planned); Phase 5 → PR #4, Phase 6 → PR #5, Phase 7 → PR #6. Day/gate references below use this numbering.

---

## Overview

This schedule defines **when** each test suite runs during the 10-day acceleration.
It complements `SERVER_TEST_PLAN.md` (what/how) and `PROJECT_COMPLETION_ROADMAP.md` (tasks).

### Execution Principles
- **Isolated infrastructure** per test run (fresh DB, clean state)
- **No persistent jobs** in production — all scheduling via CI/CD or manual trigger
- **Destructive tests** (backup/restore, migration down) only on staging
- **Hermes events simulated** (HMAC-signed webhook, `HERMES_RUNTIME_VERIFIED=false`) for unit/E2E/CI — simulated tests never count as live Hermes verification; live runtime integration is a separate outstanding gate (G6 blocker, kanban `t_e15f8a03`)
- **GitHub-hosted runners** execute routine CI tests (PR #2 workflow); the homelab is reserved for application runtime and live Hermes integration verification
- **Evidence required** for every test result (logs, screenshots, artifacts)

---

## Daily Test Schedule (Days 1–10)

### Day 1 — 2026-11-20 (Thursday) — Phase 3.2 Stabilization

**Status: ✅ Executed 2026-11-20 at commit `22d66b6` (98 unit/integration + 10 E2E + CSS build); CI re-verified at `5d56112`, run 44670861607. Original subset counts below are superseded where labeled.**
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Unit tests (baseline) | `npm test` | QA | **98 passed / 0 failed / 0 skipped** (13 files); original 48/48 target superseded |
| 09:30 | CSS build | `npm run build:css` | Frontend | ✅ Success (tailwindcss v4.3.5) |
| 10:00 | Runtime watchdog unit | `npm test -- tests/unit/runtime-watchdog.test.js` | Backend | Included in 98-test suite (original 8/8 subset count superseded) |
| 10:30 | Phase 3 integration | `npm test -- tests/unit/phase3-integration.test.js` | Backend | Included in 98-test suite (original 22/22 subset count superseded) |
| 11:00 | E2E: Login + WS auth fix verification | `npx playwright test` (original `--grep "login\|WebSocket"` subset superseded) | QA | Covered by lifecycle E2E (original 2/2 subset superseded); screenshots in PR #1 |
| 14:00 | E2E: Full Phase 3.1 suite | `npx playwright test tests/e2e/office-e2e.test.js --grep "PHASE 3.1"` | QA | ✅ 5/5 smoke tests pass (part of the 10-test suite), screenshots |
| 15:00 | E2E: Full Phase 3.2 suite | `npx playwright test tests/e2e/office-e2e.test.js --grep "PHASE 3.2"` | QA | ✅ 5/5 lifecycle tests pass (original 6/6 target superseded; suite restructured), screenshots |
| 16:00 | All E2E (regression) | `npx playwright test` | QA | **10 passed / 0 failed / 0 skipped** (chromium, 1 worker); original 13/13 target superseded; HTML report |
| 17:00 | **Day 1 Report** | Update roadmap + PR #1 comment | Main Agent | Markdown report |

**Day 1 Gate (achieved):** 98 unit/integration + 10 E2E tests pass + CSS build success → Phase 3.2 complete; awaiting Director's merge approval of PR #1 (original target 48 unit + 13 E2E superseded)

---

### Day 2 — 2026-11-21 (Friday) — Phase 4: Approval Workflow (Part 1)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Unit tests (regression) | `npm test` | QA | 98+/98+ pass (baseline 98 at `22d66b6`) |
| 09:30 | Approval unit tests (new) | `npm test -- tests/unit/approval*.test.js` | Backend | All new tests pass |
| 10:30 | RBAC unit tests (new) | `npm test -- tests/unit/rbac.test.js` | Backend | All new tests pass |
| 11:00 | Audit log unit tests (new) | `npm test -- tests/unit/audit.test.js` | Backend | All new tests pass |
| 14:00 | Security intercept unit | `npm test -- tests/unit/security-intercept.test.js` | Security | All new tests pass |
| 15:00 | Integration: Approval API | `npx playwright test tests/e2e/approval-api.test.js` | QA | API flow verified |
| 16:00 | **Day 2 Report** | Update roadmap + PR #3 draft | Main Agent | Markdown report |

---

### Day 3 — 2026-11-22 (Saturday) — Phase 4: Approval Workflow (Part 2)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Unit regression | `npm test` | QA | All pass |
| 09:30 | Frontend: Approvals page E2E | `npx playwright test tests/e2e/approval-e2e.test.js --grep "Approvals page"` | Frontend | UI loads, real-time updates |
| 10:30 | Frontend: Audit log viewer E2E | `npx playwright test tests/e2e/approval-e2e.test.js --grep "Audit"` | Frontend | Filterable, export works |
| 11:30 | E2E: Full approval flow | `npx playwright test tests/e2e/approval-e2e.test.js` | QA | End-to-end pass |
| 14:00 | Security review (Phase 4) | Manual + automated | Security | Checklist complete |
| 15:00 | PR #3 creation + test evidence | `gh pr create` | Main Agent | PR with all test results |
| 16:00 | **Day 3 Report** | Update roadmap | Main Agent | Markdown report |

**Day 3 Gate:** PR #3 approved by Director → Phase 4 complete

---

### Day 4 — 2026-11-23 (Sunday) — Phase 5: Task Management (Part 1)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Unit regression | `npm test` | QA | All pass |
| 09:30 | Task CRUD unit | `npm test -- tests/unit/task-crud.test.js` | Backend | All new tests pass |
| 10:30 | Agent assignment unit | `npm test -- tests/unit/agent-assignment.test.js` | Backend | All new tests pass |
| 11:30 | Task dependencies unit | `npm test -- tests/unit/task-dependencies.test.js` | Backend | All new tests pass |
| 14:00 | Hermes sync unit | `npm test -- tests/unit/hermes-sync.test.js` | Hermes Int. | Dispatch + reconciliation |
| 15:00 | Integration: Task API | `npx playwright test tests/e2e/task-api.test.js` | QA | CRUD via API |
| 16:00 | **Day 4 Report** | Update roadmap | Main Agent | Markdown report |

---

### Day 5 — 2026-11-24 (Monday) — Phase 5: Task Management (Part 2)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Unit regression | `npm test` | QA | All pass |
| 09:30 | Collaboration unit | `npm test -- tests/unit/collaboration.test.js` | Backend | Subagents, parent/child |
| 10:30 | Deliverables unit | `npm test -- tests/unit/deliverables.test.js` | Backend | Versioning, approval gate |
| 11:30 | Activity timeline unit | `npm test -- tests/unit/activity.test.js` | Backend | Chronological feed |
| 14:00 | Frontend: Tasks page E2E | `npx playwright test tests/e2e/task-e2e.test.js --grep "Tasks page"` | Frontend | Kanban, drag-drop, deps |
| 15:00 | Frontend: Agents page E2E | `npx playwright test tests/e2e/task-e2e.test.js --grep "Agents page"` | Frontend | Live status, follow |
| 16:00 | E2E: Full task lifecycle | `npx playwright test tests/e2e/task-lifecycle-e2e.test.js` | QA | Task → Hermes → Complete |
| 17:00 | PR #4 creation | `gh pr create` | Main Agent | PR with test evidence |
| 17:30 | **Day 5 Report** | Update roadmap | Main Agent | Markdown report |

**Day 5 Gate:** PR #4 approved by Director → Phase 5 complete

---

### Day 6 — 2026-11-25 (Tuesday) — Phase 6: Security & Reliability (Part 1)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Unit regression | `npm test` | QA | All pass |
| 09:30 | Security audit (automated) | `npm audit --audit-level=high` + `npx audit-ci` | Security | 0 critical/high |
| 10:30 | Manual security review | OWASP Top 10 checklist | Security | Signed checklist |
| 11:30 | Dependency scan | `npx depcheck` + `npm outdated` | Security | Report |
| 14:00 | Backup script test | `npm run backup && npm run restore:test` | DevOps | Restore verified |
| 15:00 | Migration up/down test | `npm run migrate && npm run migrate:down` | DevOps | Clean revert |
| 16:00 | **Day 6 Report** | Update roadmap | Main Agent | Markdown report |

---

### Day 7 — 2026-11-26 (Wednesday) — Phase 6: Security & Reliability (Part 2)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Unit regression | `npm test` | QA | All pass |
| 09:30 | Hermes retry/circuit breaker | `npm test -- tests/unit/hermes-retry.test.js` | Hermes Int. | Exponential backoff, stop on 4xx |
| 10:30 | WebSocket stability | Load test: 100 WS × 10min | Backend | No leaks, < 50ms latency |
| 11:30 | Logging verification | Check `/var/log/bangron/*.log` | DevOps | JSON, rotation, correlation ID |
| 14:00 | Monitoring endpoints | `curl /healthz /readyz /metrics` | DevOps | All 200, Prometheus format |
| 15:00 | Performance test (k6) | `k6 run load-test.js` | QA | p95 < 200ms, 100 VUs |
| 16:00 | Production config validation | `npm run config:validate` | Security | All required env, headers |
| 17:00 | PR #5 creation | `gh pr create` | Main Agent | PR with audit report |
| 17:30 | **Day 7 Report** | Update roadmap | Main Agent | Markdown report |

**Day 7 Gate:** PR #5 approved by Director → Phase 6 complete

---

### Day 8 — 2026-11-27 (Thursday) — Phase 7: Deployment Rehearsal (Part 1)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Staging setup | `./scripts/setup-staging.sh` | DevOps | Fresh VM, DB seeded, Hermes tunnel |
| 10:00 | Deployment rehearsal | `./scripts/deploy.sh staging` | DevOps | Zero-downtime, rollback < 30s |
| 11:00 | Smoke tests on staging | `npx playwright test --project=staging --grep "smoke"` | QA | Critical paths work |
| 14:00 | Migration validation | `npm run migrate` on staging | DevOps | Clean apply, no data loss |
| 15:00 | Integration tests (staging) | `npx playwright test tests/e2e/integration-e2e.test.js` | QA | All user flows |
| 17:00 | **Day 8 Report** | Update roadmap | Main Agent | Markdown report + staging URL |

---

### Day 9 — 2026-11-28 (Friday) — Phase 7: Deployment Rehearsal (Part 2)
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Full E2E suite (staging) | `npx playwright test --project=staging` | QA | 100% pass, screenshots |
| 11:00 | Hermes live integration | `npx playwright test tests/e2e/hermes-live-e2e.test.js` | Hermes Int. | Real dispatch → execution → UI |
| 13:00 | Security regression (staging) | `npx playwright test tests/e2e/security-e2e.test.js` | Security | No auth/RBAC/approval regressions |
| 14:30 | Load test (staging) | `k6 run load-test-staging.js` | QA | Meets SLAs under load |
| 15:30 | Director acceptance walkthrough | Manual on staging URL | Director + Main | Sign-off checklist |
| 16:30 | PR #6 creation | `gh pr create` | Main Agent | PR with staging evidence |
| 17:00 | **Day 9 Report** | Update roadmap | Main Agent | Markdown report |

**Day 9 Gate:** Director signs off staging → Phase 7 complete

---

### Day 10 — 2026-12-01 (Monday) — Final Release
| Time (WIB) | Test Suite | Command | Owner | Evidence Required |
|------------|------------|---------|-------|-------------------|
| 09:00 | Full regression (unit) | `npm test` | QA | 100% pass on RC commit |
| 09:30 | Full regression (E2E) | `npx playwright test` | QA | 100% pass on RC commit |
| 10:30 | Final security review | Secrets rotated, headers, audit log | Security | Signed checklist |
| 11:30 | Documentation review | `docs/` completeness check | All | All public APIs documented |
| 13:00 | Release candidate tag | `git tag v1.0.0-rc.1 && git push --tags` | Main Agent | CI passes on tag |
| 13:30 | PR merge (Director approval) | `gh pr merge` for PRs #1–#6 | Director | All merged to main |
| 14:30 | Production deploy | `./scripts/deploy.sh production` | DevOps + Director | Authorized, health checks pass |
| 15:00 | Post-deploy verification | `npx playwright test --project=production --grep "smoke"` | QA | Critical paths work |
| 15:30 | Monitoring confirmation | Alerts firing, logs flowing | DevOps | Grafana/Prometheus dashboards |
| 16:00 | Retrospective | `docs/RETROSPECTIVE.md` | Main Agent | Lessons learned |
| 16:30 | **Final Report** | Project closure | Main Agent | Complete status matrix |

**Day 10 Gate:** Production verified → **PROJECT COMPLETE**

---

## Test Evidence Requirements

### For Every Test Run
| Artifact | Format | Location | Required For |
|----------|--------|----------|--------------|
| Test output | Text/JSON | CI logs / `test-results/` | All runs |
| Pass/fail summary | Markdown | PR comment / daily report | All runs |
| Screenshots (E2E failures) | PNG | `tests/e2e/screenshots/` | E2E failures |
| Playwright trace | `.zip` | `playwright-report/` | E2E failures |
| Coverage report | HTML/LCOV | `coverage/` | Unit runs |
| Load test metrics | JSON | `load-test-results/` | Performance runs |
| Security scan output | JSON | `security-audit-*.json` | Security runs |

### Evidence Naming Convention
```
test-results/
  unit-YYYYMMDD-HHMMSS.xml
  e2e-YYYYMMDD-HHMMSS.json
  integration-YYYYMMDD-HHMMSS.json
  load-YYYYMMDD-HHMMSS.json
  security-YYYYMMDD-HHMMSS.json

playwright-report/
  index.html (latest)
  YYYYMMDD-HHMMSS/ (archived)

tests/e2e/screenshots/
  test-name-YYYYMMDD-HHMMSS.png
```

---

## CI/CD Automation

### GitHub Actions Triggers (actual workflow, PR #2)

All jobs run on **GitHub-hosted `ubuntu-latest` runners** — never on the homelab. The homelab is reserved for application runtime and live Hermes integration verification.

```yaml
# .github/workflows/ci.yml (PR #2, chore/github-actions-ci)
on:
  pull_request:
    branches: [main, fix/security-hardening]
  push:
    branches: [main, fix/security-hardening, 'feat/**', 'fix/**', 'chore/**']
  workflow_dispatch:
```

(Original planning snippet with a daily cron schedule superseded — the implemented workflow has no scheduled trigger.)

### Required Status Checks (Branch Protection — recommended, NOT yet applied)

Exact job names from the PR #2 workflow (verified green in run 44670861607 at `5d56112`):
- `Unit & Integration Tests` — 98 passed / 0 failed / 0 skipped
- `CSS Build` — bundle generated successfully
- `Playwright E2E` — 10 passed / 0 failed / 0 skipped
- `Security & Dependency Audit` — 0 critical/high (2 moderate baseline, non-blocking)

Applying these as required checks needs Director approval; no branch protection has been changed. (Original planning names `unit-tests`/`css-build`/`e2e-tests`/`security-scan`/`integration-tests` superseded.)

---

## Manual Test Triggers

### Developer Workstation
```bash
# Quick unit test (watch mode)
npm run test:watch

# Single E2E test (headed for debugging)
npx playwright test tests/e2e/office-e2e.test.js --grep "director login" --headed

# Full local CI simulation
npm test && npm run build:css && npx playwright test
```

### Staging Environment
```bash
# Deploy to staging
./scripts/deploy.sh staging

# Run staging test suite
STAGING_URL=https://staging.bangron.my.id npx playwright test --project=staging

# Hermes live test against staging
HERMES_URL=https://hermes-staging.bangron.my.id npx playwright test tests/e2e/hermes-live-e2e.test.js
```

---

## Schedule Adjustment Protocol

### When Tests Fail
1. **Stop** — Do not proceed to next scheduled test
2. **Diagnose** — Owner investigates within 30 min
3. **Fix** — Commit fix, rerun failed suite
4. **Revalidate** — Run full regression if fix touches shared code
5. **Document** — Update daily report with root cause

### When Schedule Slips
| Delay | Action |
|-------|--------|
| < 2 hours | Absorb in buffer; report in daily |
| 2–4 hours | Reprioritize next day; drop nice-to-have tests |
| > 4 hours | **Escalate to Director** — revise roadmap, add resources |

### When New Requirements Emerge
- **Director approval required** for any scope change
- New work → new task in Kanban → new PR
- Does not block current phase unless explicitly prioritized

---

## Status Tracking

### Test Execution Dashboard (Daily Update)
| Suite | Day 1 | Day 2 | Day 3 | Day 4 | Day 5 | Day 6 | Day 7 | Day 8 | Day 9 | Day 10 |
|-------|-------|-------|-------|-------|-------|-------|-------|-------|-------|--------|
| Unit | ✅ | 🎯 | 🎯 | 🎯 | 🎯 | 🎯 | 🎯 | 🎯 | 🎯 | 🎯 |
| CSS Build | ✅ | | | | | | | | | 🎯 |
| Watchdog | ✅ | | | | | | | | | |
| Phase 3 Int | ✅ | | | | | | | | | |
| E2E Phase 3.1 | ✅ | | | | | | | | | 🎯 |
| E2E Phase 3.2 | ✅ | | | | | | | | | 🎯 |
| Approval Unit | | 🎯 | 🎯 | | | | | | | |
| RBAC Unit | | 🎯 | | | | | | | | |
| Audit Unit | | 🎯 | | | | | | | | |
| Security Unit | | 🎯 | | | | | | 🎯 | | 🎯 |
| Approval E2E | | | 🎯 | | | | | | | 🎯 |
| Task Unit | | | | 🎯 | 🎯 | | | | | |
| Hermes Sync Unit | | | | 🎯 | | | | | | |
| Task E2E | | | | | 🎯 | | | | | 🎯 |
| Backup/Restore | | | | | | 🎯 | | | | |
| Migration | | | | | | 🎯 | | 🎯 | | |
| Hermes Retry | | | | | | | 🎯 | | | |
| WS Stability | | | | | | | 🎯 | | | |
| Logging/Monitoring | | | | | | | 🎯 | | | |
| Performance | | | | | | | 🎯 | | 🎯 | |
| Config Validation | | | | | | | 🎯 | | | 🎯 |
| Staging Deploy | | | | | | | | 🎯 | | |
| Staging E2E | | | | | | | | 🎯 | 🎯 | |
| Hermes Live | | | | | | | | | 🎯 | |
| Security Regress | | | | | | | | | 🎯 | 🎯 |
| Acceptance | | | | | | | | | 🎯 | |
| Production Deploy | | | | | | | | | | 🎯 |
| Post-Deploy Verify | | | | | | | | | | 🎯 |

**Day 1 column:** executed 2026-11-20 at `22d66b6` — 98 unit/integration (incl. watchdog + Phase 3 integration subsets), 10 E2E (5 smoke + 5 lifecycle), CSS build success; CI re-verified at `5d56112` (run 44670861607).

**Legend:** 🎯 = Scheduled | ✅ = Passed | ❌ = Failed | ⏭️ = Skipped | ⏳ = Pending

---

## Communication Plan

### Daily Standup (Async via PR Comments)
- **Time:** 17:00 WIB daily
- **Format:** Main Agent posts daily report as PR comment on relevant PR
- **Recipients:** All specialists + Director

### Blocker Escalation
- **Slack/Teams:** `#bangron-virtual-office-alerts`
- **Response SLA:** 30 min during working hours (09:00–18:00 WIB)
- **After hours:** Next business day 09:00 WIB

### Director Checkpoints
| Checkpoint | When | Format |
|------------|------|--------|
| Schedule Review | Day 0 (now) | This document + roadmap |
| Phase 3.2 Gate | Day 1 EOD | PR #1 + test evidence |
| Phase 4 Gate | Day 3 EOD | PR #3 + test evidence |
| Phase 5 Gate | Day 5 EOD | PR #4 + test evidence |
| Phase 6 Gate | Day 7 EOD | PR #5 + audit report |
| Phase 7 Gate | Day 9 EOD | PR #6 + staging sign-off |
| Release Gate | Day 10 13:30 | All PRs merged + deploy auth |

---

**Document Version:** 1.2
**Owner:** Main Agent (PM/QA Coordinator)
**Review:** Daily at 17:00 WIB
**Next Update:** Day 2 (2026-11-21) — Phase 4 start requires Director approval of PR #1 merge