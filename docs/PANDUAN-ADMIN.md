# Panduan Admin TARBIYAH

Panduan ini untuk admin lembaga (tata usaha/operator). Untuk memasang server, lihat
[DEPLOY.md](DEPLOY.md).

## 1. Masuk pertama kali

1. Buka alamat aplikasi, masuk dengan nomor HP admin dan password sementara dari pengelola server.
2. Aplikasi langsung meminta **password baru** (minimal 8 karakter).
3. Pasang aplikasi di HP: tombol **Install Aplikasi** di halaman masuk (Android/Chrome), atau di
   iPhone: Safari → Bagikan → *Tambah ke Layar Utama*.
4. Buat **admin kedua** (Sistem › Pengguna) agar sistem tidak bergantung pada satu orang.

## 2. Setup awal (urutan yang disarankan)

1. **Sistem › Pengaturan**
   - Identitas: nama lembaga (dipakai untuk konfirmasi restore), nama singkat, alamat, zona waktu.
   - Logo: unggah sekali; ikon aplikasi dibuat otomatis.
   - Tagihan SPP: bulan yang ditagih, tanggal jatuh tempo, template pesan bukti bayar.
   - WA gateway, payment gateway: lihat bagian 6.
   - Persetujuan data wali: teks yang harus disetujui wali saat pertama masuk.
2. **Data Sekolah › Lokasi, unit & tahun ajaran**: lokasi (mis. KOTA, RAHE), unit (TA, MDTU,
   MDTW, …), tahun ajaran + semester, lalu **aktifkan** tahun ajaran dan semester berjalan. Atur
   libur mingguan per unit/lokasi.
3. **Sistem › Pengguna**: akun guru & staf, lalu beri **jabatan** (Kepala Sekolah, Bendahara, …).
   Hak tiap jabatan diatur di **Sistem › Role & hak akses**.
4. **Data Sekolah › Kelas**: kelas per unit & lokasi, tingkat, dan wali kelasnya.
5. **Data Sekolah › Mata pelajaran**, lalu **Pengajaran & jadwal**: guru per mapel per kelas.
6. **Santri & wali**: lewat impor CSV (bagian 4) atau satu per satu.
7. **Keuangan › Tarif & potongan**: tarif SPP per unit + lokasi, potongan/beasiswa per santri.

## 3. Akun & password

- Login memakai **nomor HP** (format bebas: 0812…, +62812…, 62812…).
- Password lupa: wali/guru bisa reset sendiri lewat **kode WhatsApp** (bila WA gateway aktif).
  Admin juga bisa **Reset password** di Pengguna/Wali → password sementara diberikan langsung ke
  orangnya (jangan dikirim di grup).
- Pengguna yang keluar: **nonaktifkan** (data tidak pernah dihapus). Admin aktif terakhir tidak bisa
  dinonaktifkan.
- Wali santri wajib menyetujui teks persetujuan data saat pertama masuk; tercatat di Log aktivitas.

## 4. Impor CSV santri & wali

1. Data Sekolah › Impor CSV → **Unduh template**.
2. Isi di Excel/Google Sheets. Kolom: `nis, nama, nama_panggilan, jenis_kelamin (L/P),
   tempat_lahir, tanggal_lahir (YYYY-MM-DD), alamat, unit, lokasi, kelas, wali1_nama,
   wali1_hubungan (ayah/ibu/wali), wali1_hp, wali2_nama, wali2_hubungan, wali2_hp`.
   `unit`, `lokasi`, dan `kelas` harus sama persis dengan yang sudah dibuat.
3. Simpan sebagai **CSV**, unggah, periksa pratinjau (baris bermasalah ditandai), lalu impor.
4. Unduh berkas **password sementara wali** dan bagikan satu per satu. Wali yang nomornya sudah
   terdaftar memakai akun yang sama untuk beberapa anak.

## 5. Kegiatan rutin

- **Presensi**: wali kelas mengisi tiap hari; koreksi tanggal lampau hanya oleh pemegang izin
  koreksi. Rekap & cetak di menu Presensi.
- **Akademik & rapor**: guru mengisi nilai; wali kelas mengisi bagian kelas; pemegang izin *kunci
  rapor* mengunci → rapor final terlihat wali dan bisa dicetak (PDF dari browser).
- **Tagihan**: dibuat otomatis tiap tanggal 1 pukul 03.00. Bila terlewat (server mati), bendahara
  menekan **Buat tagihan**. Pembayaran tunai/transfer dicatat bendahara lalu **Kirim bukti WA**;
  pembayaran QRIS lunas otomatis dan bukti WA terkirim sendiri.
- **Keuangan › Laporan › Perlu dicek**: pembayaran QRIS yang nominalnya tidak cocok atau dobel —
  cocokkan dengan mutasi QRIS, lalu tandai sudah dicek dengan catatan.

## 6. WhatsApp & pembayaran online

- **WA gateway (GOWA)**: aktifkan, isi URL internal (mis. `http://gowa:3000`), user & password
  basic auth, jeda kirim (default 4 detik). Tekan **Cek koneksi**: harus "sudah login WhatsApp".
  Pesan yang gagal terlihat di Keuangan › Antrean WA dengan tombol kirim ulang. Bila nomor WA
  sekolah logout, scan QR ulang di GOWA.
- **Payment gateway (noken-pay)**: aktifkan, isi URL internal, API key, secret webhook, dan (bila
  perlu) URL webhook internal. Uji dengan satu pembayaran kecil sebelum diumumkan ke wali.

## 7. Tahun ajaran baru (naik kelas)

Lakukan setelah rapor semester genap dikunci dan tagihan tahun lama beres.

1. Buat **backup manual** (Sistem › Backup & restore).
2. Data Sekolah › **Tahun ajaran baru**:
   1. Periksa nama, tanggal tahun ajaran, dan semester baru (diusulkan +1 tahun).
   2. Periksa keputusan tiap santri. Usulan: **naik** ke tingkat berikutnya; kelas tertinggi
      diusulkan **lulus**. Ubah bila perlu: tinggal kelas, lompat kelas (pilih kelas tujuan),
      pindah sekolah, atau lulus.
   3. Lihat pratinjau (jumlah per keputusan & isi kelas baru), lalu **Jalankan**.
3. Hasilnya (satu langkah, semuanya atau tidak sama sekali): tahun baru aktif beserta semester
   1-nya, struktur kelas & wali kelas & tarif SPP disalin, santri pindah/lulus tidak lagi aktif
   dan tidak ditagih. **Tahun lama menjadi arsip baca-saja.**
4. Sesudahnya: atur ulang **pengajaran** guru untuk kelas tahun baru, periksa wali kelas, dan
   tambahkan santri baru (impor CSV).
5. Keliru? Pulihkan backup dari langkah 1.

## 8. Backup & restore

Sistem › **Backup & restore** (hanya admin).

- **Otomatis**: database penuh tiap N hari (default 7) pukul 02.00, disimpan di server (N dump
  terakhir) dan disalin ke Backblaze B2. Lampiran & logo disalin ke B2 sekali per berkas.
- **Backup sekarang**: sebelum perubahan besar (tahun ajaran baru, impor besar, rilis versi baru).
- **Unduh**: tiap akhir semester unduh satu backup dan simpan di Google Drive lembaga (salinan
  ketiga).
- Dashboard admin menampilkan backup terakhir yang berhasil; bila berwarna kuning/oranye atau ada
  notifikasi "Backup gagal", periksa halaman Backup.

**Restore** (mengganti SEMUA data dengan isi backup):

1. Pilih backup → **Pulihkan**. Aplikasi memeriksa versi skema backup.
2. Ketik **nama lembaga** persis seperti di Pengaturan untuk konfirmasi.
3. Aplikasi otomatis membuat backup kondisi sekarang, masuk **mode pemeliharaan** (semua pengguna
   melihat pesan "sedang dipulihkan"), memulihkan database, menjalankan migrasi bila perlu, dan
   mengunduh lampiran yang hilang dari B2.
4. Setelah selesai, pengguna mungkin perlu masuk ulang (sesi ikut dipulihkan dari backup).

Backup dari B2 (mis. dump lama atau server baru): buka "Backup di B2" → **Ambil ke server** →
Pulihkan. Berkas `.dump` dari Google Drive: **Unggah backup** → Pulihkan.

## 9. Log aktivitas

Sistem › **Log aktivitas**: siapa mengubah nilai, presensi lampau, tagihan, pembayaran, peran,
pengaturan, backup/restore, dan persetujuan data — dengan filter aksi, pengguna, dan tanggal.
Gunakan bila ada pertanyaan "siapa yang mengubah ini?".

## 10. Keamanan

- Jangan membagikan password admin; tiap orang punya akun sendiri.
- Data wali hanya terlihat oleh pihak yang berwenang; wali hanya melihat data anaknya.
- Jangan mengirim tangkapan layar berisi data santri ke grup umum.
- Laporkan perangkat yang hilang: hapus sesinya di **Profil › Perangkat** atau reset password
  pengguna itu.
