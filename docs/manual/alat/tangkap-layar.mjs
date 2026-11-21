// Membuat tangkapan layar HP (390×844) untuk manual dari server pengembangan (pnpm dev) yang
// berisi data contoh (pnpm db:seed --contoh lalu alat/isi-data.mjs). Hasil: docs/manual/gambar/.
// Jalankan: node docs/manual/alat/tangkap-layar.mjs [nama-gambar ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bukaChrome } from "./cdp.mjs";

const ASAL = process.env.MANUAL_URL ?? "http://localhost:5173";
const KELUAR = join(dirname(fileURLToPath(import.meta.url)), "..", "gambar");
mkdirSync(KELUAR, { recursive: true });

// Akun data contoh (password "contoh123"); admin memakai password dari isi-data.mjs.
const AKUN = {
  wali: ["628000300076", "contoh123"],
  guru: ["628000100008", "contoh123"],
  walikelas: ["628000100005", "contoh123"],
  bendahara: ["628000100015", "contoh123"],
  kepsek: ["628000100014", "contoh123"],
  admin: ["081200000000", "manual12345"],
};

// Fungsi bantu yang dijalankan di halaman.
const BANTU = `
window.__el = (teks, pilih = 'button, a, [role=tab], label, summary') =>
  [...document.querySelectorAll(pilih)].find((e) => e.offsetParent !== null &&
    (e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').startsWith(teks));
window.__klik = (teks, pilih) => { const e = window.__el(teks, pilih); if (!e) throw new Error('Tidak ada: ' + teks); e.click(); return true; };
window.__pilih = (cocok, teksOpsi, ke = 0) => {
  const s = [...document.querySelectorAll('main select, [role=dialog] select')].filter((x) => x.offsetParent !== null)
    .filter((x) => [...x.options].some((o) => o.text.includes(teksOpsi)))[ke];
  if (!s) throw new Error('Tidak ada pilihan: ' + teksOpsi);
  const o = [...s.options].find((o) => o.text.includes(teksOpsi));
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value);
  s.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};
true`;

const klik = (teks, pilih) =>
  `__klik(${JSON.stringify(teks)}${pilih ? `, ${JSON.stringify(pilih)}` : ""})`;
const pilih = (opsi) => `__pilih(null, ${JSON.stringify(opsi)})`;

/** Daftar gambar: akun, alamat, langkah (JS di halaman), dan opsi foto. */
const GAMBAR = [
  {
    nama: "umum-login",
    akun: null,
    url: "/login",
    // Widget Turnstile mode uji bertuliskan "hanya untuk pengujian"; di aplikasi asli tampil centang.
    langkah: [
      "[...document.querySelectorAll('div')].filter((d) => d.className === 'min-h-[65px]').forEach((d) => (d.style.visibility = 'hidden')) ?? true",
    ],
  },
  { nama: "umum-menu", akun: "walikelas", url: "/", langkah: [klik("Menu")] },
  { nama: "umum-profil", akun: "walikelas", url: "/profil", penuh: true },
  { nama: "umum-informasi", akun: "wali", url: "/informasi" },
  { nama: "umum-jadwal", akun: "wali", url: "/informasi/jadwal", penuh: true, maksTinggi: 1500 },
  { nama: "umum-kalender", akun: "wali", url: "/informasi/kalender", penuh: true },
  { nama: "umum-pengumuman", akun: "wali", url: "/informasi/pengumuman", penuh: true },
  { nama: "umum-notifikasi", akun: "wali", url: "/notifikasi" },

  { nama: "wali-beranda", akun: "wali", url: "/", penuh: true },
  {
    nama: "wali-tagihan",
    akun: "wali",
    url: "/keuangan",
    langkah: [pilih("Syifa"), klik("SPP", "label")],
  },
  { nama: "wali-tagihan-lunas", akun: "wali", url: "/keuangan", langkah: [pilih("Fatimah")] },
  { nama: "wali-akademik", akun: "wali", url: "/akademik", langkah: [klik("Syifa")], penuh: true },
  { nama: "wali-presensi", akun: "wali", url: "/presensi", penuh: true },
  {
    nama: "wali-rapor",
    akun: "wali",
    url: "/akademik",
    langkah: [klik("Syifa")],
    rapor: true,
    lebar: 820,
    tinggi: 1150,
    penuh: true,
  },

  {
    nama: "guru-tugas",
    akun: "guru",
    url: "/akademik",
    langkah: [pilih("Fiqih · Kelas 1 Banat MDTU KOTA")],
    penuh: true,
  },
  {
    nama: "guru-tugas-baru",
    akun: "guru",
    url: "/akademik",
    langkah: [pilih("Fiqih · Kelas 1 Banat MDTU KOTA"), klik("Tugas baru")],
  },
  {
    nama: "guru-nilai",
    akun: "guru",
    url: "/akademik",
    langkah: [klik("Nilai", "[role=tab]"), pilih("Fiqih · Kelas 1 Banat MDTU KOTA")],
  },
  {
    nama: "guru-penilaian-baru",
    akun: "guru",
    url: "/akademik",
    langkah: [
      klik("Nilai", "[role=tab]"),
      pilih("Fiqih · Kelas 1 Banat MDTU KOTA"),
      klik("Penilaian baru"),
    ],
  },
  {
    nama: "guru-isi-nilai",
    akun: "guru",
    url: "/akademik",
    langkah: [
      klik("Nilai", "[role=tab]"),
      pilih("Fiqih · Kelas 1 Banat MDTU KOTA"),
      "document.querySelector('main ul li button, main ul li a')?.click() ?? true",
    ],
  },
  {
    nama: "guru-rapor-mapel",
    akun: "guru",
    url: "/akademik",
    langkah: [klik("Rapor mapel", "[role=tab]"), pilih("Fiqih · Kelas 1 Banat MDTU KOTA")],
  },

  { nama: "walikelas-beranda", akun: "walikelas", url: "/", penuh: true },
  { nama: "walikelas-presensi", akun: "walikelas", url: "/presensi" },
  {
    nama: "walikelas-presensi-laporan",
    akun: "walikelas",
    url: "/presensi",
    langkah: [klik("Laporan", "[role=tab]")],
    penuh: true,
  },
  {
    nama: "walikelas-rapor-kelas",
    akun: "walikelas",
    url: "/akademik",
    langkah: [klik("Rapor kelas", "[role=tab]")],
  },

  { nama: "bendahara-tagihan", akun: "bendahara", url: "/keuangan" },
  { nama: "bendahara-filter", akun: "bendahara", url: "/keuangan", langkah: [klik("Filter")] },
  {
    nama: "bendahara-catat-bayar",
    akun: "bendahara",
    url: "/keuangan",
    langkah: [klik("Catat bayar")],
  },
  {
    nama: "bendahara-tarif",
    akun: "bendahara",
    url: "/keuangan",
    langkah: [klik("Tarif & potongan", "[role=tab]")],
    penuh: true,
  },
  {
    nama: "bendahara-laporan",
    akun: "bendahara",
    url: "/keuangan",
    langkah: [klik("Laporan", "[role=tab]")],
    penuh: true,
  },
  {
    nama: "bendahara-wa",
    akun: "bendahara",
    url: "/keuangan",
    langkah: [klik("Antrean WA", "[role=tab]")],
  },

  { nama: "kepsek-beranda", akun: "kepsek", url: "/", penuh: true },
  {
    nama: "kepsek-kunci-rapor",
    akun: "kepsek",
    url: "/akademik",
    langkah: [klik("Rapor kelas", "[role=tab]")],
  },
  {
    nama: "kepsek-pengumuman-baru",
    akun: "kepsek",
    url: "/informasi/pengumuman",
    langkah: [klik("Buat pengumuman")],
  },

  { nama: "admin-beranda", akun: "admin", url: "/", penuh: true },
  { nama: "admin-sistem", akun: "admin", url: "/sistem" },
  { nama: "admin-pengguna", akun: "admin", url: "/sistem/pengguna" },
  {
    nama: "admin-pengaturan",
    akun: "admin",
    url: "/sistem/pengaturan",
    penuh: true,
    maksTinggi: 1700,
  },
  { nama: "admin-backup", akun: "admin", url: "/sistem/backup", penuh: true, maksTinggi: 1700 },
  { nama: "admin-sekolah", akun: "admin", url: "/sekolah", penuh: true },
  { nama: "admin-santri", akun: "admin", url: "/sekolah/santri" },
  { nama: "admin-impor", akun: "admin", url: "/sekolah/impor", penuh: true },
  { nama: "admin-kelas", akun: "admin", url: "/sekolah/kelas" },
  { nama: "admin-pengajaran", akun: "admin", url: "/sekolah/pengajaran" },
  { nama: "admin-tahun-baru", akun: "admin", url: "/sekolah/tahun-baru", penuh: true },
  { nama: "admin-log", akun: "admin", url: "/sistem/log" },

  // Gambar untuk README (satu layar, tanpa gulir).
  { nama: "readme-wali-beranda", akun: "wali", url: "/" },
  { nama: "readme-wali-akademik", akun: "wali", url: "/akademik", langkah: [klik("Syifa")] },
  { nama: "readme-jadwal", akun: "wali", url: "/informasi/jadwal" },
  { nama: "readme-kepsek-beranda", akun: "kepsek", url: "/" },
  { nama: "readme-gelap", akun: "walikelas", url: "/presensi", gelap: true },
  { nama: "readme-desktop", akun: "kepsek", url: "/", lebar: 1280, tinggi: 800 },
];

const hanya = process.argv.slice(2);
const daftar = hanya.length ? GAMBAR.filter((g) => hanya.includes(g.nama)) : GAMBAR;

const chrome = await bukaChrome();
await chrome.ukuran(390, 844);
let akunAktif;

async function masuk(akun) {
  if (akunAktif === akun) return;
  await chrome.buka(`${ASAL}/login`);
  await chrome.js(`fetch('/api/auth/logout', { method: 'POST' }).then(() => true)`);
  if (akun) {
    const [nomor, password] = AKUN[akun];
    await chrome.js(`(async () => {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ nomor: '${nomor}', password: '${password}', turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX' }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      if (b.perluPersetujuan) await fetch('/api/me/persetujuan', { method: 'POST' });
      return true;
    })()`);
  }
  akunAktif = akun;
}

for (const g of daftar) {
  try {
    await masuk(g.akun);
    await chrome.ukuran(390, 844);
    await chrome.buka(ASAL + g.url);
    await chrome.js(BANTU);
    for (const l of g.langkah ?? []) {
      await chrome.js(l);
      await chrome.tenang(4000);
    }
    if (g.rapor) {
      // Tombol rapor membuka jendela baru; ambil alamatnya lalu buka di tab ini.
      const url =
        await chrome.js(`(() => { let u; const o = window.open; window.open = (x) => { u = x; return null; };
        __klik('Rapor semester'); window.open = o; return u; })()`);
      await chrome.buka(ASAL + url);
      await chrome.tenang(4000);
      // Rapor ada di iframe setinggi 80% layar; samakan tingginya dengan isi agar tidak terpotong/kosong.
      await chrome.js(`(() => { const f = document.querySelector('iframe');
        f.style.height = f.contentDocument.documentElement.scrollHeight + 24 + 'px'; return true; })()`);
    }
    if (g.lebar) {
      await chrome.ukuran(g.lebar, g.tinggi ?? 844, false);
      await chrome.tenang(3000);
    }
    if (g.gelap) {
      // Tema dibaca saat halaman dimuat (localStorage "tema"); set lalu muat ulang.
      await chrome.js("localStorage.setItem('tema', 'dark'), true");
      await chrome.buka(ASAL + g.url);
      await chrome.js(BANTU);
    }
    const jpg = await chrome.foto({
      penuh: g.penuh,
      maksTinggi: g.maksTinggi,
      lebar: g.lebar ?? 390,
      tinggi: g.tinggi ?? 844,
    });
    writeFileSync(join(KELUAR, `${g.nama}.jpg`), jpg);
    if (g.gelap) await chrome.js("localStorage.removeItem('tema'), true");
    console.log("✓", g.nama);
  } catch (e) {
    console.log("✗", g.nama, e.message);
  }
}
await chrome.tutup();
