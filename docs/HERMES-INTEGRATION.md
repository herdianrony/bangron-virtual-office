# Hermes Agent Integration Specification

## 1. Role and Separation of Concerns

Hermes Agent serves as the AI Agent Runtime and Orchestrator. Bangron Virtual Office acts as:
- Control Plane
- Persistent State Layer (SQLite)
- Visual Representation Layer (2.5D Isometric SVG)
- Approval Gatekeeper

The backend does NOT re-implement Hermes' internal LLM prompting or tool routing. Instead, it interacts via:
1. **Outbound Commands:** Dispatching instructions to Hermes API or local runtime adapter.
2. **Inbound Webhook/Hooks:** Receiving lifecycle and tool execution events from Hermes.

---

## 2. Environment Verification Findings

During Phase 0 inspection on 2026-11-19:
- Node.js `v20.20.2` and SQLite (`better-sqlite3`) are fully supported.
- `hermes` CLI is not present in PATH in this environment.
- Therefore, the Hermes Integration Adapter operates in **Adapter Ready / Mock Verified** mode, with live status reported as `RUNTIME_UNAVAILABLE (MOCK / ADAPTER READY)`.
- The webhook receiver, signature validator, normalizer, event deduplicator, and state reconciler are fully implemented and verified against the official contract.

---

## 3. Normalized Event Contract

Incoming Hermes events are mapped into standardized internal events:

| Native Hook Source | Normalized Internal Event | Description |
|---|---|---|
| `agent:start` | `agent.execution.started` | Agent runtime instance initialized execution session |
| `agent:step` | `agent.execution.step` | Intermediate step or reasoning phase |
| `agent:end` | `agent.execution.ended` | Session completed (subject to task reconciliation) |
| `pre_tool_call` | `agent.tool.started` | Agent began executing a specific tool |
| `post_tool_call` | `agent.tool.completed` | Tool execution finished with result or error |
| `subagent:spawn` | `agent.subagent.spawned` | Orchestrator delegated work to a specialist |
| `subagent:exit` | `agent.subagent.exited` | Subagent finished delegated portion |

Normalized Payload Schema:
```json
{
  "event_id": "evt_01jcvz9...",
  "event_type": "agent.tool.started",
  "occurred_at": "2026-11-19T10:00:00.000Z",
  "source": "hermes",
  "agent_id": "profile_frontend_dev",
  "instance_id": "inst_fe_01",
  "session_id": "sess_01jcvz...",
  "parent_session_id": "sess_orch_01",
  "task_id": "task_ui_impl",
  "correlation_id": "corr_landing_page",
  "payload": {
    "tool_name": "write_file",
    "tool_input": { "path": "src/App.vue" }
  }
}
```

---

## 4. State Reconciliation Rules

1. **Tool completion is not task completion:** A `post_tool_call` event sets agent status back to `working` or `idle`, but the task status remains `running`.
2. **Session termination requires exit status inspection:** `agent:end` only marks a task as `completed` if all child tasks are completed and no unhandled error occurred.
3. **Idempotency:** Any event with an already recorded `event_id` is acknowledged with `200 OK` and marked `ignored (duplicate)` without triggering secondary state transitions.
4. **Signature Verification:** All incoming requests to `/api/integrations/hermes/events` must match HMAC-SHA256 of the raw body against `HERMES_WEBHOOK_SECRET`.

---

## 5. Official Hermes Agent Outbound Webhooks (VERIFIED 2026-11-19)

Diverifikasi terhadap dokumentasi resmi:
https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks

### 5.1 Konfigurasi di sisi Hermes (~/.hermes/config.yaml)

```yaml
hooks:
  outbound:
    - name: bangron-office
      url: https://<OFFICE-PUBLIC-URL>/api/integrations/hermes/events
      events:
        - on_session_start
        - on_session_end
        - pre_llm_call
        - pre_tool_call
        - post_tool_call
        - subagent_start
        - subagent_stop
      secret_env: HERMES_OUTBOUND_WEBHOOK_SECRET   # env var berisi HMAC secret
      timeout: 10
```

Secret disimpan di `~/.hermes/.env` pada mesin Hermes: `HERMES_OUTBOUND_WEBHOOK_SECRET=...`
dan **harus sama** dengan `HERMES_WEBHOOK_SECRET` di office.

### 5.2 Wire format resmi (diverifikasi terhadap runtime terpasang)

**Sumber verifikasi (2026-11-20):** kode runtime Hermes terpasang v0.23.2
(`agent/outbound_webhooks.py` + `agent/shell_hooks.py::_utc_now_iso`), bukan asumsi:

- Header: `X-Hermes-Event`, `X-Hermes-Delivery` (= `delivery_id`),
  `X-Hermes-Signature-256: sha256=<hex>` = HMAC-SHA256(secret, **raw body persis**),
  `User-Agent: Hermes-Agent-Outbound-Webhook`. **Tidak ada header `X-Hermes-Timestamp` native.**
- Body (semua field di dalam body yang ditandatangani HMAC): `hook_event_name`, `profile`,
  `tool_name`, `tool_input`, `session_id`, `cwd`, `extra{...}`, `delivery_id`, `timestamp`.
- `delivery_id` = UUID4 hex, dibuat sekali per event dan **stabil lintas retry**
  (Hermes: maksimal 2 attempt, retry hanya untuk connection error/5xx; 4xx final).
- `timestamp` = **ISO-8601 UTC dengan `Z`** (contoh `2026-11-20T05:30:00Z`,
  dapat memuat fraksi detik). Karena berada di dalam body yang ditandatangani,
  timestamp terikat secara kriptografis ke konten — inilah dasar anti-replay.
- Dedupe memakai `delivery_id`; event yang sudah diproses ditolak **409 DUPLICATE_EVENT**
  (4xx → Hermes tidak me-retry).
- Event yang dinormalisasi: `on_session_start` → execution.started, `on_session_end`/`on_session_finalize` → execution.ended, `subagent_start` → subagent.spawned, `subagent_stop` → subagent.exited, `pre_llm_call` → execution.step, `pre_tool_call`/`post_tool_call` → tool.started/tool.completed

**Aturan validasi `/events` (S2 remediation):**

1. HMAC-SHA256 atas raw body persis, perbandingan constant-time; header signature
   yang diterima: `X-Hermes-Signature-256` (native), `x-hermes-signature`, `x-hub-signature-256`.
2. **ID stabil wajib**: `delivery_id` (native) atau `event_id` (kontrak Bangron).
   Tanpa ID → tolak; tidak ada pembangkitan ID acak diam-diam untuk webhook masuk.
3. **Freshness dari timestamp di dalam body bertanda tangan** (`timestamp`, fallback
   `occurred_at`): unix seconds/ms atau ISO-8601 berzona. Drift maksimum ±300 detik.
   Header legacy `X-Hermes-Timestamp` bila dikirim harus cocok dengan timestamp body
   (toleransi 1 detik) — header saja tidak pernah menjadi dasar freshness.
4. Timestamp invalid/kedaluwarsa/without-ID → 401 dengan kode alasan di bawah;
   duplikat delivery → 409; event valid → 200 + rekonsiliasi transaksional.

| Kode alasan (401 kecuali disebut) | Kondisi |
|---|---|
| `WEBHOOK_SECRET_NOT_CONFIGURED` | Secret office belum di-set (fail-closed) |
| `MISSING_SIGNATURE` / `INVALID_SIGNATURE` | Header signature hilang / HMAC tidak cocok |
| `RAW_BODY_UNAVAILABLE` | Raw body tidak tersedia untuk verifikasi |
| `MISSING_STABLE_EVENT_ID` | Tanpa `delivery_id`/`event_id` |
| `MISSING_SIGNED_TIMESTAMP` | Body tanpa `timestamp`/`occurred_at` |
| `INVALID_TIMESTAMP` | Format timestamp tidak didukung / tanggal rollover |
| `TIMESTAMP_DRIFT` | Di luar jendela ±300 detik |
| `TIMESTAMP_HEADER_MISMATCH` | Header legacy berbeda dari timestamp body bertanda tangan |
| `DUPLICATE_EVENT` (409) | Delivery ulang event yang sudah diproses |

Kompatibilitas mundur: kontrak Bangron lama (`event_id` + `event_type` + unix
timestamp di body + header `X-Hermes-Timestamp` yang cocok) tetap diterima.
Tes: `tests/unit/hermes-webhook-security.test.js` (kasus positif native + 7 kasus
negatif) dan `tests/unit/event-timestamp.test.js`.

**Batas adapter `/agents`:** registrasi agen hanya diverifikasi HMAC (tanpa
timestamp/ID event) karena idempoten berdasarkan nama — replay tidak menghasilkan
duplikasi. `/events` adalah satu-satunya jalur ingesti event lifecycle.

**Status endpoint:** `GET /api/integrations/hermes/status` kini **Director-only**
(`authenticate` + `requireDirector`, S1 remediation) — metadata runtime dan payload
event terakhir tidak boleh dibaca klien anonim. UI Settings memanggilnya dengan
sesi Director yang sudah login.

### 5.3 Resolusi identitas agen

Wire format resmi tidak membawa `instance_id`. Office meresolusi dengan rantai:
1. `instance_id` eksplisit (jika Hermes/adapter mengirim)
2. `session_id` yang sudah dikenal (stickiness)
3. `HERMES_PROFILE_AGENT_MAP` (env JSON: `{"nama-profil":"inst_xxx"}`)
4. **Auto-provisioning** (aktif sejak 2026-11-19): jika `profile`/`agent_id` belum terdaftar,
   office otomatis membuat profil + instance + posisi kantor dengan **nama asli Hermes**
   (`inst_hermes_<slug>`; idempoten, sticky lintas event) dan menyiarkan `agent.created` via WS.
5. `HERMES_DEFAULT_AGENT_ID` (default: `inst_demo_hermes`) — hanya bila tidak ada identitas sama sekali.

Penempatan ruang otomatis dari heuristik nama (dev → room_dev, qa → room_qa, research →
room_research, design/creative → room_creative, ui/ux → room_uiux, marketing → room_marketing,
orchestrator/ops → room_ops, lainnya → room_lounge) dan mengambil workstation bebas di ruang tsb.

### 5.4 Registrasi agen sebelum event (opsional)

Untuk memunculkan agen dengan nama asli sebelum webhook pertama datang:

```bash
curl -X POST https://<OFFICE-PUBLIC-URL>/api/integrations/hermes/agents \
  -H "Content-Type: application/json" \
  -H "X-Hermes-Signature-256: sha256=<hmac-secret-atas-raw-body>" \
  -d '{"agents":[{"name":"Nama Agen Asli 1","department":"Development"},{"name":"Nama Agen Asli 2"}]}'
```

Endpoint dilindungi HMAC yang sama dengan `/events`, idempoten (nama yang sudah terdaftar
dikembalikan tanpa duplikasi), maksimal 50 agen per panggilan. Alternatif satu agen:
`{"name":"..."}`.

### 5.5 Approval gate dengan nama tool nyata

Outbound payload tidak membawa `action_type`, sehingga gate juga mendeteksi dari
nama tool (heuristik kata kunci): deploy/release → deploy_production,
drop/truncate → database_destructive, publish/social → external_publication,
email/broadcast → external_communication, credential/secret → security_config_change,
grant/escalate → grant_permissions. Kecocokan persis `action_type` tetap diutamakan.

Catatan: outbound webhooks bersifat **notify-only** (tidak bisa memblokir tool di
sisi Hermes). Pemblokiran langsung memerlukan shell/plugin hook `pre_tool_call`
di Hermes yang memanggil API office sebelum tool dieksekusi.
