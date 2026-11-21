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

Production memakai image **bertag versi** (bukan `main`), database sendiri, dan domain pondok.
Langkah di bawah dijalankan oleh pemilik proyek; aplikasi tidak pernah men-deploy dirinya sendiri.

### 1. Database production

Di resource PostgreSQL 17 yang sama, buat database `tarbiyah` dengan user sendiri (bukan user
staging). Connection string internal:
`postgres://tarbiyah:<password>@<nama-service-postgres>:5432/tarbiyah`.

### 2. Aplikasi

1. Coolify → **+ New → Docker Image**, image `ghcr.io/<owner>/tarbiyah:1.0` (tag mayor.minor
   rilis pertama; lihat *Rilis* di bawah).
2. Port **3000**, domain `https://<domain-pondok>` (mis. `https://app.pondok.sch.id`).
3. Network: jaringan Docker yang sama dengan PostgreSQL, GOWA, dan noken-pay.
4. **Persistent storage**: volume ke **`/data`**. Volume ini berisi lampiran dan dump backup;
   jangan dihapus saat redeploy.
5. **Batas memori: 512 MB** (*Resource Limits → Maximum Memory Limit*). `NODE_OPTIONS` di image
   sudah membatasi heap 384 MB.
6. Environment variables sama seperti staging, dengan perbedaan:

   | Nama | Production |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `APP_URL` | `https://<domain-pondok>` |
   | `DATABASE_URL` | database langkah 1 |
   | `APP_ENCRYPTION_KEY` | kunci **baru** (`openssl rand -base64 32`), bukan kunci staging |
   | `TURNSTILE_*` | widget Turnstile untuk domain production (kunci uji ditolak) |
   | `SEED_ADMIN_*` | **jangan diisi** (seed ditolak di production) |

   Simpan `APP_ENCRYPTION_KEY` di pengelola password. Tanpa kunci ini, password GOWA, kunci
   noken-pay, dan kunci B2 di Pengaturan tidak bisa dibuka setelah pemulihan ke server baru.
7. Webhook deploy production: salin URL webhook aplikasi production ke GitHub Secret
   `COOLIFY_WEBHOOK_PRODUCTION`.
8. Admin pertama: Terminal container →

   ```bash
   node dist/server/db/admin-awal.js 0812xxxxxxxx
   ```

   Hanya berhasil bila belum ada admin aktif; password sementara dicetak sekali dan wajib diganti
   saat login pertama. Buat **minimal 2 admin** (admin kedua dari halaman Pengguna).

### 3. Rilis dengan tag `v*`

Rilis = tag Git berformat `vMAYOR.MINOR.PATCH` pada commit yang sudah lolos uji di staging:

```bash
git tag v1.0.0
```

```bash
git push origin v1.0.0
```

Workflow *Docker* membangun `ghcr.io/<owner>/tarbiyah:1.0.0` dan `:1.0` lalu memanggil webhook
production. Pasang image aplikasi production dengan tag **`:MAYOR.MINOR`** (mis. `:1.0`): rilis
patch (`v1.0.1`) otomatis ter-deploy lewat webhook, sedangkan rilis minor/mayor (`v1.1.0`) baru
dipakai setelah Anda mengganti tag image di Coolify ke `:1.1` lalu Deploy. Migrasi database
berjalan otomatis saat container start.

Sebelum rilis: buat **backup manual** dari halaman Sistem › Backup production.

### 4. Rollback

1. Coolify → aplikasi production → ganti image ke tag versi sebelumnya yang persis (mis.
   `:1.0.2`) → **Deploy**.
2. Migrasi Drizzle hanya maju. Bila versi baru sudah menambah migrasi yang tidak cocok dengan
   versi lama, pulihkan juga database dari backup **sebelum** rilis (Sistem › Backup › Pulihkan;
   aplikasi menolak dump dari skema yang lebih baru daripada aplikasinya).

### 5. Backblaze B2

1. Buat bucket **privat**, mis. `pondok-backup`. Catat endpoint S3-nya
   (`https://s3.<region>.backblazeb2.com`) dan region-nya (mis. `us-east-005`).
2. Buat **dua application key**, keduanya hanya untuk bucket itu dan **tanpa izin hapus**
   (centang hanya *Read and Write*, lalu pastikan `deleteFiles` tidak ada; bila memakai CLI:
   `listBuckets,listFiles,readFiles,writeFiles`):
   - `tarbiyah-app`, *File name prefix* `tarbiyah/` → diisi di TARBIYAH (Sistem › Backup).
   - `coolify-db`, *File name prefix* `coolify/` → diisi di Coolify (lapis 2).
3. **Lifecycle rules** bucket (satu-satunya yang menghapus backup lama):

   | Prefix | Hapus setelah | Keterangan |
   | --- | --- | --- |
   | `tarbiyah/db/` | 90 hari | *daysFromUploadingToHiding* 90, *daysFromHidingToDeleting* 1 |
   | `coolify/` | 90 hari | idem |
   | `tarbiyah/tes-koneksi` | 1 hari | objek uji tombol "Tes koneksi" |
   | `tarbiyah/files/` | tidak pernah | berkas lampiran & logo |

4. Akun B2 → **Caps & Alerts**: pasang batas pengeluaran harian kecil.

### 6. Backup lapis 1 — dari aplikasi

Sistem › Backup & restore (admin):

1. Isi endpoint, region, bucket, key ID, dan application key `tarbiyah-app`, centang *Salin ke B2*,
   simpan, lalu **Tes koneksi B2** (menulis, membaca, dan mendaftar satu objek uji).
2. Interval default 7 hari (cek setiap pukul 02.00 waktu sekolah), 10 dump terakhir disimpan di
   `/data/backups`. Berkas baru disalin ke `tarbiyah/files/` tiap jam dan setelah setiap backup.
3. Tekan **Backup sekarang** sekali, lalu pastikan di B2 ada `tarbiyah/db/tarbiyah-….dump` dan
   `.json`, dan di dashboard admin muncul "Terakhir berhasil …".
4. Gagal backup atau salin berkas → notifikasi ke semua admin.

### 7. Backup lapis 2 — Postgres dari Coolify

Coolify → resource PostgreSQL → **Backups**:

1. *S3 storage*: tambahkan B2 (endpoint, region, bucket) dengan key `coolify-db`, path/prefix
   `coolify/`.
2. Jadwal harian (mis. `0 1 * * *`) untuk database `tarbiyah` **dan** database noken-pay.
3. **Retensi S3 = 0** (tanpa batas: penghapusan diurus lifecycle rules, karena kuncinya memang tidak
   boleh menghapus). Retensi lokal boleh 7.
4. Aktifkan notifikasi Coolify (email/Telegram) untuk *backup failed* dan *deployment failed*.

### 8. Pemantauan

- Cek uptime gratis (UptimeRobot / Better Stack) ke `https://<domain>/api/health` tiap 5 menit;
  status 503 berarti database atau antrean bermasalah.
- Notifikasi Coolify: *deployment failed*, *container stopped/unhealthy*, *backup failed*.
- Dashboard admin TARBIYAH menampilkan backup terakhir yang berhasil dan jumlah berkas yang belum
  tersalin ke B2.

### 9. Firewall & Cloudflare

- SSH hanya dengan kunci (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`).
- **Docker melewati `ufw`** untuk port yang dipublikasikan container: aturan `ufw deny 8000` tidak
  berlaku, port tetap terbuka. Port container yang tidak boleh dibuka dari internet ditutup di
  rantai `DOCKER-USER`. Di rantai itu port sudah diterjemahkan ke port container (mis. 8000 → 8080),
  jadi cocokkan port asal dengan `conntrack --ctorigdstport`, bukan `--dport`. `--ctdir ORIGINAL`
  memastikan balasan koneksi keluar dari container tidak ikut terblokir. Sesuaikan interface publik
  (`ip route get 1.1.1.1`) dan daftar port (`ss -tlnp`).
- Uji dulu dengan pembatalan otomatis 10 menit (aturan hilang sendiri bila ada yang rusak):

  ```bash
  for p in 8000 6001 6002 8080 8123; do iptables -I DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport $p --ctdir ORIGINAL -j DROP; ip6tables -I DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport $p --ctdir ORIGINAL -j DROP 2>/dev/null; done; (sleep 600; iptables -F DOCKER-USER; ip6tables -F DOCKER-USER 2>/dev/null) &
  ```

  Setelah dashboard Coolify (termasuk log langsung & terminal) dan semua aplikasi lewat domain
  terbukti normal, simpan permanen lewat `ufw` (dimuat sebelum Docker saat boot):

  ```bash
  for f in after.rules after6.rules; do printf '\n# BEGIN tarbiyah: tutup port container dari internet\n*filter\n:DOCKER-USER - [0:0]\n' >> /etc/ufw/$f; for p in 8000 6001 6002 8080 8123; do echo "-A DOCKER-USER -i eth0 -p tcp -m conntrack --ctorigdstport $p --ctdir ORIGINAL -j DROP" >> /etc/ufw/$f; done; printf 'COMMIT\n# END tarbiyah\n' >> /etc/ufw/$f; done; ufw reload
  ```

  Uji dari mesin lain: `timeout 5 bash -c "</dev/tcp/<IP-server>/8000"` harus gagal.
- **Hanya Tarbiyah** yang dibatasi ke IP Cloudflare (syarat `TRUST_CLOUDFLARE=true`; tanpa ini
  orang yang tahu IP server bisa memalsukan `CF-Connecting-IP` untuk mengakali batas percobaan
  login per IP). Jangan batasi 80/443 untuk seluruh server bila ada aplikasi lain yang DNS-only.
  Caranya lewat label Traefik di aplikasi Tarbiyah (Coolify › Configuration › General › Container
  Labels). Ambil daftar IP terbaru:

  ```bash
  curl -s https://www.cloudflare.com/ips-v4 https://www.cloudflare.com/ips-v6 | paste -sd, -
  ```

  Tambahkan label `traefik.http.middlewares.tarbiyah-cf.ipallowlist.sourcerange=<daftar di atas>`
  dan tambahkan `tarbiyah-cf` ke label `traefik.http.routers.https-0-<uuid>.middlewares` yang sudah ada
  (pisahkan dengan koma), lalu redeploy. Uji langsung ke IP, melewati Cloudflare:

  ```bash
  curl -sk -o /dev/null -w '%{http_code}\n' --resolve <domain>:443:<IP-server> https://<domain>/api/health
  ```

  Hasil harus **403**, sedangkan `https://<domain>` lewat Cloudflare tetap 200. Perbarui daftar IP
  bila Cloudflare mengubahnya.
- Cloudflare: SSL **Full (strict)** (sebelum awan oranye dinyalakan), *Always Use HTTPS*, WAF
  bawaan aktif, *Bot Fight Mode* mati (bisa memblokir webhook). Jangan proksikan hostname untuk
  SSH, VPN, RADIUS, atau API MikroTik (bukan HTTP).
- Update OS & Coolify rutin.

### 10. Pemulihan ke server baru dari B2

Bila server hilang:

1. Siapkan VPS + Coolify + PostgreSQL 17 seperti awal, buat database kosong `tarbiyah`.
2. Deploy aplikasi production dengan **`APP_ENCRYPTION_KEY` yang sama** (dari pengelola password)
   dan volume `/data` baru yang kosong.
3. Buat admin sementara dengan `admin-awal.js`, login, buka Sistem › Backup & restore, isi
   pengaturan B2 (key `tarbiyah-app`), **Tes koneksi**.
4. Buka "Backup di B2", pilih dump terbaru → **Ambil ke server** → **Pulihkan** → ketik nama
   lembaga. Aplikasi memeriksa versi skema, memulihkan database, menjalankan migrasi bila perlu,
   lalu mengunduh semua lampiran dari `tarbiyah/files/`.
5. Login ulang dengan akun admin lama (admin sementara ikut hilang karena database diganti).
6. Bila backup aplikasi tidak bisa dipakai, pulihkan dump `coolify/` dengan fitur restore Coolify,
   lalu jalankan langkah 4 hanya untuk mengunduh berkas (atau salin `tarbiyah/files/` manual).
7. Atur ulang domain/DNS Cloudflare, GOWA (scan QR ulang), dan noken-pay (URL webhook).

### 11. Restore manual (bila aplikasi terkunci)

Bila restore dari aplikasi gagal **dan** kondisi sebelumnya juga gagal dikembalikan, aplikasi
mengunci diri (semua halaman menampilkan "Aplikasi dikunci") dan menyebut nama dump pra-restore,
mis. `tarbiyah-20261120-1755`. Pulihkan manual dari Terminal container:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$DATABASE_URL" /data/backups/tarbiyah-20261120-1755.dump
```

Bila gagal karena tabel sudah tidak ada/berantakan, kosongkan skema dulu (hati-hati: menghapus isi
database aplikasi; skema `pgboss` tidak disentuh):

```bash
psql "$DATABASE_URL" -c "drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade"
```

Lalu **Restart** aplikasi di Coolify (status kunci hanya disimpan di memori dan migrasi berjalan
saat start). Bila dump lokal juga hilang, ambil dari B2 `tarbiyah/db/` atau pakai backup lapis 2
Coolify.

### 12. Uji sebelum dipakai

- Simulasi naik kelas di staging (Data Sekolah › Tahun ajaran baru) dengan data contoh.
- Backup → restore di staging, termasuk **dari B2** ke database & volume kosong.
- Ukur RAM container: idle dan saat backup (`docker stats`), pastikan di bawah batas 512 MB.
- Uji restore minimal sekali per semester, dan tiap akhir semester unduh satu backup ke Google Drive
  (salinan ketiga).
