# Office — Rumah Studio Visual Redesign (2026-11-27)

Branch `fix/realtime-g6-apply` — HEAD `c45a1d1`, pushed, clean.

## Kenapa sebelumnya tidak diimprovisasi

Saya awalnya hanya memindahkan renderer ke PixiJS dengan geometri kanonik.
Kemudian denah diimprovisasi menjadi Rumah Studio, dan sistem dua tema
saya buang sesuai permintaan — sekarang satu layout saja. Alasannya: koordinat ruang dipakai `navigation.js`
(pathfinding koridor), seed DB, demo engine, dan tes. Mengubah visual saja
tanpa adapter akan membuat avatar/furnitur tidak selaras dengan pintu & rute.
Itu terlalu konservatif untuk permintaan "rombak total".

## Solusi: visual layout adapter

`public/assets/js/office/visual-layout.js` mendefinisikan **Rumah Studio**,
satu-satunya denah 1148×748 dengan:
- palet kayu hangat + grid halus, nuansa rumah studio rintisan
- 14 ruang dengan label rumah: Garasi Koding, Dapur & Kopi, Ruang Keluarga,
  Meja Makan, Sudut Desain, Rak Uji, Rak Riset, Sudut Konten, Perpustakaan,
  Sofa Santai, Studio Kreatif, Teras Depan, Rak Server, Ruang Kerja
- 3 koridor (`corr_main`, `corr_south`, `corr_cross`)
- furnitur abu-abu transparan per `workstation_type`
- tombol ganti tema dihapus; status HUD dipindah agar tidak tertutup ribbon

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
