# Manual pengguna TARBIYAH

PDF siap bagikan ada di [`pdf/`](pdf/):

| Berkas | Untuk |
| --- | --- |
| `Panduan-Wali-Santri.pdf` | Wali santri / orang tua |
| `Panduan-Guru-dan-Wali-Kelas.pdf` | Guru pengajar dan wali kelas |
| `Panduan-Bendahara.pdf` | Bendahara |
| `Panduan-Kepala-Sekolah.pdf` | Kepala sekolah (termasuk bab guru) |
| `Panduan-Admin.pdf` | Admin / tata usaha |
| `Manual-Lengkap-TARBIYAH.pdf` | Semua bab |

Setiap panduan berisi pengantar, *Memulai* (masuk, pasang aplikasi, profil, notifikasi, informasi),
bab perannya, dan tanya jawab.

## Sumber

Isi ditulis dalam Markdown (`00-pengantar.md` … `07-tanya-jawab.md`); gambar di `gambar/`. Ubah
teks di berkas `.md`, lalu bangun ulang PDF:

```bash
node docs/manual/alat/build-pdf.mjs
```

Pembangun memakai Google Chrome yang terpasang di laptop (tanpa dependensi tambahan) dan font
aplikasi dari `node_modules`.

## Memperbarui tangkapan layar

Hanya di database pengembangan, karena data diubah:

1. Buat database kosong, lalu isi data contoh:
   `SEED_ADMIN_PHONE=081200000000 SEED_ADMIN_PASSWORD=admin12345 pnpm db:seed --contoh`.
2. Agar gambar rapi: hapus penanda data contoh dan rapikan nama lembaga, lalu (bila hari ini Ahad)
   hapus libur Ahad agar layar presensi tidak berisi "Hari libur":

   ```sql
   delete from settings where key = 'data_contoh';
   update settings set value = jsonb_set(value, '{nama}', '"Pondok Pesantren Contoh"') where key = 'identitas';
   delete from libur_mingguan where hari = 7;
   ```

3. Jalankan `pnpm dev` (mulai ulang bila sudah berjalan, karena identitas di-cache), lalu
   `node docs/manual/alat/isi-data.mjs`.
4. `node docs/manual/alat/tangkap-layar.mjs` (semua gambar) atau sebutkan nama gambar tertentu,
   misalnya `node docs/manual/alat/tangkap-layar.mjs wali-beranda`.
5. Bangun ulang PDF.
