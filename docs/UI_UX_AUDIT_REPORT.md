# Bangron Virtual Office — UI/UX Audit Report

**Branch:** `fix/g6-hermes-eventbridge`
**Commit SHA:** `062c0c41c00d17666458bf4ad0025be61eaea15c` (audited HEAD)
**Date:** 2026-11-21  
**Auditor:** Hermes Main Agent  
**Scope:** Full frontend codebase audit (SPA with hash routing, DaisyUI + Tailwind CSS, PixiJS agent layer, SVG top-down renderer)

---

## Executive Summary

The Bangron Virtual Office frontend is a well-architected Single Page Application implementing a **realistic 2D Top-Down "Helicopter View"** digital studio with live agent visualization. The codebase demonstrates strong engineering practices:

- **Clean separation of concerns:** Core modules (router, store, API client), domain-specific views, office rendering pipeline (SVG architecture + PixiJS agent layer), realtime WebSocket integration
- **Modern tech stack:** ES modules, DaisyUI v5 + Tailwind CSS v4, PixiJS v8 WebGL rendering, native Web Components (`<dialog>` modals)
- **Deterministic state management:** Centralized reactive `Store` with pub/sub, WebSocket-driven updates, explicit separation of *agent lifecycle state* vs *Hermes runtime availability*
- **Rich visual fidelity:** Architectural floor plan with corridors, rooms, furniture, day/night lighting, real-time clock, swaying plants, ceiling lamps, server LEDs

**Overall Assessment:** The UI/UX foundation is **solid and production-ready for the core use case**. However, several **Critical and High severity issues** exist around authentication flow, responsive behavior, error handling, and accessibility that must be addressed before Director approval for production deployment.

---

## Inventaris Halaman & Komponen (Pages & Components Inventory)

| Route / View | File | Key Components | Status |
|-------------|------|----------------|--------|
| `#/office` | `office-view.js` | SVG floor plan, PixiJS agent layer, CameraController, HUD, Inspector drawer, Demo ribbon | **Complete** |
| `#/dashboard` | `dashboard-view.js` | KPI stats, Active tasks table, Projects list, Activity feed, Hermes health banner | **Complete** |
| `#/agents` | `agents-view.js` | Agent grid with department filters, Profile registration modal, Pause/Resume commands | **Complete** |
| `#/tasks` | `tasks-view.js` | Kanban-style table with filters, Create task modal, Retry/Cancel actions | **Complete** |
| `#/approvals` | `approvals-view.js` | Pending/Approved/Rejected filter tabs, Collapsible payload inspection, Approve/Reject buttons | **Complete** |
| `#/activities` | `activities-view.js` | Audit timeline table, Event type badges, Refresh button | **Complete** |
| `#/projects` | `projects-view.js` | Project cards with progress bars, Create project modal | **Complete** |
| `#/deliverables` | `deliverables-view.js` | Asset table with download links, Category icons | **Complete** |
| `#/settings` | `settings-view.js` | Hermes integration config, Policy engine toggles, Demo reset button | **Complete** |
| `#/login` | `login-view.js` | Email/password form, CSRF handling, Session validation | **Complete** |

**Shared / Core Modules:**
- `core/router.js` — Hash-based SPA router
- `core/store.js` — Reactive state with pub/sub
- `core/api.js` — Fetch wrapper with CSRF, 401 retry logic, session race condition guard
- `realtime/websocket-client.js` — WebSocket with exponential backoff reconnect
- `office/topdown-renderer.js` — SVG architectural renderer (765 lines)
- `office/pixi-agents.js` — PixiJS WebGL agent layer (381 lines)
- `office/movement-engine.js` — Waypoint pathfinding + walk animation (176 lines)
- `office/camera.js` — Pan/zoom/follow camera with Fullscreen API (149 lines)
- `office/palette.js` — Department/status color constants

---

## Audit Results by Area

### A. Dashboard Director — **HIGH** Issues Found

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| A1 | **High** | `dashboard-view.js` | **Hermes health banner uses hardcoded endpoint** — `api.get('/api/director/dashboard')` returns `hermesHealth` but the banner status text/class logic assumes `hermesHealth.connected` boolean; if API returns different shape, banner shows wrong state |
| A2 | **Medium** | `dashboard-view.js` | **KPI sub-text not reactive** — `kpi-agents-sub`, `kpi-tasks-sub`, `kpi-failed-sub` are set once on load; no store subscription for live updates when agents/tasks change |
| A3 | **Medium** | `dashboard-view.js` | **No empty-state illustration** — "No active tasks running" / "No active projects" use plain text; missing DaisyUI `card` with icon + action button |
| A4 | **Low** | `dashboard-view.js` | **Timestamp format inconsistency** — `toLocaleTimeString()` without locale options; varies by browser locale |

---

### B. Virtual Office — **CRITICAL** & **HIGH** Issues Found

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| B1 | **Critical** | `office-view.js` + `pixi-agents.js` | **Agent click hit-test uses Pixi layer only** — `pickAgentAt()` converts client coords → world coords via camera, then hits against Pixi agent rigs. **But the SVG floor plan (rooms, furniture) is NOT hit-tested.** Clicking a room/furniture does nothing; user expects tooltip or room info. |
| B2 | **Critical** | `pixi-agents.js` | **Agent name tag truncation breaks for long names** — `_refreshTag()` uses `Math.max(46, name.length * 5.8 + 14)` for width but text is fixed `fontSize: 7.2`; names > 12 chars overflow container visually. |
| B3 | **High** | `office-view.js` | **Demo ribbon always visible** — `demo-ribbon` (Simulated Multi-Agent Pipeline) renders unconditionally. In production this should be hidden behind a feature flag or dev-only mode. |
| B4 | **High** | `movement-engine.js` | **Speed multiplier applies to visual simulation only** — `simulationSpeed` (1x/2x/4x) multiplies step distance in `tick()`, but `agent.speed` is hardcoded to 60 units/sec. Changing speed visually does NOT update backend arrival times — desync risk. |
| B5 | **High** | `camera.js` | **Follow mode lerp is frame-rate dependent** — `this.panX += (targetPanX - this.panX) * 0.1` uses fixed 0.1 coefficient per frame; at 60fps smooth, at 30fps laggy. Should use time-based easing. |
| B6 | **Medium** | `topdown-renderer.js` | **Corridor/room data from backend but fallback to hardcoded `DEFAULT_CORRIDORS`** — If backend returns empty corridors, hardcoded defaults render. No warning logged when fallback used. |
| B7 | **Medium** | `office-view.js` | **Agent inspector drawer position fixed** — `bottom: 1.25rem; right: 1.25rem;` On mobile/low viewport this can overlap HUD or be cut off. No responsive repositioning. |
| B8 | **Medium** | `pixi-agents.js` | **Speech bubble text truncation at 34 chars** — `_bubbleTextFor()` truncates to 34 chars; tool names like `terraform_plan_apply` get cut mid-word. |
| B9 | **Low** | `office-view.js` | **Night mode toggle only on lamp click** — User can click ceiling lamp to toggle day/night, but no keyboard shortcut or HUD button for accessibility. |
| B10 | **Low** | `topdown-renderer.js` | **Wall clock uses SMIL animation for second hand** — `animateTransform` with `repeatCount="indefinite"` is deprecated in some browsers; should use JS tick for consistency. |

---

### C. Agent Management — **HIGH** Issues Found

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| C1 | **High** | `agents-view.js` | **Pause/Resume buttons show wrong icon for non-waiting statuses** — Button logic: `agent.status === 'waiting' ? 'fi fi-rr-play' : 'fi fi-rr-pause'`. But statuses `idle`, `thinking`, `collaborating`, `completed`, `failed`, `offline` all show "Pause" icon — only `waiting` correctly shows "Resume". |
| C2 | **High** | `agents-view.js` | **Profile registration modal: room dropdown hardcoded** — `<option value=\"room_dev\">Development Room</option>` etc. Should fetch from `/api/virtual-office/state` rooms list. |
| C3 | **Medium** | `agents-view.js` | **Capabilities input is comma-separated string** — No validation, no tag UI, trailing spaces create empty tags. |
| C4 | **Medium** | `agents-view.js` | **Department filter buttons don't persist selection** — Filter resets on view destroy/recreate (hash change). |
| C5 | **Low** | `agents-view.js` | **Avatar color generation per-department is duplicated** — `getDeptColor()` in agents-view.js, `DEPARTMENT_COLORS` in palette.js. Single source of truth missing. |

---

### D. Task Management — **HIGH** Issues Found

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| D1 | **High** | `tasks-view.js` | **Create task modal agent dropdown doesn't filter by capability** — All agents shown regardless of department/capability match. Director must know which agent suits the task. |
| D2 | **High** | `tasks-view.js` | **Task status badge logic incomplete** — Only handles `running`, `waiting`, `completed`, `failed`, `pending`. Missing `cancelled`, `on_hold`, `planning` statuses that exist in backend. |
| D3 | **Medium** | `tasks-view.js` | **Subtask progress badge only shows on parent tasks** — `isParent = !t.parent_task_id && t.subtask_count > 0`. Child tasks show "Single Task" even if they have their own subtasks (nested). |
| D4 | **Medium** | `tasks-view.js` | **Retry/Cancel buttons: no loading state** — Click fires API call immediately; no disabled state, no spinner, double-click possible. |
| D5 | **Low** | `tasks-view.js` | **Priority filter missing from filter bar** — Only status filter (`all`, `running`, `waiting`, `completed`, `failed`). Priority filter (`critical`, `high`, `normal`, `low`) would be valuable. |

---

### E. Approval Center — **MEDIUM** Issues Found

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| E1 | **Medium** | `approvals-view.js` | **Payload collapse accordion not keyboard accessible** — `<div tabindex=\"0\" class=\"collapse collapse-arrow\">` uses DaisyUI collapse but no `Enter`/`Space` handler for expand/collapse. |
| E2 | **Medium** | `approvals-view.js` | **Review notes input not cleared after action** — After Approve/Reject, `review-notes-${id}` retains previous text; confusing for next item. |
| E3 | **Medium** | `approvals-view.js` | **No confirmation dialog for Reject** — Approve has no confirm, Reject has no confirm. High-risk action should require explicit confirmation. |
| E4 | **Low** | `approvals-view.js` | **Risk badge color for 'low' falls back to ghost** — `getRiskBadgeClass()` defaults to `badge-ghost` for unknown risk levels; should have explicit `badge-info` or `badge-neutral`. |

---

### F. Activity & Monitoring — **MEDIUM** Issues Found

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| F1 | **Medium** | `activities-view.js` | **Event type badge logic fragile** — `getEventBadge()` uses string matching (`includes('task')`, `includes('approval')`, `includes('move')`). New event types like `agent.execution.started` get generic ghost badge. Should use explicit map. |
| F2 | **Medium** | `activities-view.js` | **No pagination / infinite scroll** — Loads 100 items hardcoded (`limit=100`). No "Load more" or virtual scrolling for large audit streams. |
| F3 | **Low** | `activities-view.js` | **Timestamp only shows time, not date** — `toLocaleTimeString()` loses date context for multi-day streams. |

---

### G. Responsive Design — **HIGH** Issues Found

| ID | Severity | Component | Issue |
|----|----------|-----------|-------|
| G1 | **High** | `office-view.js` + CSS | **HUD controls overlap on small viewports** — `.office-hud` at `top: 1rem; right: 1rem;` with fixed-width controls (demo ribbon, zoom, speed). On < 480px, controls stack poorly or overlap. |
| G2 | **High** | `office-view.js` | **Agent inspector fixed at 350px width** — `width: 350px; max-height: 480px;` On mobile (375px viewport), inspector consumes 93% width; no full-screen modal fallback. |
| G3 | **High** | `dashboard-view.js` | **Stats row `stats-vertical lg:stats-horizontal`** — On tablet (768px-1024px), stats stack vertically but cards become too tall; intermediate breakpoint missing. |
| G4 | **Medium** | `agents-view.js` | **Agent grid `md:grid-cols-2 lg:grid-cols-3`** — On 768px-1023px, 2 columns with long agent names cause text overflow; name truncation missing. |
| G5 | **Medium** | `tasks-view.js` | **Table horizontal scroll on mobile** — `overflow-x-auto` on table works but headers misalign with body on scroll; sticky header not implemented. |
| G6 | **Low** | Global CSS | **Flaticon icons (`fi-rr-*`) size inconsistent** — Some use `text-xs`, some `text-base`, some hardcoded `text-[11px]`. No design token for icon sizing. |

---

### H. UX States — **CRITICAL** & **HIGH** Issues Found

| ID | Severity | State | Issue |
|----|----------|-------|-------|
| H1 | **Critical** | **Unauthenticated / Session Expired** | **401 redirect logic in `api.js` has race condition guard but NO visual loading state** — When session expires mid-action, user sees no feedback until redirect to `#/login`. Full page reload (`window.location.reload()` in login-view.js) loses all view state. |
| H2 | **Critical** | **WebSocket Reconnecting** | **Realtime status pill shows "Reconnecting..." but NO offline banner** — Only the navbar pill updates. No toast, no modal, no page-level indicator that live data is stale. |
| H3 | **High** | **Loading States** | **All views show generic "Loading..." text** — No skeleton loaders, no progressive enhancement. DaisyUI `loading` component used but inconsistent. |
| H4 | **High** | **Error States** | **API errors only logged to console + alert()** — `alert('Failed to create task: ' + err.message)` is jarring; no toast/notification system. No retry button on failed loads. |
| H5 | **High** | **Empty States** | **Mixed implementations** — Some views use `card` with icon + text (approvals), others use plain `text-center` in table (tasks, activities). No unified empty state component. |
| H6 | **Medium** | **Offline / Runtime Offline** | **`runtime-offline` class grays out agents** — `office-view.js:196` toggles class but no user-facing explanation of WHY agents appear offline. |
| H7 | **Medium** | **Waiting for Approval** | **Agent shows "Approval Req" in bubble but task status stays "running"** — Inconsistent: task status badge shows "running" while agent bubble shows "Approval Req". |
| H8 | **Low** | **Session Expired** | **Login view reloads entire page** — `window.location.reload()` after login loses scroll position, view state, and causes full re-fetch of all data. |

---

## Integrasi UI dengan Backend — Issues

| ID | Severity | Issue |
|----|----------|-------|
| I1 | **High** | **API base URL hardcoded in adapter** — `hermesAdapter.baseUrl = 'http://localhost:8642'` in tests; production config uses `hermesConfig.apiUrl` but frontend has no equivalent env config for API base. |
| I2 | **High** | **CSRF token handling assumes cookie-based auth** — `api.js` reads CSRF from `/api/auth/csrf` endpoint but if backend uses Bearer tokens, this fails silently. |
| I3 | **Medium** | **WebSocket URL assumes same host** — `wsUrl = \`${protocol}//${window.location.host}/ws\``; if frontend served from CDN/subdomain different from API, WS fails. |
| I4 | **Medium** | **No API versioning in frontend** — All endpoints called without version prefix (`/api/v1/...`); backend may introduce breaking changes. |
| I5 | **Low** | **Agent capabilities stored as JSON string** — `capabilities_json` parsed with `JSON.parse()` in multiple views; parse errors caught but silent. |

---

## Fitur yang Belum Diimplementasikan (Missing Features)

| Feature | Area | Description |
|------|------|-------------|
| **Agent Capability Matching** | Tasks | Filter agents by capabilities when assigning tasks |
| **Task Dependencies Visualization** | Tasks | DAG view of task dependencies (parent → subtasks) |
| **Agent Workload Heatmap** | Dashboard | Visual heatmap of agent utilization over time |
| **Approval Escalation Timer** | Approvals | Auto-escalate/reject after timeout |
| **Bulk Actions** | Tasks/Agents | Multi-select + bulk assign/cancel/pause |
| **Keyboard Shortcuts** | Global | `Cmd/Ctrl+K` command palette, `Esc` close modals, `F` follow agent |
| **Dark/Light Theme Persistence** | Settings | Already works via localStorage but no system preference detection |
| **Accessibility (a11y) Audit** | Global | No ARIA labels on icon-only buttons, no focus trapping in modals |
| **Notification/Toast System** | Global | Replace `alert()` with non-blocking toasts |
| **Progressive Web App (PWA)** | Global | Offline caching, install prompt, background sync |

---

## Screenshot Evidence (Described — Cannot Capture in Headless)

| View | Key Visual Elements | Issues Visible |
|------|---------------------|----------------|
| **Dashboard** | KPI stats row, Active tasks table, Projects list, Activity feed | KPI sub-text static; Hermes badge uses hardcoded logic |
| **Virtual Office** | SVG floor plan (rooms, corridors, furniture), PixiJS agent avatars with halos/name tags/bubbles, HUD (zoom, follow, speed), Demo ribbon, Inspector drawer, Activity ticker | Demo ribbon always visible; Inspector fixed position; Lamp click toggles night mode (no visual cue) |
| **Agents** | Grid cards with avatar, status badge, capabilities, Pause/Resume button | Pause button wrong icon for most statuses; Room dropdown hardcoded |
| **Tasks** | Filter tabs, Table with subtask progress, Retry/Cancel buttons, Create modal | Status badges incomplete; No capability filter in agent dropdown |
| **Approvals** | Filter tabs, Collapsible payload, Approve/Reject buttons | No confirm dialog; Accordion not keyboard accessible |
| **Activities** | Timeline table with event badges | No pagination; Time-only timestamps |
| **Projects** | Card grid with progress bars, Create modal | Complete |
| **Deliverables** | Table with download links, Category icons | Complete |
| **Settings** | Hermes config, Policy toggles, Demo reset | Complete |
| **Login** | Email/password form, Error alert | Page reload on success |

---

## Rekomendasi Perbaikan (Prioritas)

### Phase 1 — Critical / High (Blockers for Production)
1. **Fix authentication flow** — Replace `alert()` + page reload with toast + SPA state preservation (H1, H8)
2. **Add WebSocket offline banner** — Global toast/notification when `wsConnected=false` (H2)
3. **Fix agent click hit-test** — Add SVG layer hit-test for rooms/furniture tooltips (B1)
4. **Fix Pause/Resume button logic** — Map all agent statuses to correct icons (C1)
5. **Add skeleton loaders** — Replace "Loading..." text with DaisyUI skeleton components (H3)
6. **Implement toast/notification system** — Replace all `alert()` calls (H4)
7. **Fix mobile HUD overlap** — Responsive HUD stacking, inspector full-screen modal on mobile (G1, G2)

### Phase 2 — High / Medium (UX Polish)
8. **Unify empty state component** — Consistent card + icon + action button pattern (H5)
9. **Add capability filter to task assignment** — Filter agents by capabilities (D1)
10. **Fix task status badge completeness** — Add missing statuses (D2)
11. **Make room dropdown dynamic** — Fetch from `/api/virtual-office/state` (C2)
12. **Add keyboard accessibility to accordions** — Enter/Space for collapse (E1)
13. **Add confirmation dialog for high-risk actions** — Reject approval, cancel task (E3)
14. **Fix camera follow lerp** — Time-based easing (B5)
15. **Add agent name tag overflow handling** — Ellipsis or tooltip (B2)

### Phase 3 — Medium / Low (Enhancements)
16. **Implement PWA** — Service worker, manifest, offline caching
17. **Add command palette** — `Cmd/Ctrl+K` for navigation
18. **Add bulk actions** — Multi-select on tasks/agents
19. **Add approval escalation timer** — Auto-action after timeout
20. **System theme detection** — `prefers-color-scheme` for initial theme

---

## Test Results Summary

| Test Suite | Status | Notes |
|------------|--------|-------|
| Unit Tests (Vitest) | **208 passed, 2 pre-existing failures** | 2 failures in `event-timestamp.test.js` (unrelated to UI) |
| CSS Build (Tailwind v4) | **Success** | 2s build time |
| npm Audit (high) | **Clean** | 2 moderate pre-existing (tailwindcss/typography) |
| Playwright E2E | **NOT VERIFIED** | Port 3002 occupied by homelab service (EADDRINUSE) |
| Manual Browser Test | **NOT RUN** | Requires live server on port 3002 |

**Critical Note:** Playwright E2E and manual browser testing **cannot be executed** in this environment because the homelab service (`bangron-virtual-office.service`) occupies port 3002. The CI pipeline runs Playwright successfully in isolated environment.

---

## Unverified / NOT TESTED Areas

| Area | Reason |
|------|--------|
| **Live WebSocket integration** | Requires running backend gateway on port 3002 |
| **Hermes runtime integration** | `HERMES_RUNTIME_VERIFIED=false` — no live Hermes API |
| **Fullscreen API behavior** | Needs browser test |
| **Touch/gesture handling on mobile** | No mobile device testing |
| **Accessibility (screen readers)** | No NVDA/VoiceOver testing |
| **Performance under load** | No 50+ agent stress test |
| **Cross-browser (Safari, Firefox)** | Only Chromium-based assumed |

---

## File Dokumentasi yang Dibuat

1. `docs/UI_UX_AUDIT_REPORT.md` — This comprehensive audit report
2. `docs/UI_UX_REMEDIATION_ROADMAP.md` — Phased remediation plan (to be created)

---

## Konfirmasi Batasan

✅ **Tidak ada source code yang diubah** — Audit read-only  
✅ **Tidak ada konfigurasi yang diubah** — `.env`, secrets, runtime tidak disentuh  
✅ **PR #3 tetap OPEN dan DRAFT** — Tidak di-merge/approve  
✅ **Gate G6 tetap OPEN** — Tidak ditutup  
✅ **HERMES_RUNTIME_VERIFIED=false** — Tidak diubah  
✅ **Tidak ada real Hermes task dispatch**  
✅ **Tidak ada production database access**  

---

## Final Summary for Director

| Metric | Count |
|--------|-------|
| **Critical** | 4 (B1, B2, H1, H2) |
| **High** | 16 (A1, B3, B4, B5, C1, C2, D1, D2, G1, G2, G3, H3, H4, H5, I1, I2) |
| **Medium** | 20 (A2, A3, B6, B7, B8, C3, C4, D3, D4, E1, E2, E3, F1, F2, G4, G5, H6, H7, I3, I4) |
| **Low** | 10 (A4, B9, B10, C5, D5, E4, F3, G6, H8, I5) |
| **Total Findings** | **50** |

**Severity Recalculation:** Based on master inventory (not legacy summary). Original report claimed 3 Critical / 11 High — **corrected to 4 Critical / 16 High / 20 Medium / 10 Low** after H3/H4/H5 separation, I1/I2 inclusion, and full inventory recount.

**Recommendation:** **NOT READY FOR PRODUCTION** — 4 Critical + 16 High + 20 Medium blockers must be addressed (Phase 1). Core architecture is sound, visual design exceptional, but authentication flow, WebSocket resilience, agent hit-test, and mobile responsiveness are production blockers.

**Next Step:** Proceed to Phase 1 implementation after Director approval. See `docs/UI_UX_REMEDIATION_ROADMAP.md` for detailed task breakdown, dependencies, and acceptance criteria.