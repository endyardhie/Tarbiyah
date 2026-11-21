// Melengkapi data contoh (pnpm db:seed --contoh) untuk tangkapan layar manual: jadwal, presensi
// seminggu, PR, pengumuman, agenda, satu rapor final, satu pembayaran, dan pembayaran online (tiruan).
// HANYA untuk database pengembangan. Jalankan: node docs/manual/alat/isi-data.mjs
const ASAL = process.env.MANUAL_URL ?? "http://localhost:5173";
const B = `${ASAL}/api`;

async function sesi(nomor, password) {
  const r = await fetch(`${B}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ASAL },
    body: JSON.stringify({ nomor, password, turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }),
  });
  if (!r.ok) throw new Error(`login ${nomor}: ${r.status} ${await r.text()}`);
  const cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return async (method, path, body) => {
    const res = await fetch(B + path, {
      method,
      headers: { cookie, origin: ASAL, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  };
}

// Admin seed wajib ganti password saat masuk pertama; tangkap-layar.mjs memakai "manual12345".
const PASSWORD_SEED = process.env.SEED_ADMIN_PASSWORD ?? "admin12345";
let api = await sesi("081200000000", PASSWORD_SEED).catch(() => null);
if (api)
  await api("POST", "/me/password", { passwordLama: PASSWORD_SEED, passwordBaru: "manual12345" });
api = await sesi("081200000000", "manual12345");

const kelas = await api("GET", "/kelas");
const ajar = await api("GET", "/pengajaran");
const ta = (await api("GET", "/tahun-ajaran")).find((t) => t.aktif);
const semester = ta.semester.find((s) => s.aktif) ?? ta.semester[0];
const kelasRapor = kelas.find(
  (k) => k.nama === "Kelas 1 Banat" && k.unitKode === "MDTU" && k.lokasiNama === "KOTA",
);

// Jadwal: 5 hari × 3 jam per kelas.
const jam = [
  ["07:30", "08:10"],
  ["08:10", "08:50"],
  ["09:10", "09:50"],
];
for (const k of kelas) {
  const mp = ajar.filter((p) => p.kelasId === k.id);
  for (let h = 1; mp.length && h <= 5; h++)
    for (let i = 0; i < 3; i++) {
      const m = mp[(h + i) % mp.length];
      await api("POST", "/jadwal", {
        pengajaranId: m.id,
        hari: h,
        jamMulai: jam[i][0],
        jamSelesai: jam[i][1],
      });
    }
}

// Presensi Senin–Jumat 16–20 November 2026; sebagian besar hadir.
for (const k of kelas)
  for (const [di, t] of [
    "2026-11-16",
    "2026-11-17",
    "2026-11-18",
    "2026-11-19",
    "2026-11-20",
  ].entries()) {
    const d = await api("GET", `/presensi?kelasId=${k.id}&tanggal=${t}`);
    if (d.libur || !d.santri?.length) continue;
    const status = (i) =>
      (i * 7 + di * 3) % 23 === 0
        ? "S"
        : (i * 5 + di) % 31 === 0
          ? "I"
          : (i + di * 11) % 41 === 0
            ? "A"
            : "H";
    await api("PUT", "/presensi", {
      kelasId: k.id,
      tanggal: t,
      items: d.santri.map((s, i) => ({
        pendaftaranId: s.pendaftaranId,
        status: status(i),
        keterangan: null,
      })),
    });
  }

// PR.
const mapel = (nama) => ajar.find((p) => p.kelasId === kelasRapor.id && p.mapelNama === nama);
await api("POST", "/tugas", {
  pengajaranId: mapel("Fiqih").id,
  judul: "Hafalkan rukun wudhu",
  deskripsi: "Hafalkan 6 rukun wudhu beserta artinya. Akan disetor di pertemuan berikutnya.",
  tanggalDiberi: "2026-11-20",
  tenggat: "2026-11-27",
});
await api("POST", "/tugas", {
  pengajaranId: mapel("Al-Qur'an").id,
  judul: "Murajaah Surat An-Naba ayat 1–20",
  deskripsi: "Ulangi hafalan di rumah bersama orang tua, minimal 3 kali sehari.",
  tanggalDiberi: "2026-11-19",
  tenggat: "2026-11-26",
});

// Pengumuman & agenda.
for (const [judul, isi] of [
  [
    "Pembagian rapor semester 1",
    "Pembagian rapor semester 1 dilaksanakan Sabtu, 19 Desember 2026 pukul 09.00 WIT. Wali santri dimohon hadir.",
  ],
  [
    "Libur akhir semester",
    "Kegiatan belajar diliburkan 21 Desember 2026 – 3 Januari 2027. Masuk kembali Senin, 4 Januari 2027.",
  ],
])
  await api("POST", "/pengumuman", { judul, isi, sasaran: [{}], kirimNotifikasi: false });
await api("POST", "/agenda", {
  judul: "Ujian akhir semester 1",
  deskripsi: "Ujian tertulis dan lisan semua mapel.",
  mulai: "2026-12-07",
  selesai: "2026-12-12",
  libur: false,
  sasaran: [{}],
});
await api("POST", "/agenda", {
  judul: "Libur akhir semester",
  deskripsi: null,
  mulai: "2026-12-21",
  selesai: "2027-01-03",
  libur: true,
  sasaran: [{}],
});

// Rapor final hanya untuk Syifa Syahputra (anak wali contoh), lengkap dengan aspek & catatan.
const syifa = (
  await api("GET", `/presensi?kelasId=${kelasRapor.id}&tanggal=2026-11-20`)
).santri.find((s) => s.nama === "Syifa Syahputra");
const pengaturan = await api("GET", `/akademik/pengaturan/${kelasRapor.unitId}`);
const nilaiAspek = {
  Akhlak: "A",
  Kedisiplinan: "B",
  Kebersihan: "A",
  "Hafalan Juz 30": "An-Naba – Al-Insyiqaq",
};
await api("PUT", `/rapor/kelas/${syifa.pendaftaranId}`, {
  semesterId: semester.id,
  aspek: pengaturan.aspek
    .filter((a) => a.aktif)
    .map((a) => ({ aspekId: a.id, nilai: nilaiAspek[a.nama] ?? "B" })),
  catatanWali:
    "Ananda santun dan rajin. Pertahankan semangat menghafal dan tingkatkan murajaah di rumah.",
  keputusan: null,
});
await api("POST", "/rapor/kunci", {
  kelasId: kelasRapor.id,
  semesterId: semester.id,
  pendaftaranIds: [syifa.pendaftaranId],
});

// Satu tagihan lunas tunai untuk contoh riwayat.
const tagihan = await api("GET", "/keuangan/tagihan?periode=2026-11");
const fatimah = tagihan.find((t) => t.santriNama === "Fatimah Rahman");
if (fatimah)
  await api("POST", `/keuangan/tagihan/${fatimah.id}/bayar`, { metode: "tunai", catatan: null });

// Pembayaran online aktif (tiruan) agar layar pilih bulan & tombol Bayar tampil.
const pb = await api("GET", "/pengaturan/pembayaran");
await api("PUT", "/pengaturan/pembayaran", {
  ...pb,
  aktif: true,
  url: "http://noken-pay:3000",
  apiKey: "kunci-tiruan-manual",
  webhookSecret: "rahasia-tiruan-manual",
});
console.log("Data manual siap.");
