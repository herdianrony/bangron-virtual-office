# G6.4 — Hermes Runtime Verification Plan (Preparation Only)

**Repository:** `herdianrony/bangron-virtual-office`
**Branch:** `fix/g6-hermes-eventbridge`
**PR:** #3 — OPEN and DRAFT (do not merge or approve)
**Gate G6:** OPEN (do not close)
**HERMES_RUNTIME_VERIFIED:** `false` (do not set to `true`)
**Status:** PREPARATION ONLY — No real Hermes task dispatch

---

## Purpose

This document defines a production-safe, non-destructive verification procedure for the real Hermes runtime integration between Hermes Agent runtime, the Bangron Virtual Office EventBridge, and the frontend UI.

**This is a test plan only. Executing the plan requires explicit Director approval.** No `.env`, secrets, production database, service, or CSP change is made by this document.

---

## 1. Architecture and Event-Flow Evidence

### 1.1 System Components

| Component | File | Role |
|-----------|------|------|
| Hermes Adapter | `src/integrations/hermes/adapter.js` | HTTP client to Hermes API Server: dispatch task (`POST /v1/runs`), get run status (`GET /v1/runs/{id}`), stop run (`POST /v1/runs/{id}/stop`), runtime health (`GET /v1/models`). SSE polling via EventBridge. |
| EventBridge | `src/integrations/hermes/event-bridge.js` | SSE polling loop on `GET /v1/runs/{runId}/events`. Incremental SSE parser, Last-Event-ID reconnect, bounded backoff, terminal-event detection, run-to-task mapping. |
| State Reconciler | `src/integrations/hermes/state-reconciler.js` | Persists events (idempotent via `event_id`), resolves agent/task identity, updates agent instance + task status, publishes to WebSocket. |
| Event Normalizer | `src/integrations/hermes/event-normalizer.js` | Maps Hermes hook/SSE event names to Bangron internal event types (`agent.execution.started`, `agent.tool.completed`, `run.completed`, etc.). |
| Signature Validator | `src/integrations/hermes/signature-validator.js` | HMAC-SHA256 over raw request body, replay protection via `delivery_id`/`event_id` + signed-body timestamp drift ≤ 300s. |
| Webhook Controller | `src/integrations/hermes/webhook-controller.js` | `POST /api/integrations/hermes/events` — validates signature, normalizes, reconciles. `POST /api/integrations/hermes/agents` — HMAC-protected agent registration. `GET /api/integrations/hermes/status` — Director-only runtime status. |
| Startup Recovery | `src/integrations/hermes/startup-recovery.js` | On server restart, queries non-terminal tasks with `hermes_run_id`, rebuilds run-to-task mappings, resumes SSE polling. |
| WebSocket Server | `src/realtime/websocket-server.js` | Broadcasts reconciled events to connected Virtual Office UI clients. |
| Event Publisher | `src/realtime/event-publisher.js` | Publishes `agent.status.updated`, `task.status.updated`, `approval.updated`, `runtime.status.changed` to WS clients. |
| Task Service | `src/modules/tasks/task.service.js` | Creates tasks, assigns agents, dispatches to Hermes via `hermesAdapter.dispatchTaskInstruction()`, stores `hermes_run_id`, starts EventBridge polling. |

### 1.2 Complete Event Path

```
Hermes Runtime (agent executes task)
        │
        ▼
Hermes API Server (SSE stream: GET /v1/runs/{runId}/events)
        │  text/event-stream, Authorization: Bearer <apiKey>
        ▼
Bangron EventBridge (incremental SSE parser, Last-Event-ID)
        │  runId → taskId mapping (runTaskMap)
        ▼
State Reconciler (idempotent event persist, agent/task identity resolution)
        │  SQLite: event_repository, agent_instances, agent_tasks, agent_activities
        ▼
Event Publisher (WebSocket broadcast)
        │  agent.status.updated, task.status.updated, approval.updated
        ▼
Virtual Office UI (browser WS client renders agent status, task progress)
```

### 1.3 Authentication & Authorization

| Endpoint | Method | Auth | Signature |
|----------|--------|------|-----------|
| `/api/integrations/hermes/events` | POST | CSRF-exempt (webhook) | HMAC-SHA256 over raw body (`HERMES_WEBHOOK_SECRET`) |
| `/api/integrations/hermes/agents` | POST | CSRF-exempt (webhook) | HMAC-SHA256 over raw body |
| `/api/integrations/hermes/status` | GET | Session auth + Director role | None |
| `/api/integrations/hermes/...` (runtime dispatch) | — | Session auth (TaskService) | `HERMES_API_KEY` as Bearer to Hermes API |

### 1.4 Hermes Adapter Configuration

| Config | Env Var | Default | Safety Note |
|--------|---------|---------|-------------|
| `apiUrl` | `HERMES_API_URL` | `''` | Empty = no runtime configured |
| `apiKey` | `HERMES_API_KEY` | `***` | Bearer token for Hermes API |
| `webhookSecret` | `HERMES_WEBHOOK_SECRET` | `''` | HMAC secret for webhook validation |
| `runtimeVerified` | `HERMES_RUNTIME_VERIFIED` | `false` | **Gate: dispatch blocked when `false`** |

**Critical:** `dispatchTaskInstruction()` returns `{ dispatched: false, reason: 'HERMES_RUNTIME_UNVERIFIED' }` when `runtimeVerified` is not `'true'`. This is the primary runtime dispatch guard.

---

## 2. Prerequisites and Connectivity Checks

### 2.1 Environment Prerequisites (Read-Only Inspection)

| Check | Command / Method | Expected |
|-------|------------------|----------|
| Hermes API URL configured | `grep HERMES_API_URL .env` | Non-empty URL |
| Hermes API key configured | `grep HERMES_API_KEY .env` | Non-empty value |
| Webhook secret configured | `grep HERMES_WEBHOOK_SECRET .env` | Non-empty value |
| Runtime verified flag | `grep HERMES_RUNTIME_VERIFIED .env` | Must be `false` (gate closed) |
| Node.js version | `node --version` | v26.13.1 (matches CI) |
| Repository branch | `git branch --show-current` | `fix/g6-hermes-eventbridge` |
| Working tree clean | `git status --short` | Empty (no uncommitted changes) |

### 2.2 Connectivity Checks (No State Change)

| Check | Method | Risk |
|-------|--------|------|
| Hermes API reachable | `curl -I <HERMES_API_URL>/v1/models` with Bearer auth | Read-only GET; returns 200/401/404 |
| SSE endpoint contract | `curl -N <HERMES_API_URL>/v1/runs/{testRunId}/events` with timeout | Read-only stream; abort after first event |
| WebSocket server local | `ws://localhost:3002/ws` | Local only; no production traffic |
| SQLite DB accessible | Local dev DB only | Read-only queries; no writes |

**None of these checks modify production state.**

### 2.3 Test Database Provisioning

The E2E test suite uses an isolated SQLite database provisioned via `tests/e2e/prepare-db.js`. The dev DB at `storage/database/bangron-virtual-office.sqlite` is untouched by E2E tests.

---

## 3. Proposed Test Task and Restrictions

### 3.1 Test Task Parameters (Read-Only Plan — Not Dispatched)

| Field | Value | Restriction |
|-------|-------|-------------|
| Task title | `G6.4 Runtime Verification — Read-Only Probe` | Non-destructive, no side effects |
| Instruction | `Report your current system status and available tools. Do not modify any files, databases, or external services.` | Explicitly read-only |
| Agent profile | `hermes-orchestrator` (profile slug) | Must exist in seeded `agent_profiles` |
| Timeout | 60 seconds | Hard abort; Hermes `stopRun(runId)` if still running |
| Idempotency key | `bangron-task-g6-4-probe-<timestamp>` | Prevents duplicate dispatch |
| Metadata | `bangron_task_id: g6-4-probe`, `agent_profile: hermes-orchestrator`, `verification: G6.4` | Traceability |

### 3.2 Tool Restrictions for the Test Task

The instruction must explicitly prohibit:
- File system writes outside `/tmp`
- Database modifications (SQLite, Postgres, etc.)
- Network calls to external endpoints
- Shell command execution beyond `whoami`, `uptime`, `env` (read-only)
- Hermes sub-task spawning (single-turn response only)

### 3.3 Why This Task Is Safe

- No production data is read or written.
- The agent is instructed to only report status, not act.
- Hard timeout prevents runaway execution.
- `stopRun(runId)` available as emergency abort.
- Dispatch is blocked entirely by `HERMES_RUNTIME_VERIFIED === false` until Director approval flips it.

---

## 4. Expected Event Sequence

When a real Hermes task runs, the following event sequence is expected:

| Step | Source | Event Type | Bangron Normalized | DB Effect | WS Broadcast |
|------|--------|------------|-------------------|-----------|--------------|
| 1 | Task Service | `task.created` | `task.created` | `agent_tasks` row inserted | `task.status.updated` |
| 2 | Task Service | `task.assigned` | `task.assigned` | `agent_tasks` assigned + `hermes_run_id` set | `task.status.updated` |
| 3 | Task Service | Hermes dispatch | `POST /v1/runs` → `run_id` | `hermes_run_id` persisted | — |
| 4 | EventBridge | SSE `run.started` (if sent) | `agent.execution.started` | Agent instance → `working` | `agent.status.updated` |
| 5 | EventBridge | SSE `message.delta` | `agent.execution.step` | `agent_activities` row | — |
| 6 | EventBridge | SSE `agent:start` / `on_session_start` | `agent.execution.started` | — | `agent.status.updated` |
| 7 | EventBridge | SSE `pre_tool_call` | `agent.tool.started` | Policy engine eval (approval gate) | `approval.updated` if required |
| 8 | EventBridge | SSE `post_tool_call` | `agent.tool.completed` | Agent stays `working` | `agent.status.updated` |
| 9 | EventBridge | SSE `run.completed` | `agent.execution.ended` | Task → `completed`, Agent → `completed`→`idle` | `task.status.updated`, `agent.status.updated` |
| 10 | EventBridge | Terminal → stop polling | — | `runTaskMap` deleted | — |

**Terminal events:** `run.completed`, `run.failed`, `run.cancelled` stop SSE polling and clean up `runTaskMap`.

---

## 5. Database and WebSocket Verification Points

### 5.1 Database Verification Points (Local Dev DB — Read-Only Queries)

| Table | Query | What to Verify |
|-------|-------|----------------|
| `agent_tasks` | `SELECT id, status, hermes_run_id FROM agent_tasks WHERE id = ?` | `hermes_run_id` set after dispatch; status transitions `pending` → `running` → `completed/failed/cancelled` |
| `agent_instances` | `SELECT id, status, profile_name FROM agent_instances WHERE id = ?` | Status `queued` → `working` → `completed`/`failed`/`idle` |
| `agent_activities` | `SELECT * FROM agent_activities WHERE task_id = ? ORDER BY occurred_at` | Activity chain matches event sequence (tool.started, tool.completed, execution.ended) |
| `event_repository` | `SELECT * FROM event_repository WHERE event_id = ?` | Idempotent dedupe: duplicate `event_id` → `ignored` status |
| `agent_sessions` | `SELECT * FROM agent_sessions WHERE session_id = ?` | Session auto-registered on first Hermes event |

### 5.2 WebSocket Verification Points

| WS Message Type | Expected Payload Fields | Verification |
|-----------------|------------------------|--------------|
| `agent.status.updated` | `agent_instance_id`, `status`, `reason?` | Matches DB `agent_instances.status` |
| `task.status.updated` | Full task object incl. `status`, `hermes_run_id` | Matches DB `agent_tasks.status` |
| `approval.updated` | `approval_request` with `requiresApproval: true` | Only for high-risk tools (policy engine) |
| `runtime.status.changed` | `connected`, `reason` | Published by health watchdog on state change |

### 5.3 Frontend UI Verification Points

| UI Element | Expected Behavior |
|------------|-------------------|
| Agent avatar halo | Reflects `agent_instances.status` (working/completed/failed/idle) |
| Task list | Task status updates in real-time via WS |
| Approval dialog | Appears when `agent.approval.requested` received; agent shows `waiting` |
| Runtime offline badge | Shows when `runtime.status.changed` → `connected: false` |
| Console errors | No `ReferenceError`, no CSP violations, no SVG `undefined` attributes |

---

## 6. Failure and Recovery Scenarios

| Scenario | Detection | Recovery Mechanism | Verification |
|----------|-----------|-------------------|--------------|
| Hermes API unreachable | `fetch` throws / non-2xx on `/v1/runs` | EventBridge backoff (1s → 2s → 4s → 8s → 16s, max 30s); 5 consecutive errors stop polling | Health watchdog publishes `runtime.status.changed: false` |
| SSE stream mid-connection drop | `reader.read()` abort / network error | Reconnect with `Last-Event-ID` from last successfully processed event | `lastEventId`/`lastSeq` not advanced on failed reconciliation |
| Reconciliation failure (DB error) | `_reconcileEvent` throws | Return `'reconnect'`; `lastEventId`/`lastSeq` NOT advanced; bounded backoff; max 5 failures then stop | Event remains unprocessed; retry from checkpoint on reconnect |
| Duplicate event delivery | `eventRepo.recordEvent` returns `isDuplicate` | Return `'ignored'` with `DUPLICATE_EVENT`; controller answers 409 | No double-processing of agent/task state |
| Terminal event missed | Stream ends without `run.completed` | Finite batch: re-poll after `pollInterval` (5s default) | Next poll cycle picks up new events |
| Server restart mid-run | `recoverActiveHermesRuns()` on startup | Queries non-terminal tasks with `hermes_run_id`; rebuilds mappings; resumes polling | `runTaskMap` restored; SSE polling resumes |
| Agent instance unknown | `agentRepo.getInstanceById` returns null | Event recorded but no agent state updated; warning logged | No FK constraint failure; event not lost |
| Task unknown | `taskRepo.getTaskById` returns null | Task-related updates skipped; warning logged | Event recorded, task state unchanged |
| WebSocket disconnect | Client WS closes | Client reconnects; server `connectionManager` handles | UI re-subscribes to status updates |
| Cancellation requested | Director calls `cancelTask(taskId)` | Task → `cancelled`; agent → `idle`; Hermes `stopRun(runId)` if run active | Task status `cancelled`; no further events processed |

---

## 7. Stop / Rollback Procedure (No Production DB Changes)

### 7.1 Immediate Stop (During Test Execution)

1. **Abort SSE polling:** `hermesEventBridge.stopPolling(runId)` — aborts `AbortController`, releases SSE reader lock.
2. **Stop Hermes run:** `hermesAdapter.stopRun(runId)` — `POST /v1/runs/{runId}/stop` to Hermes API.
3. **Cancel task:** `taskService.cancelTask(taskId, 'G6.4 verification aborted')` — sets task status `cancelled`, agent `idle`.
4. **Stop all polling:** `hermesEventBridge.stopAll()` — aborts all active polls, clears `runTaskMap` (production restart scenario only).

### 7.2 Rollback (No DB Modification)

- **No database rollback needed:** The plan uses read-only connectivity checks. If a real task is ever dispatched (post-approval), all changes are append-only (new rows, status transitions) and reversible via `cancelTask` / `retryTask`.
- **No `.env` changes:** `HERMES_RUNTIME_VERIFIED` remains `false`; dispatch is blocked by code guard.
- **No service restart:** Process continues running; only polling is stopped/aborted.

### 7.3 Emergency Contacts

| Role | Action |
|------|--------|
| Director | Approve/abort verification execution |
| DevOps | Hermes API server status, `stopRun` if needed |
| Backend Lead | Reconciler/EventBridge code review |

---

## 8. Evidence Checklist

To claim **genuine Hermes runtime verification**, ALL of the following must be present:

| # | Evidence | Source | Simulated vs Real |
|---|----------|--------|-------------------|
| 1 | `HERMES_RUNTIME_VERIFIED=true` in `.env` | Config file | Real (cannot be simulated by code) |
| 2 | Dispatch response `{ dispatched: true, runId: '...' }` | `hermesAdapter.dispatchTaskInstruction()` | Real (HTTP 201 from Hermes API) |
| 3 | `hermes_run_id` persisted in `agent_tasks` | SQLite query | Real (DB write) |
| 4 | SSE events received from Hermes API | EventBridge logs (`Starting SSE event polling for run`) | Real (HTTP stream from Hermes) |
| 5 | Agent status transitions in `agent_instances` | SQLite query | Real (reconciler DB writes) |
| 6 | Task status transitions in `agent_tasks` | SQLite query | Real (reconciler DB writes) |
| 7 | WS messages received by browser | Playwright `page.on('websocket')` or console logs | Real (browser WS client) |
| 8 | Agent avatar reflects backend status in UI | Screenshot / Playwright locator | Real (frontend renders WS data) |
| 9 | No console errors (CSP, ReferenceError, SVG undefined) | Browser console capture | Real (frontend runtime) |
| 10 | `runtime.status.changed` published on health check | WS message / server logs | Real (watchdog tick) |

**Items 1–3 require Director approval.** Items 4–10 require items 1–3 to be true first.

**Not acceptable as evidence:**
- Signed test webhooks to `/api/integrations/hermes/events` (simulated, not runtime)
- Demo engine events (`demoEngine.start()`)
- Unit test mocks
- Local-only SSE simulation

---

## 9. Approval Checkpoint

### 9.1 What Requires Director Approval

| Action | Why | Approver |
|--------|-----|----------|
| Set `HERMES_RUNTIME_VERIFIED=true` in `.env` | Unblocks `dispatchTaskInstruction()` | Director |
| Dispatch real Hermes task via `taskService.assignAgent()` → `hermesAdapter.dispatchTaskInstruction()` | Sends real instruction to Hermes runtime | Director |
| Access production Hermes API URL and API key | Credentials required for dispatch | Director |
| Modify production database (if any correction needed) | Data integrity | Director |
| Close Gate G6 / set `HERMES_RUNTIME_VERIFIED=true` | Runtime verification claim | Director |

### 9.2 What Does NOT Require Approval (Already Done)

- Code fixes for `dt`, SVG attributes, CSP investigation, furniture hit-test rendering
- Unit tests (242 passing) and E2E tests (22 passing)
- Documentation and test plan (this document)
- Local development server verification

### 9.3 Pre-Execution Checklist (Director to Confirm)

- [ ] `HERMES_API_URL` points to intended Hermes API Server (not production if testing)
- [ ] `HERMES_API_KEY` is configured and valid
- [ ] `HERMES_WEBHOOK_SECRET` is configured for webhook validation
- [ ] Test agent profile `hermes-orchestrator` exists in seeded database
- [ ] 60-second timeout is acceptable for the test task
- [ ] `stopRun(runId)` is available as emergency abort
- [ ] No production database writes expected from read-only task instruction
- [ ] Verification window scheduled (date/time)
- [ ] Rollback contacts (DevOps, Backend Lead) available

### 9.4 Post-Execution (If Approved and Run)

- [ ] Capture all 10 evidence items above
- [ ] Document actual event sequence observed
- [ ] Record any deviations from expected sequence
- [ ] Capture screenshots of UI agent status reflecting backend
- [ ] Capture browser console (no errors)
- [ ] Stop polling and cancel task after verification
- [ ] **Do NOT** set `HERMES_RUNTIME_VERIFIED=true` permanently without separate approval
- [ ] **Do NOT** close Gate G6 without separate approval
- [ ] **Do NOT** merge or approve PR #3

---

## 10. Remaining Risks and Unresolved Issues

| Risk | Impact | Mitigation |
|------|--------|------------|
| CSP violation from PixiJS blob workers | Browser console error on production | Do not weaken CSP; fix requires `worker-src 'self' blob:` or PixiJS worker refactor (security review needed) |
| Last-Event-ID honor by Hermes API unverified | Possible duplicate events on reconnect | EventRepository idempotency prevents double-processing |
| `HERMES_RUNTIME_VERIFIED=false` blocks dispatch | Cannot test real runtime without config change | Director approval required to flip flag |
| Local dev session cookie not set | Cannot log in via browser locally | E2E tests use separate test DB; production unaffected |
| No production browser access | Cannot verify CSP violation in production | Documented as unverified hypothesis |
| PixiJS `new Function()` calls | Covered by `'unsafe-eval'` in CSP | No action needed |

---

## 11. Deliverables Summary

| Deliverable | Location | Status |
|-------------|----------|--------|
| G6.4 Verification Plan | `docs/G6_4_HERMES_RUNTIME_VERIFICATION_PLAN.md` | Created |
| Event-flow documentation | Section 1.2 | Documented |
| Prerequisites & connectivity checks | Section 2 | Documented |
| Proposed test task & restrictions | Section 3 | Documented (not dispatched) |
| Expected event sequence | Section 4 | Documented |
| DB & WS verification points | Section 5 | Documented |
| Failure & recovery scenarios | Section 6 | Documented |
| Stop/rollback procedure | Section 7 | Documented |
| Evidence checklist | Section 8 | Documented |
| Approval checkpoint | Section 9 | Documented |

---

## 12. Exact Action Requiring Director Approval

**Flip `HERMES_RUNTIME_VERIFIED` to `true` in `.env`, then dispatch one read-only Hermes test task (G6.4 probe) with a 60-second timeout, verify all 10 evidence items, then stop the task and revert the flag (or keep it true with separate approval for Gate G6 closure).**

Until this approval is granted:
- PR #3 remains OPEN and DRAFT.
- Gate G6 remains OPEN.
- `HERMES_RUNTIME_VERIFIED` remains `false`.
- No real Hermes task is dispatched.
- No claim of production runtime verification is made.
