# Hermes API Server + DaisyUI Maximization (2026-11-27)

Branch `fix/realtime-g6-apply` — HEAD `4a2133b`, pushed, clean.

## API Server Hermes — permukaan yang dipakai

| Endpoint | Pemakaian di control plane |
|---|---|
| `/v1/models` | runtime status, daftar model |
| `/v1/capabilities` | feature flags, gating approval/clarify/resolve, badges UI |
| `/api/model/options` | 625 model + provider (curated), ditampilkan 30 teratas di Settings |
| `/health/detailed` | readiness card di Settings |
| `/api/sessions` | daftar sesi API-server, tabel Sessions |
| `/api/jobs` (GET/POST/DELETE, `run\|pause\|resume`) | proxy director + tabel Jobs & form create |
| `/v1/runs` POST/GET/events/stop | dispatch, run_id, SSE, terminal reconciler (sebelumnya) |
| `/v1/runs/{id}/approval`, `/clarify`, `/resolve-unknown` | adapter methods, capability-gated |
| `/p/<profile>/v1/...` | 10 kunci profil terprovisi, 10/10 prefix 200 |

Middleware: semua endpoint baru `authenticate + requireDirector`; Hermes tetap
source of truth, office hanya proxy.

## DaisyUI — komponen yang dipakai

- **Settings (rewrite):** `tabs` (6 panel), `stats/stat` (4 KPI), `table table-zebra`
  (Models/Sessions/Jobs), `join` (endpoint inputs, tombol, aksi job), `tooltip`
  (30 capability badges), `badge`, `alert`, `collapse` (job form), `loading`,
  `divider`, `btn` variants, `select`, `checkbox`. Export JSON + copy-to-clipboard.
- **Activities (rewrite):** `timeline timeline-vertical timeline-compact` (50 entry),
  `timeline-box`, `avatar`, `badge`, `alert`, `loading`.
- **Dashboard:** `stats/stat`, `badge`, `table`, `progress`, `alert`.
- **Agents:** `join`, `badge`, `stats`, `avatar`.
- **Nav:** `dropdown`, `indicator` (menu ringkas 7 item).

## Verifikasi

- `npm test`: **257 passed / 0 failed** (30 files)
- Browser: Settings 6 tabs / 4 stats / 3 tables / 30 caps / runtime `CONNECTED` /
  health `OK`; Activities 50 timeline entries; console errors 0
- Model table dibatasi 30 baris + catatan total 625 (performa)
- Service active, hash password director dikembalikan, local == remote
