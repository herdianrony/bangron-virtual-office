# Mulai Di Sini — Jalankan di Komputer Lokal

Panduan singkat menjalankan **Bangron Virtual Office** di komputer Anda sendiri.

---

## 1. Prasyarat

- **Node.js versi 20 atau lebih baru** (LTS disarankan) — cek dengan `node -v`
- npm (ikut paket Node.js)
- Tidak perlu database eksternal: semuanya berjalan di SQLite lokal.

## 2. Instalasi & Menjalankan

```bash
# masuk ke folder proyek hasil unzip
cd bangron-virtual-office

# pasang dependensi (sekali saja)
npm install

# jalankan server
npm start
```

Buka browser ke **http://localhost:3000** lalu login sebagai Direktur:

| Field    | Nilai                    |
|----------|--------------------------|
| Email    | `director@bangron.office`|
| Password | `DirectorPass123!`       |

> **Database demo sudah disertakan** (`storage/database/bangron-virtual-office.sqlite`),
> jadi begitu server jalan Anda langsung melihat kantor dengan 7 agen demo,
> tugas, approval, dan auto-play — persis seperti tampilan preview.
>
> **Fitur Denah Atas (Helikopter)**: klik tombol **"Denah Atas"** di panel kanan office
> untuk melihat denah kantor realistis dari atas — koridor terazzo, 14 ruangan ukuran
> bervariasi (termasuk **Perpustakaan** dan **Ruang Kopi**), pintu ber-engsel, jam dinding,
> dan mode siang/malam (tombol bulan/matahari). Agen berjalan mengikuti koridor lewat
> waypoint navigation — tidak pernah menembus dinding — dan saat **idle** mereka
> menyempatkan diri ke Ruang Kopi, Perpustakaan, atau Lounge sofa.
>
> **Pergerakan natural**: setiap agen berjalan di **lajur kiri koridor** seperti orang
> sungguhan (offset lajur unik per agen, arah berlawanan saling berpapasan di lajur
> berbeda), lengkap dengan **animasi langkah kaki** — dua sepatu melangkah bergantian
> mengikuti arah jalan, digambar oleh mesin **PixiJS (WebGL)**.
>
> Ingin mulai dari kosong? Hapus file tersebut lalu jalankan:
> ```bash
> npm run migrate
> npm run seed
> ```
> (opsi `npm run seed` membuat ulang layout kantor + akun Direktur + agen demo;
> jalankan tanpa demo dengan mengikuti catatan di `README.md`.)

Ganti port di `.env` (`PORT=3000`) bila 3000 sudah dipakai aplikasi lain.

## 3. Menghubungkan Hermes Agent

Office ini menerima **Outbound Webhooks** dari Hermes Agent (Nous Research).

### a. Jika Hermes berjalan di komputer yang sama

Arahkan `~/.hermes/config.yaml`:

```yaml
hooks:
  outbound:
    - name: bangron-office
      url: http://localhost:3000/api/integrations/hermes/events
      events: [on_session_start, on_session_end, pre_llm_call, pre_tool_call, post_tool_call, subagent_start, subagent_stop]
      secret_env: HERMES_OUTBOUND_WEBHOOK_SECRET
      timeout: 10
```

Lalu di `~/.hermes/.env` mesin Hermes:

```
HERMES_OUTBOUND_WEBHOOK_SECRET=bangron-hermes-webhook-secret-key-2026
```

(nilai harus **sama** dengan `HERMES_WEBHOOK_SECRET` di `.env` office)

### b. Jika Hermes berjalan di server lain (mis. hermes.bangron.my.id)

Server Hermes harus bisa mengirim POST ke komputer lokal Anda. Pilih salah satu:

- **Tunnel**: `cloudflared tunnel --url http://localhost:3000` atau `ngrok http 3000`,
  lalu pakai URL publik yang dihasilkan sebagai `url` webhook.
- **Port forwarding** di router + DDNS.
- **Deploy office di server yang sama dengan Hermes** (proyek ini mandiri:
  `npm install && npm start` di belakang nginx/caddy).

### c. Memunculkan agen dengan nama asli

**Cara otomatis (tanpa konfigurasi tambahan):** begitu event pertama dari sebuah
profil Hermes masuk, office otomatis membuat agen dengan nama profil tersebut,
menempatkannya di ruang kerja yang sesuai, dan avatar langsung muncul.

**Cara manual (mendaftar lebih dulu):**

```bash
node scripts/register-hermes-agents.js "Nama Agen Asli 1" "Nama Agen Asli 2"
# contoh dengan ruang khusus:
node scripts/register-hermes-agents.js --department=Development "Koder Backend"
```

Skrip ini membaca `HERMES_WEBHOOK_SECRET` dari `.env` dan menandatangani request
dengan HMAC — sama seperti yang dilakukan Hermes.

## 4. Endpoint Penting

| Endpoint | Fungsi |
|---|---|
| `POST /api/integrations/hermes/events` | Ingest webhook Hermes (HMAC `X-Hermes-Signature-256`) |
| `POST /api/integrations/hermes/agents` | Registrasi agen nama asli (HMAC, idempoten, maks 50/panggilan) |
| `GET /api/integrations/hermes/status` | Status runtime + 10 event terakhir |
| `WS /ws` | Realtime office state (avatar, status, aktivitas) |

Detail lengkap kontrak integrasi: `docs/HERMES-INTEGRATION.md`.

## 5. Keamanan (wajib dibaca untuk pemakaian serius)

- Ganti `SESSION_SECRET` dan `HERMES_WEBHOOK_SECRET` di `.env`
  (jangan pakai nilai default di tempat publik/internet).
- Ganti password Direktur lewat UI setelah login pertama.
- Office hanya perlu di-expose ke internet bila Hermes di luar mesin —
  jika tidak, biarkan `localhost` saja.
- Rate limit webhook: 1200 request/menit; anti-replay ±5 menit.

## 6. Troubleshooting Cepat

| Gejala | Solusi |
|---|---|
| `npm install` gagal pada `better-sqlite3` | Pastikan Node 20+; di Windows jalankan terminal sebagai admin atau pasang build tools; atau gunakan WSL |
| Webhook ditolak `INVALID_SIGNATURE` | Secret Hermes ≠ `HERMES_WEBHOOK_SECRET` office |
| Webhook ditolak `TIMESTAMP_DRIFT` | Jam server Hermes tidak akurat (sinkronkan NTP) |
| Avatar tidak muncul | Cek `GET /api/integrations/hermes/status` — bagian `recentEvents` |
| Test suite | `npm test` (25 unit test) |

## 7. Tampilan Office — Denah Atas + PixiJS

Halaman **Office** menampilkan satu mode tampilan: **Denah Atas** (denah helikopter
2D — lantai kayu, pintu dengan arc ayun, tanaman, jam dinding waktu nyata, kompas).
Tampilan isometrik 2.5D sudah dihapus sejak v1.5.

Arsitektur render (v1.5):

| Lapisan | Mesin | Isi |
|---|---|---|
| Arsitektur statis | SVG | Ruangan, koridor, dinding, pintu, perabot, dekorasi |
| Agen dinamis | **PixiJS (WebGL)** | Avatar, kaki melangkah, halo status, tag nama, bubble |

Kedua lapisan disinkronkan kamera (pan/zoom/follow) piksel-demi-piksel. Preferensi
mode siang/malam tersimpan otomatis di browser.

Tersedia juga **tombol bulan/matahari** (dan klik pada lampu gantung di denah) untuk
ganti **mode siang ↔ malam**: lampu ruangan menyala hangat, layar monitor berpendar,
dan suasana kantor berubah.
