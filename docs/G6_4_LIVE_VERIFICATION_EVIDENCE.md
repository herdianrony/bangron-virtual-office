# G6.4 — Live Hermes Runtime Verification Evidence

- **Tanggal:** 2026-11-27 (WIB)
- **Status:** VERIFIED — Gate G6 ditutup atas instruksi Director
- **Branch:** `fix/realtime-g6-apply` (HEAD `e5086db` + commit dokumentasi ini)
- **Lingkungan:** produksi homelab, `bangron-virtual-office.service` → `studio.bangron.my.id`

## 1. Konfigurasi aktif

| Item | Nilai | Bukti |
|---|---|---|
| `HERMES_API_URL` | `http://127.0.0.1:8642` | `.env` (mode 600); pinned IPv4, bukan `localhost`/`::1` |
| `HERMES_API_KEY` | terkonfigurasi | `GET /v1/models` → 200, model `hermes-agent` |
| `HERMES_WEBHOOK_SECRET` | terkonfigurasi | sama dengan `HERMES_OUTBOUND_WEBHOOK_SECRET` di `~/.hermes/.env` |
| `HERMES_RUNTIME_VERIFIED` | `true` | `GET /api/integrations/hermes/status` → `connected:true, runtimeVerified:true, status:CONNECTED` |

## 2. Probe transport (langsung ke API Hermes)

| Probe | Hasil |
|---|---|
| `POST /v1/runs` (input read-only) | **202 Accepted**, `run_id=run_49628222afcc4eceba287394144383bd`, `status=started` |
| `GET /v1/runs/{id}` | `running` → **`completed`** (poll ke-2) |
| `GET /v1/runs/{id}/events` | **200** `text/event-stream`; 14 event (`message.delta` ×13 + `run.completed`), `: open` / `: stream closed` |
| `Last-Event-ID: 7` | Server mengirim ulang **id 8–13 saja** → **dukungan Last-Event-ID TERVERIFIKASI** (sebelumnya ditandai unverified) |
| Terminal event | `run.completed` dengan `completed:true, partial:false, interrupted:false`, output teks penuh |

## 3. Alur penuh lewat aplikasi (bukan simulasi)

1. Login Director melalui `https://studio.bangron.my.id/api/auth/login` (cookie `bvo_session` + CSRF).
2. `POST /api/tasks` → `task_mwyctoyvb9ace895a33b` — "G6.4 Live Runtime Verification — Read-Only Probe", instruksi eksplisit read-only.
3. `POST /api/tasks/{id}/assign` → `agentId=inst_hermes_default`.
4. `task.service.assignAgent` → `hermesAdapter.dispatchTaskInstruction` → `POST /v1/runs`.
5. `hermes_run_id = run_73b35a5fc69b4472bd271fc453c40ddc` tersimpan di `agent_tasks`.
6. `hermesEventBridge.registerRunTaskMapping` + `startPolling` → SSE `GET /v1/runs/{id}/events`.
7. **32 event** (`agent.execution.step` ×31 + `agent.execution.ended` ×1) masuk `agent_events`, semua `processing_status=processed`.
8. Terminal: `agent.execution.ended` → task **`completed`**, `result_summary="Completed successfully"`, `completed_at=2026-11-27T02:20:42.184Z`.
9. Journal: `Terminal event detected, stopping poll` → `SSE event polling stopped` (poll dihentikan bersih, tidak reconnect).
10. Output Hermes nyata: "Hermes Agent aktif dan siap menerima tugas, dengan seluruh layanan ... dalam keadaan normal dan tanpa ada perubahan".

## 4. Temuan sampingan

- **Temuan sampingan (SUDAH DIPERBAIKI):** agent sempat tetap `queued` setelah task selesai — normalizer tidak mengisi `instance_id` pada event SSE. Fix di commit `27a13fb`: `StateReconciler` kini me-resolve `instance_id` dari `assigned_agent_id` task bila event tidak membawa identitas eksplisit (event dengan `instance_id` eksplisit tidak boleh dialihkan). Diverifikasi live: `Resolved agent identity from assigned task` → task `task_mwyd6uzj66518560c80f` `completed`, agent `inst_hermes_default` **`idle`**. Test: `tests/unit/g6-identity-from-task.test.js` (2 pass), suite 244/244.
- `HERMES_RUNTIME_VERIFIED` kini `true`; docs yang menyatakan "must be false (gate closed)" adalah teks rencana pra-verifikasi dan tidak lagi berlaku.

## 5. Kesimpulan

Alur **task → dispatch → run_id → SSE → normalisasi → rekonsiliasi → terminal state** terbukti berfungsi terhadap **runtime Hermes live**, bukan webhook simulasi. Kedua item yang sebelumnya ditandai unverified di `G6.1_FINAL_TECHNICAL_REVIEW.md` — API contract & live runtime — kini terverifikasi. **Gate G6: CLOSED.**
