# Bangron Virtual Office — Architecture Document

## 1. System Overview

Bangron Virtual Office is architected as an event-driven operational control plane and 2.5D visual studio simulation.

```
+-----------------------------------------------------------------------------------+
|                              Director Web Client                                  |
|   (Vanilla JS ESM + SVG 2.5D Isometric Engine + WebSocket Reconnection Layer)     |
+--------------------------+----------------------------------+---------------------+
                           | HTTP / JSON REST API             | WebSocket (ws)
                           v                                  v
+-----------------------------------------------------------------------------------+
|                           Express.js Application Layer                            |
|  - Helmet HTTP Security      - Rate Limiting            - Session Auth (Director) |
|  - Role & Permission Checks  - CSRF Token Validation   - Input Sanitization & Zod |
+--------------------------+--------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------------------------------+
|                              Application Modules                                  |
|  [Director]  [Agents]  [Tasks & Subtasks]  [Projects]  [Approvals]  [Deliverables] |
|  [Virtual Office Layout]  [Audit Logs]    [Policy Engine]  [Demo Mode Engine]     |
+--------------------------+--------------------------------------------------------+
                           |
                           v
+-----------------------------------------------------------------------------------+
|                        Hermes Integration & Event Layer                           |
|  - Webhook Receiver with Raw-Body HMAC-SHA256 Signature Verification              |
|  - Normalized Event Pipeline: [Ingest] -> [Dedup] -> [Persist] -> [Reconcile]     |
|  - Outbound Adapter for Hermes Main Agent Dispatching                             |
+--------------------------+----------------------------------+---------------------+
                           |                                  |
                           v                                  v
        +-----------------------------------+   +-----------------------------------+
        |       Persistent SQLite DB        |   |         Realtime Gateway          |
        |   (better-sqlite3, WAL, FKs)      |   |   (WebSocket Broadcast Hub)       |
        +-----------------------------------+   +-----------------------------------+
```

## 2. Key Subsystems

### 2.1 Backend as the Single Source of Truth
The virtual office frontend does not authoritatively declare agent states or task completions. The backend handles state transitions through transactional updates in SQLite, and pushes normalized snapshots and diffs over WebSocket.

### 2.2 Hermes Integration Layer
- **HMAC Signature Validator:** Verifies webhook payloads against raw request bytes using `crypto.timingSafeEqual`.
- **Event Normalizer:** Maps external Hermes lifecycle hooks (`agent:start`, `agent:step`, `agent:end`, `pre_tool_call`, `post_tool_call`, `subagent:spawn`) into strictly validated internal contracts (`agent.execution.*`, `agent.tool.*`, `agent.subagent.*`).
- **Idempotent Event Store:** Deduplicates incoming event payloads using unique event IDs and timestamps.
- **State Reconciler:** Prevents premature task completions; a tool completion or session termination only updates state after all subtasks and exit codes are verified.

### 2.3 Approval Policy Engine
Actions marked as high-risk (e.g., database schema changes, production deployment, external publishing) generate pending `approval_requests`. Agent execution pauses in a `waiting_approval` state until Director grants approval via the Approval Center.

### 2.4 Visual 2.5D Isometric Engine
Rendered natively in SVG using isometric projection:
$$x_{screen} = (x_{iso} - y_{iso}) \cdot \cos(30^\circ) \cdot \text{scale}$$
$$y_{screen} = (x_{iso} + y_{iso}) \cdot \sin(30^\circ) \cdot \text{scale} - z_{iso} \cdot \text{scale}$$
Features:
- 12 fully mapped digital studio rooms.
- Waypoint-based graph navigation with workstation reservation.
- Realtime position interpolation with requestAnimationFrame.
- Camera pan/zoom and agent-following mode.
- Visual simulation speed toggle (1x, 2x, 4x) without affecting operational execution time.
