# Control Plane — Final Hardening Summary (2026-11-27)

Branch: `fix/realtime-g6-apply` — HEAD `54f7b04` (pushed, working tree clean).

## 1. Realtime agents page — VERIFIED

`AgentsView` now subscribes to the store (`agent_updated`, `agents_loaded`,
`state_updated`, `runtime_status_changed`) with a 150 ms debounce and reloads
cards from the API. `destroy()` removes the subscription.

Live browser proof: after dispatching a task from the page itself, store and
card changed `idle → queued` within 0 s **without reload**.

## 2. Root cause fixed — SSE event id collision

Hermes SSE `seq` restarts at 0 for every run. It was used verbatim as
`event_id`, so events from later runs were treated as duplicates by
`EventRepository` (UNIQUE) — no state transitions, no WS events, no card update.

Fix: `eventId = ${run_id}:${seq|id}` for SSE events. Explicit webhook
`event_id` / `delivery_id` are untouched. Regression test:
`tests/unit/sse-event-id-namespace.test.js`.

Live proof: run `run_fae6df25...` → 12 events with ids
`run_fae6df25:0` … `:11`, task `completed`, agent `idle`.

## 3. Agent identity carried by run mapping

`HermesEventBridge.registerRunAgentMapping(runId, agentInstanceId)` and
`task.service` register the dispatch target. SSE events (which carry no agent
identity) receive `instance_id` from this map, with explicit event identity
always winning. Tests: `tests/unit/g6-run-agent-mapping.test.js`.

## 4. Hermes profile roster sync — 10 profiles provisioned

Source of truth: `~/.hermes/profiles/<name>/` (API Server has no `/v1/agents`
or `/v1/profiles`; `/p/<profile>/` returns `profile_unknown` because
`profile_routes: []`). `HermesProfileSync` provisions each profile via
`HermesAgentProvisioner`, broadcasts `agent.created`, and is idempotent.

- Startup sync in `server.js`
- Director endpoint `POST /api/agents/sync-hermes`
- "Sync Hermes" button in Agents view
- Tests: `tests/unit/hermes-profile-sync.test.js`

Live proof: 10 profiles (backend, devops, frontend, qa, sm-copywriter,
sm-designer, sm-scheduler, sm-strategist, tech-lead, ui-ux) → 12 agent cards
in browser (2 seeded + 10 Hermes).

## 5. Capability-driven adapter

`HermesAdapter.getCapabilities()` caches `GET /v1/capabilities` for 5 minutes;
`supports(feature)` fails closed. `GET /api/integrations/hermes/status` now
includes the capability map, so the UI no longer assumes feature support.
Test: `tests/unit/hermes-capabilities.test.js`.

## 6. Pruned empty navigation

Approvals and Deliverables hidden from mobile and desktop nav (HTML comments;
routes, API and data retained and reversible). Core loop in nav:
Office → Dashboard → Agents → Tasks → Projects → Activities → Settings.

## Verification

- `npm test`: **254 passed / 0 failed** (29 files)
- Live browser: 12 agent cards, `CONNECTED` badge, Sync button present,
  no console errors, nav shows 7 items
- Service `bangron-virtual-office.service` active
- Director password hash restored to original after all probes
