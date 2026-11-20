# Bangron Virtual Office — API Reference

All application endpoints are prefixed with `/api`. Responses adhere to a consistent JSON envelope:

```json
{
  "success": true,
  "data": {},
  "message": "Optional human-readable message",
  "meta": {}
}
```

Or on error:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error description",
    "details": []
  }
}
```

---

## 1. Authentication (`/api/auth`)

- `POST /api/auth/login`
  Body: `{ "email": "director@bangron.office", "password": "..." }`
  Response: Sets session cookie (`bvo_session`).
- `POST /api/auth/logout`
  Clears session.
- `GET /api/auth/me`
  Returns authenticated user profile.
- `GET /api/auth/csrf`
  Returns CSRF token for mutating requests.

---

## 2. Director Dashboard (`/api/director`)

- `GET /api/dashboard`
  Returns operational summary: total agents, online/offline count, working agents, task statistics (running, completed, failed), pending approvals, active projects, recent activity feed, and Hermes runtime connection health.

---

## 3. Virtual Office (`/api/virtual-office`)

- `GET /api/virtual-office/state`
  Full snapshot for virtual office initialization: rooms, workstations, current agent positions, and active task badges.
- `GET /api/virtual-office/rooms`
  List of the 12 rooms with spatial bounds and coordinates.
- `GET /api/virtual-office/agents`
  List of registered agent instances with positions, workstations, and live animation states.

---

## 4. Agent Management (`/api/agents`)

- `GET /api/agents`
  List all agent profiles & runtime instances. Filter by department, status.
- `GET /api/agents/:id`
  Detailed profile, active session, task history, and capabilities.
- `POST /api/agents`
  Register a new agent profile.
- `PATCH /api/agents/:id`
  Update profile, department, or capability permissions.
- `POST /api/agents/:id/commands`
  Send an operational instruction or pause/resume signal to the agent.

---

## 5. Task & Project Management (`/api/tasks`, `/api/projects`)

- `GET /api/tasks`
  List tasks. Supports filtering by status, priority, assigned agent, and project.
- `GET /api/tasks/:id`
  Get task details, subtasks, dependencies, deliverables, and timeline.
- `POST /api/tasks`
  Create a new task or subtask with optional prerequisite dependencies.
- `PATCH /api/tasks/:id`
  Update task metadata or priority.
- `POST /api/tasks/:id/assign`
  Assign task to an agent instance.
- `POST /api/tasks/:id/cancel`
  Cancel task execution.
- `POST /api/tasks/:id/retry`
  Retry a failed task.
- `GET /api/projects`
  List digital studio projects.
- `POST /api/projects`
  Create new project.

---

## 6. Approvals (`/api/approvals`)

- `GET /api/approvals`
  List pending and historical approval requests.
- `GET /api/approvals/:id`
  Details of a specific sensitive operation request.
- `POST /api/approvals/:id/approve`
  Director approves request; releases paused task.
- `POST /api/approvals/:id/reject`
  Director rejects request with review notes.

---

## 7. Deliverables & Activities (`/api/deliverables`, `/api/activities`)

- `GET /api/deliverables`
  List deliverables with download and preview metadata.
- `GET /api/deliverables/:id/download`
  Secure download of deliverable asset.
- `GET /api/activities`
  Chronological activity feed with pagination.

---

## 8. Hermes Integration (`/api/integrations/hermes`)

- `POST /api/integrations/hermes/events`
  Webhook ingestion. HMAC-SHA256 over the exact raw body via
  `X-Hermes-Signature-256: sha256=<hex>` (native Hermes), `x-hermes-signature`,
  or `x-hub-signature-256`. Requires a stable `delivery_id`/`event_id` and a
  timestamp inside the signed body (unix seconds/ms or ISO-8601, ±300s drift).
  Duplicate deliveries of processed events → 409. See HERMES-INTEGRATION.md §5.2.
- `POST /api/integrations/hermes/agents`
  Idempotent agent registration (HMAC-protected, max 50 per call).
- `GET /api/integrations/hermes/status`
  Health, verification status, and recent ingested events.
  **Director-only** (authenticated session + director role; 401/403 otherwise).

---

## 9. Demo Mode (`/api/demo`)

- `GET /api/demo/status`
  Check whether demo mode is active, including the auto-play director state.
- `POST /api/demo/start`
  Start isolated simulation scenario.
- `POST /api/demo/step`
  Trigger next simulated multi-agent task or activity step.
- `POST /api/demo/reset`
  Reset demo state.
- `POST /api/demo/autoplay`
  Toggle the DemoEngine auto-play director (`{ "enabled": true | false }`). When
  enabled, demo agents walk through the office according to their active tasks —
  server-computed corridor waypoint routes are broadcast over WebSocket
  (`agent.position.updated` with `path`, `move_note`, `arrive_status`) and the
  frontend walks each agent leg by leg. Workstations are reserved (`occupied`)
  on arrival and released when the agent moves elsewhere.

---

## 10. Virtual Office Positions (`/api/virtual-office`)

- `GET /api/virtual-office/state`
  Full office snapshot: rooms, workstations (with `occupied_by_agent_id`), agents, positions.
- `PATCH /api/virtual-office/positions/:agentInstanceId`
  Update an agent's room/workstation/position. Supports `path` (waypoint list),
  `moveNote`, and `arriveStatus` for corridor-aware walking.
