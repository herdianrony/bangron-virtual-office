# Bangron Virtual Office — UI/UX Remediation Roadmap

**Branch:** `fix/g6-hermes-eventbridge`
**Base:** `main` @ `a6f9b47`
**Audit Report:** `docs/UI_UX_AUDIT_REPORT.md`
**Reconciliation:** `docs/UI_UX_AUDIT_RECONCILIATION.md`
**Date:** 2026-11-21
**Total Findings (Master Inventory):** 50 (4 Critical, 16 High, 20 Medium, 10 Low)

---

## Phase 1 — Critical / High (Production Blockers)

**Target:** Complete before Director approval for production deployment  
**Estimated Effort:** 8-12 engineering days

### P1.1 — Fix Authentication Flow (H1, H8)
**Files:** `public/assets/js/core/api.js`, `public/assets/js/views/login-view.js`, `public/assets/js/app.js`  
**Dependencies:** None  
**Acceptance Criteria:**
- [ ] Replace `alert()` + `window.location.reload()` with toast notification + SPA state preservation
- [ ] On session expiry: show toast "Sesi berakhir, silakan login kembali" → redirect to `#/login` without full reload
- [ ] Login success: restore previous view/hash, preserve scroll position
- [ ] Add global `AuthError` event in store for UI components to react

**Implementation Notes:**
- Create `ToastService` module (non-blocking, auto-dismiss, action buttons)
- Store `preLoginHash` in sessionStorage before redirect
- On login success, `window.location.hash = preLoginHash || '#/office'` without reload

---

### P1.2 — WebSocket Offline Banner (H2)
**Files:** `public/assets/js/app.js`, `public/assets/js/realtime/websocket-client.js`, `public/assets/js/core/store.js`  
**Dependencies:** P1.1 (ToastService)  
**Acceptance Criteria:**
- [ ] When `wsConnected=false` for > 3s: show persistent banner "Koneksi realtime terputus. Mencoba menyambung kembali..."
- [ ] Banner includes "Coba Lagi" button → `realtimeClient.connect()`
- [ ] Banner auto-hides on `wsConnected=true`
- [ ] Visual distinction: warning banner (amber) not error (red) — reconnection is expected behavior

**Implementation Notes:**
- Add `wsDisconnectedAt` timestamp in store
- Subscribe to `wsConnected` changes in `app.js`
- Reuse ToastService with `persistent: true` option

---

### P1.3 — Fix Agent Click Hit-Test (B1)
**Files:** `public/assets/js/views/office-view.js`, `public/assets/js/office/topdown-renderer.js`  
**Dependencies:** None  
**Acceptance Criteria:**
- [ ] Clicking room/furniture/decor shows tooltip with name (reuse `#office-tooltip`)
- [ ] Clicking agent opens inspector (existing behavior preserved)
- [ ] No false positives: clicking empty corridor/floor does nothing
- [ ] Hit-test priority: agents > rooms/furniture > decor > empty

**Implementation Notes:**
- Add `renderHitTestLayer()` in `topdown-renderer.js` — invisible `<rect>`/`<path>` elements with `data-name` and `pointer-events="all"` on a separate SVG layer
- In `office-view.js` `pickAgentAt()`: if no agent hit, check SVG hit-test layer via `document.elementFromPoint()`
- Reuse existing tooltip system (`initTooltip()`)

---

### P1.4 — Fix Pause/Resume Button Logic (C1)
**Files:** `public/assets/js/views/agents-view.js`  
**Dependencies:** None  
**Acceptance Criteria:**
- [ ] Button shows "Resume" (play icon) ONLY for `waiting` status
- [ ] Button shows "Pause" (pause icon) for `working`, `thinking`, `collaborating`, `walking`
- [ ] Button hidden/disabled for terminal statuses: `completed`, `failed`, `cancelled`, `idle`, `offline`
- [ ] API call sends correct command: `resume` for waiting, `pause` for others

**Implementation Notes:**
```javascript
const PAUSABLE_STATUSES = ['working', 'thinking', 'collaborating', 'walking'];
const RESUMABLE_STATUSES = ['waiting'];
// Button visible only if status in PAUSABLE_STATUSES || RESUMABLE_STATUSES
// Icon: status === 'waiting' ? 'fi-rr-play' : 'fi-rr-pause'
// Command: status === 'waiting' ? 'resume' : 'pause'
```

---

### P1.5 — Skeleton Loaders (H3)
**Files:** All view files (`dashboard-view.js`, `agents-view.js`, `tasks-view.js`, `approvals-view.js`, `activities-view.js`, `projects-view.js`, `deliverables-view.js`, `office-view.js`)  
**Dependencies:** None (can be done in parallel)  
**Acceptance Criteria:**
- [ ] Replace all "Loading..." text with DaisyUI `loading` skeleton components
- [ ] Table views: `loading loading-row` skeleton rows matching column count
- [ ] Card grids: `loading loading-card` skeleton cards
- [ ] KPI stats: `loading loading-bar` for each stat value
- [ ] Minimum 1.5s display time (prevent flash)

**Implementation Notes:**
- Create `renderSkeleton(viewType)` helper in each view
- Use `setTimeout(() => renderRealData(), 1500)` for minimum display
- DaisyUI classes: `loading`, `loading-bar`, `loading-spinner`, `loading-row`, `loading-card`

---

### P1.6 — Toast/Notification System (H4)
**Files:** New `public/assets/js/core/toast.js`, `public/assets/js/app.js` (global init)  
**Dependencies:** P1.1  
**Acceptance Criteria:**
- [ ] `toast.success(message, action?)`, `toast.error(message, action?)`, `toast.info(message)`, `toast.warning(message)`
- [ ] Auto-dismiss after 5s (configurable)
- [ ] Action button: `toast.error('Gagal', { label: 'Coba Lagi', onClick: () => retry() })`
- [ ] Stack multiple toasts (top-right, max 3 visible)
- [ ] Persistent option: `toast.warning('Offline', { persistent: true, action: { label: 'Reconnect', onClick: reconnect } })`
- [ ] Replace ALL `alert()` and `confirm()` calls in views

**Implementation Notes:**
- Use DaisyUI `alert` component with `alert-fixed` positioning
- Portal pattern: render toasts in fixed container `#toast-root` appended to body
- Accessible: `role="alert"`, `aria-live="polite"`

---

### P1.7 — Mobile HUD Overlap & Inspector (G1, G2)
**Files:** `public/assets/css/office.css`, `public/assets/js/views/office-view.js`  
**Dependencies:** None  
**Acceptance Criteria:**
- [ ] HUD controls stack vertically on < 640px (CSS media query)
- [ ] Demo ribbon moves to bottom on mobile
- [ ] Inspector drawer: on < 640px, open as full-screen modal (DaisyUI `modal modal-bottom`) instead of fixed 350px drawer
- [ ] Inspector close button accessible on mobile (thumb reachable)
- [ ] No horizontal overflow on any viewport ≥ 320px

**Implementation Notes:**
- CSS: `@media (max-width: 639px) { .office-hud { flex-direction: column; right: 0.5rem; } .demo-ribbon { top: auto; bottom: 4rem; } }`
- JS: In `openAgentInspector()`, check `window.innerWidth < 640` → render modal HTML instead of drawer
- Reuse DaisyUI `modal modal-bottom` for mobile inspector

---

## Phase 2 — High / Medium (UX Polish)

**Target:** Complete within 2 sprints after Phase 1  
**Estimated Effort:** 10-15 engineering days

### P2.1 — Unified Empty State Component (H5)
**Files:** New `public/assets/js/core/empty-state.js`, all view files  
**Acceptance Criteria:**
- [ ] Single `EmptyState({ icon, title, description, actionLabel, actionHref })` component
- [ ] Used in: dashboard (tasks, projects, activities), agents, tasks, approvals, activities, projects, deliverables
- [ ] Consistent DaisyUI `card` with icon (48px), title, description, primary action button

---

### P2.2 — Capability Filter for Task Assignment (D1)
**Files:** `public/assets/js/views/tasks-view.js`, `public/assets/js/core/api.js`  
**Acceptance Criteria:**
- [ ] "Filter by Capability" dropdown in Create Task modal
- [ ] When capability selected, agent dropdown filters to agents with that capability
- [ ] "Let Hermes Assign" option always available
- [ ] Backend: add `/api/agents?capability=<name>` filter or filter client-side

---

### P2.3 — Complete Task Status Badges (D2)
**Files:** `public/assets/js/views/tasks-view.js`, `public/assets/js/views/dashboard-view.js`  
**Acceptance Criteria:**
- [ ] Add badge classes for: `cancelled` (error), `on_hold` (warning), `planning` (info), `pending` (ghost)
- [ ] Consistent badge colors across dashboard, tasks view, approvals
- [ ] Status badge component shared: `TaskStatusBadge({ status })`

---

### P2.4 — Dynamic Room Dropdown (C2)
**Files:** `public/assets/js/views/agents-view.js`, `public/assets/js/core/api.js`  
**Acceptance Criteria:**
- [ ] Room `<select>` populated from `/api/virtual-office/state` rooms
- [ ] Fallback to hardcoded list if API fails
- [ ] Room name displayed (not just ID)

---

### P2.5 — Keyboard Accessible Accordions (E1)
**Files:** `public/assets/js/views/approvals-view.js`  
**Acceptance Criteria:**
- [ ] `Enter` / `Space` toggles collapse
- [ ] `aria-expanded` attribute updated
- [ ] Focus stays on trigger after toggle

---

### P2.6 — Confirmation Dialogs for High-Risk Actions (E3)
**Files:** `public/assets/js/views/approvals-view.js`, `public/assets/js/views/tasks-view.js`  
**Acceptance Criteria:**
- [ ] Reject approval: modal "Yakin menolak permintaan ini? Agent akan diberhentikan." → Confirm/Cancel
- [ ] Cancel task: modal "Batalkan task ini? Tindakan tidak dapat diurungkan." → Confirm/Cancel
- [ ] Retry task: no confirm (safe action)
- [ ] Use DaisyUI `modal` with `btn-error` for confirm

---

### P2.7 — Time-Based Camera Follow Lerp (B5)
**Files:** `public/assets/js/office/camera.js`  
**Acceptance Criteria:**
- [ ] Lerp coefficient calculated per-frame: `1 - Math.pow(0.1, deltaSec * 60)` ≈ 0.1 at 60fps
- [ ] Smooth at 30fps, 60fps, 120fps
- [ ] No overshoot or jitter

---

### P2.8 — Agent Name Tag Overflow (B2)
**Files:** `public/assets/js/office/pixi-agents.js`  
**Acceptance Criteria:**
- [ ] Name tag width capped at 120px
- [ ] Ellipsis in PixiJS Text: `tagText.style.wordWrap = true; tagText.style.wordWrapWidth = 120`
- [ ] Hover tooltip shows full name (reuse `#office-tooltip` system)

---

## Phase 3 — Enhancements (Nice to Have)

**Target:** Post-production, continuous improvement  
**Estimated Effort:** Ongoing

| Task | Description |
|------|-------------|
| P3.1 | PWA: Service Worker, manifest.json, offline caching |
| P3.2 | Command Palette: `Cmd/Ctrl+K` for navigation, actions |
| P3.3 | Bulk Actions: Multi-select on tasks/agents grid |
| P3.4 | Approval Escalation Timer: Auto-reject after 24h |
| P3.5 | System Theme Detection: `prefers-color-scheme` |
| P3.6 | Accessibility Audit: ARIA labels, focus trapping, color contrast |
| P3.7 | Performance: Virtual scrolling for 100+ agents/tasks |
| P3.8 | Cross-browser testing: Safari, Firefox |

---

## Dependency Graph

```
P1.1 (Auth Flow) ──► P1.2 (WS Banner)
                     │
                     ▼
P1.6 (Toast System) ──► P1.1, P1.2, P1.4, P1.7
                     │
                     ▼
All view files updated to use ToastService
```

---

## Acceptance Criteria Summary (Definition of Done)

| Phase | Criteria |
|-------|----------|
| **Phase 1** | All 7 items verified on staging; Playwright E2E passes; no Critical/High findings remain |
| **Phase 2** | All 8 items verified; accessibility audit (axe-core) passes WCAG 2.1 AA |
| **Phase 3** | PWA audit (Lighthouse) ≥ 90; Lighthouse Performance ≥ 80 |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebSocket testing blocked by port 3002 conflict | High | High | Use CI GitHub Actions for Playwright; local dev uses different port |
| Toast system breaks existing alert() flows | Low | Medium | Incremental migration: add toast, then replace alert() per view |
| Mobile inspector modal breaks desktop drawer | Low | Low | Feature flag `isMobile` based on viewport; separate render paths |
| DaisyUI version upgrade breaks custom CSS | Low | Medium | Pin DaisyUI version; test CSS build in CI |

---

## Tracking

| Task | Status | Assignee | PR | Notes |
|------|--------|----------|----|-------|
| P1.1 | ✅ Done | — | #3 | Implemented |
| P1.2 | ✅ Done | — | #3 | Implemented |
| P1.3 | ✅ Done | — | #3 | Implemented |
| P1.4 | ✅ Done | — | #3 | Implemented |
| P1.5 | ✅ Done | — | #3 | Implemented |
| P1.6 | ✅ Done | — | #3 | Implemented |
| P1.7 | ✅ Done | — | #3 | Implemented |
| P2.1 | ✅ Done | — | #3 | Implemented |
| P2.2 | ✅ Done | — | #3 | Implemented |
| P2.3 | ✅ Done | — | #3 | Implemented |
| P2.4 | ✅ Done | — | #3 | Implemented |
| P2.5 | ✅ Done | — | #3 | Implemented |
| P2.6 | ✅ Done | — | #3 | Implemented |
| P2.7 | ✅ Done | — | #3 | Implemented |
| P2.8 | ✅ Done | — | #3 | Implemented |

---

**Next Action:** Director review → approve PR #3 → proceed to live Hermes runtime verification (Gate G6).