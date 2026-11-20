# Bangron Virtual Office

> **Tagline:** An AI-powered digital studio.  
> **Director:** Bangron  
> **Visual Style:** Realistic 2D Top-Down Virtual Office (SVG architecture + PixiJS/WebGL agent layer)  
> **Runtime Integration:** Hermes Agent (Multi-agent architecture)

Bangron Virtual Office is a standalone AI Agent Management & Virtual Office application. It serves as the operational command center where the Director can visually monitor AI agent activity, manage agent profiles, assign and supervise tasks, observe collaboration patterns, inspect deliverables, approve sensitive operations, and interact with the Hermes Agent runtime.

## Core Architectural Principles

1. **Backend is the Source of Truth:** The top-down virtual office is an exact visual projection of verified operational state from SQLite and normalized agent event streams—not an arbitrary animation loop.
2. **Deterministic Multi-Agent Coordination:** Tasks and subagent delegations are strictly tracked, with cycle-checked dependencies, execution sessions, and parent-task reconciliation.
3. **Safety & Director Authority:** High-risk actions (production deployment, destructive DB operations, external publishing) require explicit Director approval through the backend policy engine.
4. **Hermes Integration Contract:** Inbound events are accepted only when they satisfy Bangron's configured HMAC webhook contract, then deduplicated, normalized, and reconciled before state transitions occur.
5. **Isolated Demo Mode:** A fully simulated studio environment populated with at least 5 specialist agents operates in an isolated namespace (`DEMO`), ensuring production telemetry remains pristine.

---

## Technology Stack

- **Backend Runtime:** Node.js LTS (ES Modules)
- **Web Framework:** Express.js 5
- **Database:** SQLite with `better-sqlite3` (WAL mode, Foreign Keys, prepared statements)
- **Realtime Transport:** WebSocket (`ws`) with session-based authentication and reconnection recovery
- **Frontend:** Vanilla HTML5, CSS3, JavaScript ES Modules, SVG floor-plan renderer + PixiJS 8 (WebGL) agent layer
- **Security:** Helmet, express-rate-limit, express-session (SQLite store), bcryptjs, HMAC-SHA256
- **Testing:** Vitest (unit & integration tests), Playwright ready
- **Logging:** Pino

---

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Database Migration & Seeding

```bash
npm run migrate
npm run seed
```

This sets up:
- 14-room architectural office plan (corridors, library, coffee room) with a realistic top-down view, PixiJS-rendered agents, waypoint navigation, and interactive workstations.
- Initial Director account using the email and password configured in `.env`.
- Specialist agent profiles across Development, Creative, UI/UX, Research, QA, Marketing, and Operations.
- Isolated Demo workspace with active tasks and realistic activity streams.

### 4. Start the Server

```bash
npm start
```
The server will start on `http://0.0.0.0:3000`.

---

## Available Routes & Navigation

| Route | Description |
|---|---|
| `/login` | Director authentication portal |
| `/office` | Realistic 2D Top-Down Virtual Office with PixiJS agents, camera pan/zoom & agent following |
| `/dashboard` | Director operations center: metrics, active tasks, agent status, and approvals |
| `/agents` | Agent profile registry, capabilities, tool permissions, and runtime sessions |
| `/tasks` | Multi-agent task board, subtasks, dependency graph, and execution traces |
| `/projects` | Digital studio projects and milestone tracking |
| `/activities` | Realtime normalized activity log and event monitor |
| `/approvals` | Approval Center for high-risk operations |
| `/settings` | System configuration, Hermes adapter status, and Demo mode switch |

---

## Testing

```bash
npm test
```

Runs comprehensive backend tests covering database schemas, migrations, authentication, event normalization, deduplication, state reconciliation, approval policies, and API contracts.
