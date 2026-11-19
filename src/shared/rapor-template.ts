/** Data yang tersedia untuk template rapor (satu santri). */
export type RaporContext = {
  lembaga: { nama: string; alamat: string; logo: string };
  tahunAjaran: string;
  semester: number;
  semesterLabel: string;
  draft: boolean;
  santri: { nama: string; nis: string; namaPanggilan: string; jenisKelamin: string; ttl: string };
  kelas: { nama: string; unit: string; lokasi: string; waliKelas: string };
  mapel: {
    no: number;
    nama: string;
    namaArab: string;
    kkm: string;
    nilai: string;
    predikat: string;
    deskripsi: string;
  }[];
  aspek: { kelompok: string; nama: string; nilai: string }[];
  absensi: { sakit: number; izin: number; alpa: number };
  catatan: string;
  keputusan: string;
  tanggalCetak: string;
};

/** Template bawaan: A4 tegak, kop dengan logo, identitas, nilai, aspek, absensi, catatan, tanda tangan. */
export const DEFAULT_TEMPLATE = {
  nama: "Rapor bawaan",
  html: `<div class="rapor">
  {{#draft}}<div class="draft">DRAFT</div>{{/draft}}
  <header class="kop">
    {{#lembaga.logo}}<img src="{{lembaga.logo}}" alt="" class="logo">{{/lembaga.logo}}
    <div>
      <h1>{{lembaga.nama}}</h1>
      <p>{{lembaga.alamat}}</p>
    </div>
  </header>
  <h2>LAPORAN HASIL BELAJAR SANTRI</h2>
  <table class="identitas">
    <tr><td>Nama</td><td>: {{santri.nama}}</td><td>Kelas</td><td>: {{kelas.nama}} ({{kelas.unit}} {{kelas.lokasi}})</td></tr>
    <tr><td>NIS</td><td>: {{santri.nis}}</td><td>Semester</td><td>: {{semester}} ({{semesterLabel}})</td></tr>
    <tr><td>Tempat, tgl lahir</td><td>: {{santri.ttl}}</td><td>Tahun ajaran</td><td>: {{tahunAjaran}}</td></tr>
  </table>

  <h3>A. Nilai Mata Pelajaran</h3>
  <table class="nilai">
    <thead><tr><th>No</th><th>Mata Pelajaran</th><th>KKM</th><th>Nilai</th><th>Predikat</th><th>Deskripsi</th></tr></thead>
    <tbody>
      {{#mapel}}
      <tr>
        <td class="c">{{no}}</td>
        <td>{{nama}}{{#namaArab}}<br><span class="arab" dir="rtl" lang="ar">{{namaArab}}</span>{{/namaArab}}</td>
        <td class="c">{{kkm}}</td><td class="c">{{nilai}}</td><td class="c">{{predikat}}</td><td>{{deskripsi}}</td>
      </tr>
      {{/mapel}}
    </tbody>
  </table>

  <h3>B. Sikap, Hafalan &amp; Kepribadian</h3>
  <table class="nilai">
    <thead><tr><th>Kelompok</th><th>Aspek</th><th>Nilai</th></tr></thead>
    <tbody>
      {{#aspek}}<tr><td>{{kelompok}}</td><td>{{nama}}</td><td class="c">{{nilai}}</td></tr>{{/aspek}}
      {{^aspek}}<tr><td colspan="3" class="c">—</td></tr>{{/aspek}}
    </tbody>
  </table>

  <div class="dua">
    <div>
      <h3>C. Ketidakhadiran</h3>
      <table class="nilai">
        <tr><td>Sakit</td><td class="c">{{absensi.sakit}} hari</td></tr>
        <tr><td>Izin</td><td class="c">{{absensi.izin}} hari</td></tr>
        <tr><td>Tanpa keterangan</td><td class="c">{{absensi.alpa}} hari</td></tr>
      </table>
    </div>
    <div>
      <h3>D. Catatan Wali Kelas</h3>
      <div class="catatan">{{catatan}}</div>
      {{#keputusan}}<p class="keputusan"><strong>Keputusan:</strong> {{keputusan}}</p>{{/keputusan}}
    </div>
  </div>

  <div class="ttd">
    <div>Orang tua/wali<br><br><br><br>(........................)</div>
    <div>{{tanggalCetak}}<br>Wali kelas<br><br><br><br><strong>{{kelas.waliKelas}}</strong></div>
    <div>Mengetahui,<br>Kepala sekolah<br><br><br><br>(........................)</div>
  </div>
</div>`,
  css: `@page { size: A4; margin: 15mm; }
body { font-family: "Plus Jakarta Sans Variable", Arial, sans-serif; font-size: 10.5pt; color: #000; margin: 0; }
.rapor { position: relative; padding-right: 1px; } /* garis tepi kanan tabel tidak terpotong */
.draft { position: absolute; top: 35%; left: 0; right: 0; text-align: center; font-size: 90pt; color: rgba(200,0,0,.12); transform: rotate(-25deg); pointer-events: none; }
.kop { display: flex; align-items: center; gap: 12px; border-bottom: 3px double #000; padding-bottom: 8px; }
.kop .logo { width: 64px; height: 64px; object-fit: contain; }
.kop h1 { font-size: 15pt; margin: 0; text-transform: uppercase; }
.kop p { margin: 2px 0 0; font-size: 9.5pt; }
h2 { text-align: center; font-size: 12.5pt; margin: 14px 0 8px; }
h3 { font-size: 11pt; margin: 14px 0 6px; }
table { width: 100%; border-collapse: collapse; }
.identitas td { padding: 1px 4px; vertical-align: top; }
.nilai th, .nilai td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
.nilai th { background: #eee; }
.c { text-align: center; }
.arab { font-family: "Amiri", "Scheherazade New", "Traditional Arabic", serif; font-size: 12pt; }
.dua { display: grid; grid-template-columns: 1fr 1.4fr; gap: 16px; }
.catatan { border: 1px solid #000; min-height: 60px; padding: 6px; white-space: pre-line; }
.ttd { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; margin-top: 28px; }`,
};

export const SAMPLE_CONTEXT: RaporContext = {
  lembaga: { nama: "Pondok Pesantren Contoh", alamat: "Jl. Contoh No. 1, Jayapura", logo: "" },
  tahunAjaran: "2026/2027",
  semester: 1,
  semesterLabel: "Ganjil",
  draft: false,
  santri: {
    nama: "Ahmad Fauzi",
    nis: "1001",
    namaPanggilan: "Ahmad",
    jenisKelamin: "L",
    ttl: "Jayapura, 21 Maret 2017",
  },
  kelas: { nama: "Kelas 1 Banin", unit: "MDTU", lokasi: "KOTA", waliKelas: "Ustadz Contoh" },
  mapel: [
    {
      no: 1,
      nama: "Al-Qur'an",
      namaArab: "القرآن",
      kkm: "70",
      nilai: "92",
      predikat: "A",
      deskripsi: "Sangat baik dalam menguasai materi Al-Qur'an.",
    },
    {
      no: 2,
      nama: "Fiqih",
      namaArab: "الفقه",
      kkm: "70",
      nilai: "85",
      predikat: "B",
      deskripsi: "Baik dalam menguasai materi Fiqih.",
    },
  ],
  aspek: [
    { kelompok: "Sikap", nama: "Akhlak", nilai: "A" },
    { kelompok: "Hafalan", nama: "Juz 30", nilai: "An-Naba' s.d. Al-Fajr" },
  ],
  absensi: { sakit: 2, izin: 1, alpa: 0 },
  catatan: "Pertahankan semangat belajar dan hafalannya.",
  keputusan: "",
  tanggalCetak: "Jayapura, 19 Desember 2026",
};
