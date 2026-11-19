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

### 5.2 Wire format resmi (didukung penuh oleh office)

- Header: `X-Hermes-Event`, `X-Hermes-Delivery`, `X-Hermes-Signature-256: sha256=<hex>`
- Body: `hook_event_name`, `profile`, `tool_name`, `tool_input`, `session_id`, `cwd`, `extra{...}`, `delivery_id`, `timestamp`
- Dedupe memakai `delivery_id` (Hermes retry 1x untuk 5xx), timestamp anti-replay di dalam body
- Event yang dinormalisasi: `on_session_start` → execution.started, `on_session_end`/`on_session_finalize` → execution.ended, `subagent_start` → subagent.spawned, `subagent_stop` → subagent.exited, `pre_llm_call` → execution.step, `pre_tool_call`/`post_tool_call` → tool.started/tool.completed

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
