# Deploy TARBIYAH di Coolify

Image dibangun oleh GitHub Actions (`.github/workflows/docker.yml`) dan disimpan di GHCR. Server
Coolify **hanya menarik dan menjalankan** image — tidak pernah build.

| Pemicu | Image | Deploy |
| --- | --- | --- |
| push ke `main` | `ghcr.io/<owner>/tarbiyah:main` | webhook staging |
| tag `v1.2.3` | `ghcr.io/<owner>/tarbiyah:1.2.3` dan `:1.2` | webhook production |

## Staging

### 1. Database

Di resource PostgreSQL 17 (lihat Persiapan di rancangan), buat database `tarbiyah_staging` dengan
user sendiri. Catat connection string internalnya, mis.
`postgres://tarbiyah_staging:<password>@<nama-service-postgres>:5432/tarbiyah_staging`.

### 2. Akses Coolify ke GHCR (registry privat)

1. Di GitHub: **Settings → Developer settings → Personal access tokens → Tokens (classic)**, buat
   token dengan scope **`read:packages`** saja.
2. Di server, sebagai user yang menjalankan Docker untuk Coolify:
   `docker login ghcr.io -u <username-github>` lalu tempel token sebagai password.
   (Atau, bila versi Coolify Anda punya menu registry, tambahkan `ghcr.io` di sana.)

### 3. Buat aplikasi

1. Coolify → **+ New → Docker Image**.
2. Image: `ghcr.io/<owner>/tarbiyah:main`.
3. Port yang diekspos: **3000**.
4. Domain: `https://staging.<domain>`.
5. Network: hubungkan ke jaringan Docker yang sama dengan PostgreSQL (dan nanti GOWA & noken-pay).

### 4. Environment variables

| Nama | Isi staging | Catatan |
| --- | --- | --- |
| `NODE_ENV` | `staging` | `production` untuk production (seed ditolak) |
| `APP_URL` | `https://staging.<domain>` | tanpa garis miring di akhir |
| `DATABASE_URL` | connection string langkah 1 | alamat internal |
| `APP_ENCRYPTION_KEY` | hasil `openssl rand -base64 32` | tandai **secret**; simpan juga di pengelola password. Staging & production **berbeda** |
| `TURNSTILE_SITE_KEY` | dari widget Turnstile | |
| `TURNSTILE_SECRET_KEY` | dari widget Turnstile | tandai secret |
| `TRUST_CLOUDFLARE` | `true` | **wajib** `true`, dan port 80/443 server hanya menerima IP Cloudflare (lihat catatan) |
| `SEED_ADMIN_PHONE` | nomor admin awal | dipakai oleh seed (langkah 8) |
| `SEED_ADMIN_PASSWORD` | password sementara | tandai secret; ganti setelah login pertama |

> **Catatan IP klien.** Di belakang Traefik, alamat socket yang terlihat aplikasi adalah IP Traefik.
> Tanpa `TRUST_CLOUDFLARE=true` semua pengguna dianggap satu IP, sehingga 30 kali gagal login dalam
> 15 menit (dari siapa pun) mengunci login semua orang. Sebaliknya, bila `TRUST_CLOUDFLARE=true` tetapi
> server bisa diakses langsung tanpa Cloudflare, header IP bisa dipalsukan. Jadi keduanya harus
> dipasang bersama. Aplikasi menulis `PERINGATAN:` di log saat start bila konfigurasi ini belum benar.
>
> Kunci **uji** Turnstile (`1x0000…`) ditolak di production dan memberi peringatan di staging.

Sudah diisi oleh image (tidak perlu diubah): `PORT=3000`, `DATA_DIR=/data`, `TZ=Asia/Jayapura`,
`NODE_OPTIONS=--max-old-space-size=384`, `APP_VERSION=<commit SHA>`.

### 5. Penyimpanan & sumber daya

- **Persistent storage**: volume ke path container **`/data`** (logo, lampiran, backup lokal).
- **Batas memori**: 384 MB untuk staging (production 512 MB). Di Coolify: *Resource Limits →
  Maximum Memory Limit*.
- **Health check**: image sudah punya `HEALTHCHECK` ke `/api/health`. Bila Coolify meminta isian:
  path `/api/health`, port `3000`.

### 6. Webhook deploy

1. Di aplikasi staging Coolify: **Webhooks** → salin *Deploy Webhook* URL.
2. Coolify → **Keys & Tokens → API tokens**: buat token dengan izin *deploy*.
3. Di GitHub repo: **Settings → Secrets and variables → Actions**, tambahkan:
   - `COOLIFY_WEBHOOK_STAGING` = URL webhook staging
   - `COOLIFY_TOKEN` = API token Coolify
4. Push ke `main` → workflow *Docker* build & push image lalu memanggil webhook.
   Selama secret belum diisi, langkah deploy dilewati (workflow tetap hijau).

### 7. Cek

- `https://staging.<domain>/api/health` → `{"ok":true, "db":true, "boss":true, ...}` dan `versi`
  sama dengan commit terakhir.
- Log container: `Menjalankan migrasi…` lalu `TARBIYAH <sha> berjalan di port 3000`.
- Status health di Coolify hijau.
- Pasang cek uptime (mis. UptimeRobot) ke `/api/health`.

### 8. Admin awal

Setelah container staging berjalan, buka **Terminal** container di Coolify lalu jalankan:

```bash
node dist/server/db/seed.js
```

Seed memakai `SEED_ADMIN_PHONE` dan `SEED_ADMIN_PASSWORD`, aman dijalankan ulang (admin yang sudah
ada dilewati), dan **ditolak** bila `NODE_ENV=production`. Masuk dengan nomor itu; aplikasi langsung
meminta password baru.

**Data contoh (opsional, hanya staging):** `node dist/server/db/seed.js --contoh` mengisi 2 lokasi,
3 unit, 12 kelas, ±200 santri, ±300 wali, guru, mapel, dan pengajaran. Semua akun contoh berpassword
`contoh123` dengan nomor `628000…` (bukan nomor WA sungguhan). Beranda menampilkan tanda "DATA CONTOH".
Jangan dipakai di database yang akan berisi data asli.

## Production

Langkah lengkap dilengkapi di M7. Untuk **admin pertama** di production (seed ditolak di sana),
buka Terminal container lalu jalankan:

```bash
node dist/server/db/admin-awal.js 0812xxxxxxxx
```

Perintah ini hanya berhasil bila **belum ada admin aktif**, mencetak password sementara sekali ke
terminal, dan password itu wajib diganti saat login pertama. Admin berikutnya dibuat dari halaman
Pengguna.
