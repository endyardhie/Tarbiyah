# Rancangan Sistem TARBIYAH

Nov 19, 2026 · @Satya Prana Ardhie

## Ringkasan & keputusan

TARBIYAH dibangun sebagai **satu container Node.js** (API Hono + frontend React PWA + pekerja latar pg-boss) dengan **PostgreSQL**, di-deploy lewat **Coolify** di server yang sama dengan GOWA dan noken-pay. Biaya bulanan tetap (harga VPS), tanpa tagihan per pemakaian. Struktur data tetap universal, jadi unit SD/SMP/SMA bisa ditambah tanpa ubah kode.

| Topik            | Keputusan                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting          | Self-host di Coolify (VPS sendiri). Image dibangun di GitHub Actions, Coolify hanya menjalankan.                                                                                       |
| Database         | PostgreSQL + Drizzle ORM; antrean & jadwal memakai pg-boss di Postgres yang sama, tanpa Redis.                                                                                         |
| Backup           | Dua lapis ke Backblaze B2: backup aplikasi (database + berkas) dan backup terjadwal Postgres dari Coolify. Berkas di-backup bertahap, dan backup di B2 tidak bisa dihapus dari server. |
| Cloudflare       | Tetap dipakai, paket gratis saja: DNS, proxy, dan Turnstile. Tidak ada layanan Cloudflare berbayar.                                                                                    |
| Presensi         | Sekali per hari per santri, diisi wali kelas.                                                                                                                                          |
| Siapa yang login | Admin, guru/staf, dan wali santri. Santri tidak punya akun.                                                                                                                            |
| Keuangan MVP     | SPP bulanan + potongan/beasiswa per santri. Tagihan lain & cicilan ditunda, tapi skemanya sudah siap.                                                                                  |
| Nominal SPP      | Per unit + lokasi, per tahun ajaran (mis. MDTU KOTA ≠ MDTU RAHE).                                                                                                                      |
| Payment gateway  | Lapisan adapter; provider pertama noken-pay di server Coolify yang sama.                                                                                                               |
| WA gateway       | GOWA di server yang sama, dipanggil lewat jaringan internal Docker.                                                                                                                    |
| Isi rapor        | Nilai angka, predikat & deskripsi, hafalan & akhlak/sikap, rekap absen & catatan wali kelas.                                                                                           |
| Nilai rapor      | Dihitung otomatis dari bobot nilai harian/UTS/UAS, guru bisa koreksi sebelum dikunci.                                                                                                  |
| Periode          | 2 semester per tahun ajaran.                                                                                                                                                           |
| Cakupan jabatan  | Global: Kepala Sekolah, Bendahara, dll. melihat semua unit & lokasi.                                                                                                                   |
| Hari libur       | Libur mingguan + libur di kalender, bisa ditarget ke semua / unit / lokasi.                                                                                                            |
| Lupa password    | OTP via WA GOWA, plus reset manual oleh admin.                                                                                                                                         |
| Domain           | Domain milik pondok, DNS di Cloudflare.                                                                                                                                                |
| Pembangunan      | Bertahap per milestone.                                                                                                                                                                |

## Koreksi atas rancangan awal

Rancangan awal sudah lengkap secara fitur; 16 poin di bawah ini memperbaiki hal yang akan bermasalah saat data berjalan bertahun-tahun, soal privasi, atau soal kapasitas server.

| #   | Rancangan awal                                     | Masalahnya                                                                                                 | Perbaikan                                                                                                                                                  |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Santri langsung terhubung ke kelas                 | Saat naik kelas, riwayat absen & rapor tahun lalu ikut "pindah"                                            | Tabel **pendaftaran** per tahun ajaran (santri → kelas → status). Kelas juga dibuat per tahun ajaran.                                                      |
| 2   | Laporan kehadiran dilihat semua user termasuk wali | Wali bisa melihat ketidakhadiran anak orang lain                                                           | Wali hanya melihat anaknya. Guru melihat kelas yang diajar; jabatan melihat semua.                                                                         |
| 3   | Wali kelas & guru sebagai role yang dicentang      | Role tidak tahu kelas/mapel mana yang dipegang                                                             | Jabatan (Admin, Kepsek, Bendahara) = role. Wali kelas, pengajar, wali santri = **relasi** ke kelas/mapel/santri.                                           |
| 4   | Presensi default H + simpan otomatis               | "Belum diabsen" tidak bisa dibedakan dari "semua hadir"                                                    | Default H, tombol **Simpan** sekali tekan, daftar kelas belum absen di dashboard. Koreksi tanggal lampau hanya dengan izin khusus, tercatat di log.        |
| 5   | Ekspor PDF (rapor, laporan)                        | PDF di server butuh Chrome headless yang memakan ratusan MB RAM, padahal RAM server sudah ketat            | PDF dibuat di browser dari template HTML + CSS cetak A4/F4. Template rapor disimpan di database dan bisa diedit admin. Teks Arab tampil benar.             |
| 6   | Format payment gateway diatur di pengaturan        | Tiap provider punya cara tanda tangan & webhook berbeda; tidak bisa hanya dengan form                      | Satu file **adapter** per provider di kode. Pengaturan memilih adapter aktif + kredensialnya.                                                              |
| 7   | Secret dienkripsi lalu disimpan                    | Kalau kunci enkripsi ikut di database, enkripsinya percuma                                                 | Master key di **environment variable Coolify** (ditandai secret), bukan di database. Secret tidak pernah ditampilkan ulang, hanya "terisi" + tombol ganti. |
| 8   | Kirim WA via GOWA                                  | Kirim massal berisiko nomor diblokir; port GOWA yang terbuka bisa disalahgunakan                           | Pesan lewat antrean dengan jeda, hanya ke nomor bertanda WA. GOWA dipanggil lewat jaringan internal Docker dan tidak dibuka ke internet.                   |
| 9   | Push notifikasi PWA                                | iPhone hanya menerima push jika PWA sudah di-install (iOS 16.4+)                                           | Push + kotak **Notifikasi** di aplikasi. Bukti bayar & tagihan tetap lewat WA.                                                                             |
| 10  | Logo upload jadi ikon PWA                          | Ikon PWA perlu ukuran 192/512 px; iPhone menyimpan ikon saat install                                       | Manifest dibuat dinamis; logo di-resize di browser saat upload. Ganti logo = pengguna iPhone perlu install ulang.                                          |
| 11  | Backup & restore                                   | Backup yang hanya ada di server ikut hilang kalau server rusak; restore keliru bisa menghapus data terbaru | Dua lapis ke B2 (backup aplikasi + backup Postgres Coolify). Restore wajib konfirmasi dua langkah + backup otomatis sebelum restore.                       |
| 12  | Hosting serverless berbayar per pemakaian          | Tagihan bisa membengkak tanpa batas jika ada lonjakan atau bug                                             | Self-host di Coolify dengan biaya tetap. Gantinya, update server, keamanan, dan pemantauan menjadi tanggung jawab Anda.                                    |
| 13  | Build & deploy dari GitHub                         | Build Vite + TypeScript di server bisa memakan lebih dari 1 GB RAM dan membuat server macet saat deploy    | Image Docker dibangun di **GitHub Actions**, disimpan di GHCR, lalu Coolify hanya menarik dan menjalankannya.                                              |
| 14  | Guru tidak bisa ubah status admin                  | Harus dijaga di server, bukan hanya disembunyikan di tampilan                                              | Hanya admin yang memberi role admin; admin terakhir tidak bisa dihapus atau dinonaktifkan.                                                                 |
| 15  | Ayah & ibu login dengan HP berbeda                 | Satu akun bersama membuat jejak "siapa melakukan apa" kabur                                                | Disarankan akun masing-masing, keduanya terhubung ke santri. Satu akun di banyak HP tetap bisa.                                                            |
| 16  | No HP sebagai username                             | Format 08xx / +62 / 62 bisa dianggap nomor berbeda                                                         | Semua nomor disimpan format 628xx. Login bisa memakai nomor mana pun milik user yang ditandai "untuk login".                                               |

## Arsitektur & tech stack

Satu repo GitHub menghasilkan satu image Docker. Image dibangun di GitHub Actions (bukan di server, supaya RAM server tidak tersedot saat build), disimpan di GitHub Container Registry (GHCR), lalu Coolify menarik dan menjalankannya. Pekerjaan lambat (kirim WA, push, backup) dijalankan pekerja pg-boss di proses yang sama, jadi tombol di aplikasi tetap cepat.

&#91;embedded content: arsitektur TARBIYAH di Coolify · 1 server, 4 container, 2 layanan luar\]

Trafik pengguna masuk lewat Cloudflare dan Traefik bawaan Coolify; database, GOWA, dan noken-pay hanya bisa dijangkau dari dalam server.

| Lapisan          | Pilihan                                                                            | Alasan                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Runtime          | Node.js 24 LTS, image `node:24-slim`                                               | Didukung sampai 2028; berbasis Debian agar paket native dan `pg_dump` mudah dipasang                 |
| API              | Hono + `@hono/node-server` + Zod                                                   | Ringan dan cepat; skema validasi dipakai bersama frontend                                            |
| Database         | PostgreSQL 17 (resource database Coolify) + Drizzle ORM                            | Aman untuk banyak pengguna bersamaan, foreign key & constraint kuat, backup terjadwal bawaan Coolify |
| Antrean & jadwal | pg-boss 10                                                                         | Antrean, cron, dan retry disimpan di Postgres; tidak perlu Redis, hemat RAM                          |
| Berkas           | Volume Docker `/data` (logo, ikon, lampiran, backup lokal) lewat lapisan storage   | Paling sederhana untuk ±200 santri; lapisan storage bisa diganti S3 nanti tanpa ubah fitur           |
| Backup luar      | Backblaze B2 (API S3)                                                              | 10 GB pertama gratis; dipakai oleh aplikasi dan oleh Coolify                                         |
| Frontend         | React + Vite + TypeScript, TanStack Router & Query                                 | Ekosistem terbesar, mudah dirawat                                                                    |
| UI               | Tailwind CSS v4, Radix primitives, Lucide, Plus Jakarta Sans                       | Sesuai skill endy-dashboard-ui, tema hijau, light/dark                                               |
| Grafik           | Recharts (dashboard saja)                                                          | Cukup untuk rekap kehadiran & keuangan                                                               |
| PWA & push       | vite-plugin-pwa (injectManifest) + paket `web-push`                                | Di Node, pustaka push standar bisa dipakai langsung                                                  |
| Auth             | Sesi di Postgres + cookie HttpOnly, Argon2id (`@node-rs/argon2`), Turnstile        | Hash password standar saat ini; tanpa layanan pihak ketiga; banyak perangkat per user                |
| PDF              | Template HTML + CSS cetak, dicetak dari browser                                    | Tanpa Chrome di server, teks Arab benar, template bisa diedit                                        |
| Kualitas         | Vitest dengan Postgres asli (Docker Compose lokal, service container di CI), Biome | Tes memakai database yang sama jenisnya dengan production                                            |
| Deploy           | GitHub Actions → GHCR → webhook deploy Coolify                                     | Dua aplikasi di Coolify: **staging** (branch `main`) dan **production** (tag rilis `v*`)             |
| Proxy & HTTPS    | Traefik bawaan Coolify + Let's Encrypt; Cloudflare mode SSL Full (strict)          | Sertifikat otomatis, enkripsi sampai server                                                          |

**Jaringan internal.** TARBIYAH, PostgreSQL, GOWA, dan noken-pay dihubungkan ke jaringan Docker yang sama di Coolify. TARBIYAH memanggil GOWA dan noken-pay lewat alamat internal (diisi di pengaturan, mis. `http://gowa:3000`), dan noken-pay mengirim webhook ke alamat internal TARBIYAH. Port PostgreSQL dan GOWA tidak dibuka ke internet. Webhook tetap diverifikasi tanda tangannya walau lewat jaringan internal.

## Model data (PostgreSQL)

Skema terdiri dari ±40 tabel dalam 7 kelompok; kuncinya adalah **pendaftaran** (santri per tahun ajaran) yang menjadi acuan presensi, nilai, rapor, dan tagihan.

Konvensi: id berupa UUID v7 (urut waktu, dibuat aplikasi), waktu bertipe `timestamptz`, tanggal sekolah bertipe `date` dihitung dalam zona waktu sekolah (default Asia/Jayapura, bisa diubah di pengaturan), uang dalam rupiah bertipe `bigint`, data fleksibel (isi audit log, payload webhook) bertipe `jsonb`. Relasi dijaga foreign key dan aturan unik di database. Data tidak dihapus permanen; dinonaktifkan lewat kolom status. Tabel antrean pg-boss berada di skema `pgboss` tersendiri dan dibuat otomatis.

### Identitas & akses

| Tabel                                 | Kolom penting                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| users                                 | nama, nama\_panggilan, alamat, password\_hash, status, wajib\_ganti\_password, login\_terakhir |
| user\_phones                          | user\_id, nomor (628…, unik), label (Ayah/Ibu/Pribadi), punya\_wa, untuk\_login                |
| roles, role\_permissions, user\_roles | Jabatan + daftar izin; satu user boleh banyak jabatan                                          |
| sessions                              | hash token, user\_id, perangkat, IP, terakhir\_aktif, kedaluwarsa                              |
| otp\_codes, rate\_limits              | Kode OTP ter-hash (5 menit, maks 5 percobaan); batas percobaan login & OTP                     |
| push\_subscriptions                   | user\_id, endpoint (unik), kunci p256dh & auth, perangkat                                      |
| audit\_log                            | siapa, aksi, entitas, data sebelum & sesudah, waktu                                            |

### Struktur sekolah

| Tabel                   | Kolom penting                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| lokasi                  | nama (KOTA, RAHE), alamat                                                                                                               |
| units                   | kode (TA, MDTU, MDTW, SD…), nama, urutan                                                                                                |
| tahun\_ajaran, semester | 2026/2027; semester 1 & 2 dengan tanggal mulai–selesai, satu yang aktif                                                                 |
| kelas                   | tahun\_ajaran, unit, lokasi, nama bebas ("Kelas 1 Banin"), tingkat (angka untuk naik kelas), kelompok (banin/banat/campur), wali\_kelas |
| mapel                   | nama, nama\_arab, kode, unit (opsional)                                                                                                 |
| pengajaran              | kelas + mapel + guru pengajar + KKM (satu baris = "Ustadz A mengajar Fiqih di Kelas 1 Banin")                                           |
| jadwal                  | pengajaran, hari, jam mulai–selesai                                                                                                     |
| libur\_mingguan         | hari + unit/lokasi (kosong = berlaku semua)                                                                                             |

### Santri & wali

| Tabel        | Kolom penting                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| santri       | NIS (unik), nama lengkap, nama panggilan, jenis kelamin, TTL, alamat, status (aktif/lulus/pindah/keluar)          |
| santri\_wali | santri, user wali, hubungan (ayah/ibu/wali), penerima tagihan                                                     |
| pendaftaran  | santri, tahun ajaran, kelas, status (aktif/naik/tinggal/lompat/pindah/lulus), no absen; unik per santri per tahun |

### Presensi

| Tabel          | Kolom penting                                                                 |
| -------------- | ----------------------------------------------------------------------------- |
| presensi\_sesi | kelas, tanggal, disimpan oleh & kapan (penanda "kelas sudah diabsen")         |
| presensi       | pendaftaran, tanggal, status H/S/I/A, keterangan; unik per santri per tanggal |

### Akademik & rapor

| Tabel                             | Kolom penting                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| tugas                             | pengajaran, judul, deskripsi, lampiran (berkas di /data), tanggal diberi, tenggat, dinotifikasi\_at |
| penilaian, nilai                  | Satu kegiatan penilaian (PR, tugas, UH, UTS, UAS, praktik) + nilai 0–100 per santri                 |
| bobot\_nilai, skala\_predikat     | Bobot per jenis penilaian dan rentang predikat, per unit                                            |
| rapor\_nilai                      | nilai otomatis, nilai akhir, predikat, deskripsi, penanda diubah manual                             |
| rapor\_aspek, rapor\_aspek\_nilai | Aspek non-mapel per unit (Akhlak, Kebersihan, Hafalan Juz 30…) bertipe predikat/angka/teks          |
| rapor                             | catatan wali kelas, keputusan naik/tinggal, rekap S/I/A, status draft/final, dikunci oleh & kapan   |
| rapor\_template                   | unit, nama, HTML, CSS, aktif                                                                        |

### Informasi

| Tabel      | Kolom penting                                                                          |
| ---------- | -------------------------------------------------------------------------------------- |
| pengumuman | judul, isi, pengirim, dikirim\_at                                                      |
| agenda     | judul, deskripsi, mulai–selesai, hari libur atau bukan                                 |
| sasaran    | dipakai pengumuman & agenda: unit, lokasi, atau kelas (semua kosong = seluruh sekolah) |
| notifikasi | penerima, jenis, judul, isi, tautan, pengirim (kosong = sistem), dibaca\_at            |

### Keuangan

| Tabel                                  | Kolom penting                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| tarif\_spp                             | tahun ajaran, unit, lokasi, nominal                                                                                          |
| potongan                               | santri, tahun ajaran, nominal atau persen, alasan                                                                            |
| tagihan                                | santri, pendaftaran, jenis (SPP), periode (2026-11), nominal, potongan, total, status; unik per santri per jenis per periode |
| pembayaran                             | tagihan, jumlah, metode (tunai/transfer/gateway), provider\_ref (unik), dicatat oleh, bukti\_wa\_dikirim\_at                 |
| payment\_intent, payment\_intent\_item | Satu QRIS bisa membayar beberapa bulan sekaligus                                                                             |
| webhook\_event                         | provider, id event (unik, cegah diproses dua kali), payload, status proses                                                   |

### Sistem

| Tabel        | Kolom penting                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| settings     | key, value; secret dienkripsi AES-GCM dengan versi kunci                                                                            |
| wa\_outbox   | nomor, pesan, status, percobaan, error, rujukan (mis. pembayaran)                                                                   |
| backup\_file | nama file, lokasi (server/B2), ukuran, otomatis/manual, dibuat oleh & kapan                                                         |
| berkas       | nama asli, path acak, ukuran, tipe, rujukan (mis. tugas), publik atau privat, dibuat\_at, dibackup\_at (kapan sudah tersalin ke B2) |

## Peran & hak akses

Hak akses punya dua lapis: **jabatan** (role yang dicentang, izinnya global dan bisa diatur admin) dan **relasi** (otomatis dari data: wali kelas dari kelas, pengajar dari pengajaran, wali santri dari santri\_wali). Satu orang bisa memegang semuanya sekaligus, dan menu tampil sesuai gabungan haknya.

Semua pengecekan dilakukan di server lewat satu fungsi, mis. `can(user, "nilai.input", { pengajaranId })`. Menyembunyikan tombol di tampilan hanya untuk kenyamanan, bukan pengaman.

Matriks bawaan (izin jabatan bisa diubah admin di Role & Hak Akses):

| Fitur                | Admin                                        | Kepsek / Wakasek              | Bendahara                        | Wali kelas                     | Guru pengajar                | Wali santri                 |
| -------------------- | -------------------------------------------- | ----------------------------- | -------------------------------- | ------------------------------ | ---------------------------- | --------------------------- |
| Isi presensi         | Semua kelas, termasuk koreksi tanggal lampau | —                             | —                                | Kelasnya, hari ini             | —                            | —                           |
| Laporan presensi     | Semua                                        | Semua                         | —                                | Kelasnya                       | Kelas yang diajar            | Anaknya                     |
| Tugas/PR & nilai     | Semua                                        | Lihat semua                   | —                                | Lihat kelasnya                 | Isi untuk mapel yang diajar  | Lihat anaknya               |
| Rapor: isi           | Semua                                        | —                             | —                                | Aspek, catatan, keputusan naik | Nilai mapelnya               | —                           |
| Rapor: kunci & cetak | Ya                                           | Ya                            | —                                | Cetak kelasnya                 | —                            | Lihat & unduh setelah final |
| Pengumuman           | Semua sasaran                                | Semua sasaran                 | —                                | Kirim                          | Kirim ke kelas/unit mana pun | Baca                        |
| Kalender & libur     | Kelola                                       | Kelola                        | —                                | Lihat                          | Lihat                        | Lihat                       |
| Tagihan & pembayaran | Kelola                                       | Lihat laporan                 | Kelola, catat bayar, kirim bukti | —                              | —                            | Lihat & bayar milik anaknya |
| Data master          | Kelola                                       | Sesuai izin                   | —                                | Lihat santri kelasnya          | —                            | Edit profil sendiri         |
| Pengguna & role      | Kelola                                       | Sesuai izin, tanpa role admin | —                                | —                              | —                            | Ganti password sendiri      |
| Pengaturan & backup  | Hanya admin                                  | —                             | —                                | —                              | —                            | —                           |

Daftar izin jabatan yang bisa dicentang: `santri.kelola`, `wali.kelola`, `guru.kelola`, `kelas.kelola`, `mapel.kelola`, `jadwal.kelola`, `presensi.koreksi`, `presensi.lihat_semua`, `akademik.lihat_semua`, `rapor.kunci`, `pengumuman.semua`, `kalender.kelola`, `keuangan.lihat`, `keuangan.kelola`, `keuangan.catat_manual`, `pengguna.kelola`. Izin `pengaturan.*` dan `backup.*` melekat pada admin dan tidak bisa diberikan ke jabatan lain.

## Spesifikasi fitur per modul

Tujuh modul, semuanya masuk MVP; yang ditandai _(usulan)_ adalah tambahan saya di luar rancangan awal.

### Login & PWA

- Nomor HP + password + Turnstile. Sesi 90 hari, diperpanjang otomatis saat aktif.
- Login pertama dengan password sementara dari admin → wajib ganti password.
- Lupa password: masukkan nomor → OTP 6 digit via WA (maks 3 permintaan/jam per nomor) → password baru.
- Tombol **Install aplikasi**: prompt bawaan di Android/desktop; panduan "Bagikan → Tambah ke Layar Utama" di iPhone.
- _(usulan)_ Halaman **Perangkat aktif**: lihat dan keluarkan perangkat yang login.
- Wali dengan beberapa anak memilih anak dari pemilih di bagian atas; seluruh halaman mengikuti anak terpilih.

### Dashboard

Kartu tampil sesuai gabungan hak pengguna:

- **Wali santri:** kehadiran bulan ini, PR aktif dengan tenggat terdekat, tagihan belum lunas + tombol Bayar, agenda terdekat, pengumuman terbaru.
- **Wali kelas:** status absen hari ini + tombol "Absen sekarang".
- **Guru:** PR yang tenggat minggu ini, penilaian yang nilainya belum lengkap.
- **Bendahara:** tagihan bulan ini, sudah dibayar, tunggakan, pembayaran terbaru.
- **Admin/Kepsek:** _(usulan)_ kelas yang belum absen hari ini, rekap kehadiran per unit, ringkasan keuangan.
- **Mobile:** navbar bawah selebar layar dengan jarak kiri-kanan sama, maksimal 5 item berikon dan berlabel sesuai peran; item paling kanan selalu **Menu** (semua fitur lain).

### Presensi

- **Tab Isi** (wali kelas untuk kelasnya; admin bisa pilih kelas): tanggal hari ini menurut zona waktu sekolah, satu baris per santri berisi nama panggilan + tombol **H** hijau, **S** kuning, **I** biru, **A** merah. Default H; keterangan opsional untuk S/I.
- Tombol **Simpan**; bisa diubah sampai pukul 23.59 hari itu. Setelahnya hanya pemegang izin `presensi.koreksi`, tercatat di log.
- Hari libur mingguan atau libur di kalender untuk kelas tersebut → halaman menampilkan "Hari libur" dan tidak bisa diisi.
- Peringatan saat admin mengisi data jika ada nama panggilan kembar dalam satu kelas.
- **Tab Laporan:** rekap per bulan atau semester (santri × tanggal, total H/S/I/A, persentase), filter kelas & periode, ekspor PDF. Wali hanya melihat baris anaknya.
- _(usulan, default mati)_ Push otomatis ke wali saat anaknya dicatat A.

### Akademik

- **Tugas/PR:** guru memilih kelas + mapel yang diajarnya, isi judul, deskripsi, tenggat, lampiran gambar/PDF (foto dikecilkan otomatis di browser ke lebar maks 1600 px (±300 KB) sebelum diunggah, PDF maks 5 MB, disimpan di server).
- **Nilai:** buat penilaian (PR, tugas, UH, UTS, UAS, praktik) → isi nilai dalam grid yang nyaman dengan keyboard → simpan.
- Setelah menyimpan tugas atau nilai, muncul tombol **Kirim notifikasi** dengan status "terkirim …". Tanpa ditekan, tidak ada push maupun kotak notifikasi. Wali hanya melihat nilai anaknya.
- **Rapor nilai mapel (guru):** kolom nilai otomatis dari bobot, nilai akhir bisa diubah, predikat dari skala, deskripsi otomatis dari predikat dan bisa diedit.
- **Rapor kelas (wali kelas):** aspek akhlak/hafalan, catatan wali kelas, keputusan naik (semester 2), rekap S/I/A otomatis.
- Status rapor: **draft → final**. Dikunci oleh pemegang `rapor.kunci`; setelah final, wali santri bisa melihat dan mengunduh.
- **Template rapor:** editor HTML + CSS dengan placeholder (`{{santri.nama}}`, blok daftar mapel), pratinjau data contoh, satu template per unit. Cetak massal satu kelas dalam satu dokumen.

### Data sekolah

- Lokasi, unit, tahun ajaran & semester, kelas (+ wali kelas), mapel, pengajaran (kelas + mapel + guru), jadwal (per kelas dan per guru).
- Santri & wali: tambah/ubah, hubungkan dari dua arah, satu santri satu unit per tahun ajaran.
- _(usulan)_ **Impor CSV** santri & wali dengan template, untuk input awal ±200 santri tanpa ketik satu-satu.
- Profil sendiri: nama, alamat, nomor HP (tambah/hapus, centang punya WA), ganti password.
- **Wizard tahun ajaran baru:** buat tahun baru → salin struktur kelas (tingkat +1) & tarif SPP → daftar semua santri dengan usulan naik otomatis, ubah per santri jadi tinggal/lompat/pindah/lulus → pratinjau → konfirmasi. Tahun lama menjadi arsip baca-saja.

### Informasi

- **Notifikasi:** kotak masuk per pengguna, badge belum dibaca, pengirim (nama atau "Sistem"), tautan ke halaman terkait.
- **Pengumuman:** judul, isi, sasaran (seluruh sekolah / unit / lokasi / kelas, boleh lebih dari satu), pengirim tercatat, centang "kirim notifikasi" (default aktif).
- **Kalender/agenda:** tampilan bulan + daftar; agenda bisa ditandai libur untuk sasaran tertentu.

### Keuangan

- Tarif SPP per unit + lokasi per tahun ajaran; potongan per santri (nominal atau persen).
- Tagihan dibuat otomatis oleh jadwal pg-boss tiap tanggal 1 untuk santri aktif, atau tombol "Buat tagihan" manual; tidak bisa dobel untuk periode yang sama. Bulan yang ditagih & tanggal jatuh tempo diatur di pengaturan.
- **Wali:** daftar tagihan per anak, centang beberapa bulan → **Bayar** → halaman/QRIS noken-pay → status lunas otomatis lewat webhook.
- **Bendahara:** semua tagihan dengan filter (lokasi, unit, kelas, status, periode), catat bayar manual (tunai/transfer) lalu tombol **Kirim bukti WA**, batalkan tagihan dengan alasan.
- Bukti bayar dikirim ke semua nomor wali yang punya WA dan ditandai penerima tagihan; isi pesan memakai template di pengaturan.
- **Laporan:** penerimaan per periode, tunggakan per kelas/santri, ekspor PDF dan CSV.

### Sistem

- **Pengguna:** tambah, reset password (password sementara), nonaktifkan, atur jabatan.
- **Role & hak akses:** buat jabatan, centang izin.
- **Pengaturan (admin):** identitas & logo, zona waktu, libur mingguan, bobot & skala predikat, aspek rapor, template rapor, bulan tagihan & jatuh tempo, WA gateway (aktif/nonaktif, URL, kredensial, jeda kirim, template pesan), payment gateway (aktif/nonaktif, provider, kredensial, secret webhook). Tujuan backup B2 (endpoint, bucket, kunci akses). Kunci VAPID untuk push dibuat otomatis.
- **Backup & restore (admin):** jadwal tiap N hari, simpan maks N file di server (di B2 penghapusan diatur aturan lifecycle bucket), status backup terakhir & berkas yang belum tersalin, backup manual, unduh, restore.
- _(usulan)_ **Log aktivitas:** siapa mengubah nilai, presensi, tagihan, pembayaran, dan pengaturan.

## Alur penting

Lima alur ini paling rawan salah; semuanya dirancang supaya aman jika diulang (idempoten) dan tidak membuat pengguna menunggu pekerjaan lambat.

### Pembayaran SPP

&#91;embedded content: alur pembayaran SPP · webhook dan rekonsiliasi Cron\]

Tagihan ditandai lunas di satu tempat saja (langkah "Cek event"), baik datangnya dari webhook maupun dari rekonsiliasi terjadwal.

- Webhook dicatat dulu di `webhook_event` (id unik); event yang sama datang dua kali hanya diproses sekali.
- Jumlah yang dibayar harus sama dengan jumlah intent; kalau beda, tagihan tidak ditandai lunas dan bendahara mendapat notifikasi.
- Cadangan jika webhook hilang: jadwal pg-boss tiap 15 menit menanyakan status intent yang masih menunggu ke adapter.
- Pembayaran manual memakai jalur yang sama mulai dari "catat pembayaran", tapi bukti WA baru dikirim saat bendahara menekan tombolnya.

### Login & sesi

1. Browser mengirim nomor, password, dan token Turnstile.
2. Server memverifikasi Turnstile, mengecek batas percobaan per IP & per nomor (IP asli dari header `CF-Connecting-IP`), menormalkan nomor ke 628…, lalu memverifikasi password (Argon2id).
3. Sesi dibuat: token acak disimpan sebagai hash di Postgres, dikirim sebagai cookie `__Host-` HttpOnly, Secure, SameSite=Lax.
4. Setiap request, middleware memuat user, jabatan, dan relasinya; permintaan yang mengubah data juga dicek header Origin.

### Notifikasi push

1. Guru menekan **Kirim notifikasi** → API menentukan penerima (wali santri di kelas itu), lalu dalam satu transaksi menulis baris `notifikasi` dan job pg-boss (satu job per perangkat).
2. Pekerja pg-boss mengirim Web Push bertanda tangan VAPID (paket `web-push`), dengan retry bertahap.
3. Perangkat yang sudah tidak valid (respons 404/410) otomatis dihapus dari langganan.

### WA via GOWA

1. Pesan ditulis ke `wa_outbox` dan job pg-boss dalam satu transaksi; pekerja mengirim satu per satu dengan jeda (default 4 detik, bisa diatur).
2. Pekerja memanggil API GOWA lewat alamat internal Docker dengan basic auth dari pengaturan terenkripsi; gagal → coba ulang 3 kali, lalu status "gagal" terlihat oleh bendahara dengan tombol kirim ulang.
3. Jika WA gateway dinonaktifkan, pesan dicatat dengan status "dilewati".

### Backup & restore

1. **Lapis 1, backup aplikasi** (diatur admin di TARBIYAH), dua bagian:
   - **Database, penuh setiap kali:** jadwal pg-boss tiap N hari menjalankan `pg_dump` (format custom), menyimpannya di `/data/backups`, lalu mengunggah ke B2 di folder `tarbiyah/db/`. Di server disimpan N file terakhir.
   - **Berkas, bertahap:** setiap berkas baru diunggah ke B2 folder `tarbiyah/files/` satu kali saja, lalu ditandai `dibackup_at`. Berkas tidak pernah diubah (nama acak), jadi tidak ada salinan ganda dan pemakaian B2 tetap kecil.
2. **Lapis 2, backup database Coolify:** jadwal harian Postgres TARBIYAH dan database noken-pay ke B2 folder `coolify/`. Ini pengaman bila aplikasinya sendiri bermasalah.
3. **Backup tidak bisa dihapus dari server.** Kunci B2 untuk aplikasi dan untuk Coolify dibatasi ke foldernya masing-masing dan **tidak punya izin hapus**. Aplikasi dan Coolify tidak pernah menghapus file di B2 (retensi S3 Coolify diisi 0 = tanpa batas); yang menghapus backup lama adalah aturan _lifecycle_ di bucket (folder `db/` dan `coolify/`: 90 hari; folder `files/`: tidak pernah). Jadi, walau server dibobol, penyerang tidak bisa menghapus backup.
4. **Restore dari aplikasi:** pilih dump (server atau B2) atau unggah → cek versi skema → backup otomatis kondisi sekarang → mode pemeliharaan (baca-saja) → `pg_restore` → unduh dari B2 berkas yang hilang di server → mode normal. Konfirmasi dua langkah dengan mengetik nama lembaga.
5. **GOWA:** isinya terutama sesi login WhatsApp; bila hilang cukup scan QR ulang, dan riwayat pesan tetap tercatat di `wa_outbox` TARBIYAH. Tidak perlu backup khusus.
6. Kunci `APP_ENCRYPTION_KEY` tidak ikut backup. Simpan juga di pengelola password: tanpa kunci itu, secret di pengaturan (GOWA, noken-pay, B2) tidak bisa dibuka setelah restore di server baru.
7. **Salinan ketiga:** tiap akhir semester admin mengunduh satu backup dari aplikasi dan menyimpannya di Google Drive.
8. Uji restore ke database kosong sebelum production dipakai, lalu minimal sekali per semester.

## Ruang lingkup MVP & milestone

MVP dibangun dalam 8 milestone berurutan; tiap milestone di-deploy ke **staging** di Coolify dan dicek sebelum lanjut. Dashboard tumbuh bertahap: setiap modul menambah kartunya sendiri.

1. **M0 — Fondasi & deploy.** Repo, Hono + Vite, Drizzle + migrasi otomatis saat container start, pg-boss, Docker Compose lokal (Postgres), Dockerfile, GitHub Actions → GHCR, aplikasi staging di Coolify, tema hijau light/dark, AppShell (sidebar desktop, navbar bawah mobile).
   - Selesai bila: staging tampil di subdomain pondok dan health check Coolify hijau.
2. **M1 — Login & pengguna.** Login + Turnstile, sesi multi-perangkat, jabatan & izin, kelola pengguna, profil, perangkat aktif, admin awal lewat seed.
   - Selesai bila: admin membuat guru & wali, dan izin ditolak di server untuk yang tidak berhak.
3. **M2 — Data sekolah & PWA.** Lokasi, unit, tahun ajaran, semester, kelas, mapel, pengajaran, jadwal, santri, wali, pendaftaran, impor CSV, identitas & logo, manifest dinamis, tombol install di halaman login.
   - Selesai bila: data contoh 200 santri masuk lewat CSV dan aplikasi bisa di-install dengan logo sekolah.
4. **M3 — Presensi & kalender.** Libur mingguan, agenda, isi presensi, laporan, fondasi cetak PDF.
   - Selesai bila: wali kelas mengisi presensi di HP dalam 1 menit, dan hari libur terkunci.
5. **M4 — Informasi & push.** Kotak notifikasi, pengumuman bersasaran, service worker, Web Push lewat pg-boss.
   - Selesai bila: push diterima di Android dan iPhone yang sudah meng-install aplikasi.
6. **M5 — Akademik & rapor.** Tugas/PR, penilaian & nilai, bobot & skala, rapor mapel, aspek & catatan, kunci rapor, editor template, cetak massal.
   - Selesai bila: satu kelas penuh menghasilkan rapor PDF final dari nilai harian.
7. **M6 — Keuangan & WA.** Tarif & potongan, jadwal tagihan, pembayaran manual, WA outbox + GOWA internal, OTP lupa password, adapter noken-pay, webhook, rekonsiliasi, laporan.
   - Selesai bila: pembayaran QRIS di staging menandai lunas otomatis dan bukti WA terkirim ke semua nomor wali.
8. **M7 — Backup & rilis.** Backup 2 lapis ke B2, restore, wizard tahun ajaran baru, log aktivitas, dashboard per peran, pengerasan keamanan, aplikasi production di Coolify.
   - Selesai bila: simulasi naik kelas dan restore berhasil di staging, lalu production aktif di domain pondok.

**Ditunda setelah MVP** (skema sudah disiapkan agar tidak perlu bongkar): tagihan non-SPP & cicilan, akun santri, presensi per jam pelajaran, presensi guru, pencatatan pengeluaran, pendaftaran santri baru online.

## Biaya, kapasitas server & risiko

Biaya tambahan per bulan praktis Rp 0 dan tidak bisa membengkak: VPS sudah ada, Cloudflare memakai paket gratis, dan backup B2 masih di bawah 10 GB gratis. Yang perlu dijaga adalah **RAM**: server 5,8 GB saat ini terpakai 3,4 GB dengan swap terisi 1,5 GB, jadi TARBIYAH dirancang hemat dan setiap container diberi batas memori.

| Item                              | Biaya                                     |
| --------------------------------- | ----------------------------------------- |
| VPS Coolify                       | Sudah ada (tetap per bulan)               |
| Cloudflare: DNS, proxy, Turnstile | Gratis                                    |
| Backblaze B2                      | Gratis sampai 10 GB, lalu $6,95/TB/bulan  |
| Domain pondok                     | Biaya tahunan domain                      |
| QRIS                              | Potongan per transaksi dari penyedia QRIS |

Perkiraan pemakaian RAM (angka perkiraan, diukur ulang setelah M0):

| Komponen                                                             | Perkiraan RAM                     | Batas memori disarankan            |
| -------------------------------------------------------------------- | --------------------------------- | ---------------------------------- |
| Container TARBIYAH (API + pekerja pg-boss)                           | 150–300 MB                        | 512 MB                             |
| PostgreSQL (shared\_buffers 128 MB, maks 30 koneksi)                 | 150–300 MB                        | 512 MB                             |
| Staging (container sendiri, database terpisah di Postgres yang sama) | 150–250 MB, hanya saat dinyalakan | 384 MB; matikan bila tidak dipakai |
| Build image                                                          | 0 di server                       | Dibangun di GitHub Actions         |

Sebelum M0, jalankan `docker stats` di server untuk melihat container yang paling boros. Swap yang terisi 1,5 GB menandakan server pernah kekurangan memori. Jika noken-pay juga memakai PostgreSQL, satu instance Postgres bisa dipakai bersama dengan database dan user terpisah, menghemat satu proses Postgres. Jika RAM tersedia turun di bawah 1 GB setelah TARBIYAH berjalan, naikkan VPS ke 8 GB.

Sumber: [Coolify database backups](https://coolify.io/docs/databases/backups), [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing), [pg-boss](https://npmjs.com/package/pg-boss), [Konfigurasi GOWA](https://www.mintlify.com/aldinokemal/go-whatsapp-web-multidevice/guides/configuration).

| Risiko                                               | Dampak                                                          | Penanganan                                                                                                                                   |
| ---------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Server tunggal rusak atau hilang                     | Aplikasi mati, data di server hilang                            | Backup 2 lapis di B2, panduan pemulihan ke server baru, uji restore tiap semester                                                            |
| RAM habis                                            | Aplikasi lambat atau dimatikan sistem (OOM)                     | Batas memori per container, build di CI, pantau `docker stats`, naik ke 8 GB bila perlu                                                      |
| Update & keamanan server jadi tanggung jawab sendiri | Celah keamanan                                                  | Update rutin OS & Coolify, login SSH pakai kunci, firewall hanya 22/80/443, port Postgres & GOWA tidak dibuka                                |
| Akses langsung ke IP server melewati Cloudflare      | Pembatasan login bisa diakali dengan IP palsu                   | Firewall: port 80/443 hanya menerima IP Cloudflare; IP klien diambil dari `CF-Connecting-IP`                                                 |
| Nomor WA GOWA diblokir WhatsApp (API tidak resmi)    | Bukti bayar & OTP tidak terkirim                                | Nomor khusus sekolah, jeda antar-pesan, hanya ke nomor wali terdaftar; reset password oleh admin tetap ada                                   |
| noken-pay masih dikembangkan                         | Pembayaran online belum siap                                    | Adapter terpisah, pembayaran manual jalan sejak awal, uji penuh di staging                                                                   |
| Webhook pembayaran tidak sampai                      | Tagihan tetap "belum lunas"                                     | Rekonsiliasi tiap 15 menit + tombol cek status                                                                                               |
| Push tidak sampai di iPhone                          | Wali tidak tahu ada PR/pengumuman                               | Kotak notifikasi + badge; panduan install di halaman login                                                                                   |
| Restore keliru                                       | Data terbaru hilang                                             | Backup otomatis sebelum restore + backup Postgres Coolify                                                                                    |
| Kunci enkripsi hilang                                | Secret di pengaturan tidak bisa dibuka                          | Simpan `APP_ENCRYPTION_KEY` di pengelola password; secret bisa diisi ulang dari pengaturan                                                   |
| Data pribadi anak bocor                              | Melanggar UU PDP (UU 27/2022)                                   | Akses berbasis relasi, log aktivitas, tidak ada data pribadi di URL, persetujuan wali saat login pertama                                     |
| Hanya satu orang yang paham sistem                   | Macet saat Anda berhalangan                                     | Minimal 2 admin, panduan admin & deploy, kode & dokumen di GitHub                                                                            |
| Server dibobol, lalu backup ikut dihapus             | Tidak ada data untuk dipulihkan                                 | Kunci B2 tanpa izin hapus, dibatasi per folder; penghapusan hanya lewat aturan lifecycle bucket                                              |
| Aplikasi atau backup mati tanpa ada yang tahu        | Baru ketahuan saat wali santri mengeluh atau saat butuh restore | Notifikasi Coolify (email/Telegram) untuk backup & deploy gagal, cek uptime gratis ke /api/health, status backup terakhir di dashboard admin |
| Kuota gratis B2 (10 GB) terlampaui                   | Tagihan kecil per bulan                                         | Foto dikecilkan sebelum diunggah, berkas di-backup bertahap, batas pengeluaran harian (Caps & Alerts) di akun B2                             |

## Asumsi default yang perlu Anda cek

Hal-hal di bawah belum Anda sebutkan, jadi saya isi dengan nilai yang umum; semua yang bernilai angka bisa diubah di Pengaturan tanpa ubah kode.

| Asumsi                     | Nilai default                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Presensi                   | Sekali per hari per santri, bukan per jam pelajaran (sudah diputuskan)                                                                                                         |
| Batas ubah presensi        | Sampai pukul 23.59 hari yang sama (zona WIT)                                                                                                                                   |
| Libur mingguan             | Sabtu & Minggu, sesuai contoh Anda; bisa diganti per unit/lokasi (mis. Jumat)                                                                                                  |
| Bulan ditagih SPP          | 12 bulan (Juli–Juni), jatuh tempo tanggal 10                                                                                                                                   |
| Bobot nilai rapor (contoh) | Harian 40%, UTS 25%, UAS 35%                                                                                                                                                   |
| Skala predikat (contoh)    | A 90–100, B 80–89, C 70–79, D di bawah 70                                                                                                                                      |
| Notifikasi pengumuman      | Centang "kirim notifikasi" aktif secara default; PR & nilai tetap lewat tombol                                                                                                 |
| Rapor untuk wali           | Tampil setelah status final                                                                                                                                                    |
| Akun ayah & ibu            | Disarankan terpisah, keduanya terhubung ke santri                                                                                                                              |
| Lampiran tugas             | Gambar/PDF, maks 5 MB per file                                                                                                                                                 |
| Bahasa                     | Antarmuka bahasa Indonesia; nama mapel boleh ditambah tulisan Arab                                                                                                             |
| Siapa membuat akun wali    | Admin (atau pemegang `wali.kelola`), dengan password sementara                                                                                                                 |
| Retensi backup             | Aplikasi: tiap 7 hari, 10 dump di server; di B2 dump database (aplikasi & Coolify) dihapus otomatis setelah 90 hari oleh lifecycle, berkas disimpan selamanya. Coolify: harian |
| Staging                    | Di server yang sama, database terpisah, WA gateway nonaktif dan pembayaran mode uji; dimatikan bila tidak dipakai                                                              |
| Rilis production           | Push ke main = staging otomatis; tag v\* (mis. v1.0.0) = production                                                                                                            |
