# Office — Studio Loft Visual Redesign (2026-11-27)

Branch `fix/realtime-g6-apply` — HEAD `c45a1d1`, pushed, clean.

## Kenapa sebelumnya tidak diimprovisasi

Saya hanya memindahkan renderer ke PixiJS, tapi mempertahankan geometri kanonik
backend apa adanya. Alasannya: koordinat ruang dipakai `navigation.js`
(pathfinding koridor), seed DB, demo engine, dan tes. Mengubah visual saja
tanpa adapter akan membuat avatar/furnitur tidak selaras dengan pintu & rute.
Itu terlalu konservatif untuk permintaan "rombak total".

## Solusi: visual layout adapter

`public/assets/js/office/visual-layout.js` mendefinisikan **Studio Loft**,
denah baru 1148×748 dengan:
- latar navy `0x0f172a` + grid halus (control-room look)
- 14 ruang sudut membulat, aksen warna per departemen, label uppercase +
  sub-label departemen, titik aksen
- 3 koridor biru (`corr_main`, `corr_south`, `corr_cross`)
- furnitur abu-abu transparan per `workstation_type`

`mapToVisual(x, y, rooms, bounds)` memetakan koordinat kanonik ke denah baru:
titik di dalam ruang dipetakan proporsional ke rekt ruang visual; titik koridor
diskalakan linear. Jadi **backend tetap source of truth** (navigasi, rute,
posisi agen tidak berubah) sementara tampilan bebas didesain ulang.

`PixiOfficeScene` sekarang:
- `getBounds()` → `VISUAL_BOUNDS`, dipakai `CameraController.fitBounds()`
- ruang/furnitur/agen digambar dari denah visual
- avatar dipetakan lewat `mapToVisual()` setiap frame
- `nightVeil` tema gelap

## Verifikasi

- `npm test`: **263 passed / 0 failed** (32 file) — termasuk test baru
  `visual-layout.test.js` (4 test mapping) dan semua test lama tetap hijau
- Browser: 1 canvas PixiJS, 0 SVG, 12 agen, 14 ruang, status `LIVE`,
  konsol error 0. Screenshot: denah gelap, ruang membulat berlabel, koridor
  biru, avatar & furnitur terlihat — lebih rapi dari desan lama.
- SW cache `v3 → v4`, `visual-layout.js` terdaftar
- Service active, hash password director dikembalikan, local == remote
