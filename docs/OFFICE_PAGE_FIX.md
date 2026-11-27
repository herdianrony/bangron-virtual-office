# Office Page — Fix & Adjustment (2026-11-27)

Branch `fix/realtime-g6-apply` — HEAD `4ffcb8e`, pushed, clean.

## Masalah yang ditemukan & diperbaiki

1. **Toast menutup navbar** — `toast-root` memakai kelas `top-4` yang tidak
   ter-generate di bundle Tailwind (computed `0px`). Sekarang posisi dipaksa
   via inline style `top: 5rem` (80px), navbar berakhir di 64px → tidak
   bertumpuk. Juga diperbarui saat container sudah ada dari halaman lain.
2. **CSS rusak** — blok deklarasi `.bottom-ticker` kehilangan selector,
   menyebabkan aturan posisi bocor. Selector dikembalikan.
3. **Demo ribbon terlalu lebar di tablet** — judul "Simulated Multi-Agent
   Pipeline" disembunyikan di bawah `xl`, menyisakan badge + tombol saja.
4. **HUD kontrol putih besar** — wrapper `div.tooltip` menggantikan
   `join-item` sehingga layout join rusak. Tooltip kini langsung di tombol
   (`btn join-item tooltip tooltip-left`) dan panel dibuat transparan.
5. **Canvas office terlalu kecil / tertutup HUD** — `fitBounds` naik dari
   `fillRatio 0.92` → `0.98`, dengan reservasi 90px (desktop) / 40px
   (tablet) untuk HUD kanan.
6. **Status realtime tidak terlihat** — HUD status baru dengan DaisyUI
   `badge`: jumlah agen, jumlah ruang, dan `LIVE`/`OFFLINE`, di-update dari
   store (`agents_loaded`, `agent_updated`, `state_updated`,
   `runtime_status_changed`).
7. **Service Worker cache lama** — `CACHE_NAME` dinaikkan `v2 → v3` agar
   aset JS/CSS baru langsung dipakai klien.

## Komponen DaisyUI di Office

`card` (ribbon, inspector, ticker), `badge` (status, event type, websocket),
`btn` variants, `join`/`join-vertical`, `tooltip`, `avatar` (inspector),
`alert` (ticker), `loading`, `dropdown` (nav), `indicator` (pending badge).

## Verifikasi

- `npm test`: **257 passed / 0 failed** (30 file)
- Browser: `#/office` → 1 canvas PixiJS, 12 agen, 14 ruang, status
  `12 / 14 / LIVE`, 9 tombol HUD, 5 join-item, toast `top=80px` vs navbar
  `bottom=64px`, ribbon title `display:none` di viewport 780px
- Service `bangron-virtual-office.service` active
- Hash kata sandi director dikembalikan ke nilai asli
- local == remote (`4ffcb8e`), working tree clean
