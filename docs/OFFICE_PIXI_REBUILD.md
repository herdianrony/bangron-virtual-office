# Office Page — PixiJS-first Rebuild (2026-11-27)

Branch `fix/realtime-g6-apply` — HEAD `15f309d`, pushed, clean.

## Arsitektur baru

Sebelumnya: SVG menggambar arsitektur + layer PixiJS terpisah hanya untuk
agen (dua canvas, dua transform, hit-test SVG). Sekarang:

**`public/assets/js/office/pixi-office-scene.js`** — satu `Application` PixiJS v8
menggambar seluruh kantor:
- `floor`, `corridor`, `room`, `furniture`, `label`, `agent`, `fx` (7 layer)
- ruang diwarnai per department, dinding + pintu dengan `DOOR_GAP`
- furnitur per `workstation_type` (desk, conference_table, terminal, dll.)
- label ruang, avatar agen (body/head/face/halo/name tag), night veil
- `pick(clientX, clientY)` → agen / ruang / koridor / furnitur (hit-test math)

**Kontrak yang dipertahankan** (sesuai instruksi "sesuaikan kontrak"):
`init(host)`, `setState({rooms,workstations,corridors,building})`,
`setAgents(agents)`, `applyCamera({panX,panY,scale})`, `setNight(bool)`,
`resize()`, `pick()`, `destroy()`.

`CameraController` tetap dipakai untuk logika pan/zoom/follow, tapi
`onTransformChange` kini mengirim transform ke scene PixiJS. Metode lama
`renderStaticLayers()` / `addFurnitureHitTest()` jadi no-op agar kompatibel.

## Layout

Sumber kebenaran tetap `src/services/office-layout.js` (14 ruang, 4 koridor,
15 workstation) lewat `/api/virtual-office/state`. Tidak ada hardcoding layout
baru — scene menggambar persis data kanonik backend.

## Perubahan terkait

- `office-view.js`: hapus SVG canvas, `pixiAgentLayer`, SVG hit-test; pakai
  `PixiOfficeScene` untuk render, tooltip, inspector, dan klik.
- `office.css`: host canvas baru `#office-scene-host`.
- `pixi-office-scene.test.js`: test `doorPoint()` untuk 4 sisi pintu.
- Avatar & label ruang diperbesar agar terbaca saat `scale` kecil (viewport 780px).
- Toast login dipendekkan ke 2.5 detik agar tidak menutupi kanvas.

## Verifikasi

- `npm test`: **259 passed / 0 failed** (31 file) — termasuk
  `svg-attribute-validation` & `movement-engine-dt` yang tetap hijau
- Browser: `#/office` → **1 canvas PixiJS, 0 SVG**, 12 agen, 14 ruang,
  status `12 / 14 / LIVE`, avatar (lingkaran berwarna + label nama) terlihat
  di ruangan, label ruang terbaca, console error 0
- Scene module dapat di-import dan prototype lengkap
- Service active, hash kata sandi director dikembalikan, local == remote
