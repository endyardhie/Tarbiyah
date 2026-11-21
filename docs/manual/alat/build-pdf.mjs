// Membangun manual PDF dari bab Markdown di docs/manual/ (tanpa dependensi; Chrome lokal).
// Jalankan: node docs/manual/alat/build-pdf.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bukaChrome, cetakPdf } from "./cdp.mjs";

const AKAR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(AKAR, "..", "..");
const KELUAR = join(AKAR, "pdf");
mkdirSync(KELUAR, { recursive: true });

const BAB = {
  pengantar: "00-pengantar.md",
  memulai: "01-memulai.md",
  wali: "02-wali-santri.md",
  guru: "03-guru-wali-kelas.md",
  bendahara: "04-bendahara.md",
  kepsek: "05-kepala-sekolah.md",
  admin: "06-admin.md",
  faq: "07-tanya-jawab.md",
};
const EDISI = [
  {
    berkas: "Panduan-Wali-Santri.pdf",
    judul: "Panduan Wali Santri",
    bab: ["pengantar", "memulai", "wali", "faq"],
  },
  {
    berkas: "Panduan-Guru-dan-Wali-Kelas.pdf",
    judul: "Panduan Guru dan Wali Kelas",
    bab: ["pengantar", "memulai", "guru", "faq"],
  },
  {
    berkas: "Panduan-Bendahara.pdf",
    judul: "Panduan Bendahara",
    bab: ["pengantar", "memulai", "bendahara", "faq"],
  },
  {
    berkas: "Panduan-Kepala-Sekolah.pdf",
    judul: "Panduan Kepala Sekolah",
    bab: ["pengantar", "memulai", "kepsek", "guru", "faq"],
  },
  {
    berkas: "Panduan-Admin.pdf",
    judul: "Panduan Admin",
    bab: ["pengantar", "memulai", "admin", "faq"],
  },
  { berkas: "Manual-Lengkap-TARBIYAH.pdf", judul: "Manual Lengkap", bab: Object.keys(BAB) },
];

// ---------------------------------------------------------------- Markdown (subset) → HTML
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(https:\/\/[^\s<)]+)/g, '<a href="$1">$1</a>');

const GAMBAR_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
function galeri(teks) {
  const gambar = [...teks.matchAll(GAMBAR_RE)].map(([, alt, src]) => {
    const lebar = src.includes("rapor") ? " lebar" : "";
    const url = pathToFileURL(join(AKAR, src)).href;
    return `<figure class="hp${lebar}"><img src="${url}" alt="${esc(alt)}"><figcaption>${esc(alt)}</figcaption></figure>`;
  });
  return `<div class="galeri">${gambar.join("")}</div>`;
}

let nomorJudul = 0;
function mdKeHtml(md, toc) {
  const baris = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const indent = (s) => s.match(/^ */)[0].length;
  const isItem = (s) => /^ *(-|\d+\.) /.test(s);

  function daftar(level) {
    const tipe = /^ *\d+\. /.test(baris[i]) ? "ol" : "ul";
    const item = [];
    while (i < baris.length && isItem(baris[i]) && indent(baris[i]) === level) {
      let teks = baris[i].replace(/^ *(-|\d+\.) /, "");
      i++;
      // Baris lanjutan (teks terbungkus) dengan indentasi lebih dalam yang bukan butir baru.
      while (i < baris.length && baris[i].trim() && !isItem(baris[i]) && indent(baris[i]) > level) {
        teks += ` ${baris[i].trim()}`;
        i++;
      }
      let anak = "";
      if (i < baris.length && isItem(baris[i]) && indent(baris[i]) > level)
        anak = daftar(indent(baris[i]));
      item.push(`<li>${inline(teks)}${anak}</li>`);
    }
    return `<${tipe}>${item.join("")}</${tipe}>`;
  }

  while (i < baris.length) {
    const b = baris[i];
    if (!b.trim()) {
      i++;
      continue;
    }
    const h = b.match(/^(#{1,3}) (.+)$/);
    if (h) {
      const lvl = h[1].length;
      const id = `j${++nomorJudul}`;
      if (lvl <= 2) toc.push({ lvl, id, teks: h[2] });
      out.push(`<h${lvl} id="${id}">${inline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }
    if (isItem(b)) {
      out.push(daftar(indent(b)));
      continue;
    }
    if (b.startsWith(">")) {
      const isi = [];
      while (i < baris.length && baris[i].startsWith(">")) isi.push(baris[i++].replace(/^> ?/, ""));
      out.push(`<aside class="tips">${inline(isi.join(" "))}</aside>`);
      continue;
    }
    if (b.startsWith("|")) {
      const rows = [];
      while (i < baris.length && baris[i].startsWith("|")) rows.push(baris[i++]);
      const sel = (r) =>
        r
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim());
      const [kepala, , ...isi] = rows;
      out.push(
        `<table><thead><tr>${sel(kepala)
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${isi
          .map(
            (r) =>
              `<tr>${sel(r)
                .map((c) => `<td>${inline(c)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table>`,
      );
      continue;
    }
    const para = [];
    while (i < baris.length && baris[i].trim() && !/^(#|>|\||\s*(-|\d+\.) )/.test(baris[i]))
      para.push(baris[i++]);
    const teks = para.join(" ");
    if (teks.replace(GAMBAR_RE, "").trim() === "") out.push(galeri(teks));
    else out.push(`<p>${inline(teks)}</p>`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------- Halaman
const font = pathToFileURL(
  join(
    REPO,
    "node_modules/@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  ),
).href;
const ikon = pathToFileURL(join(REPO, "src/client/public/icons/icon-192.png")).href;

const CSS = `
@font-face { font-family: "Jakarta"; src: url("${font}") format("woff2"); font-weight: 200 800; }
@page { size: A4; margin: 16mm 16mm 18mm; }
* { box-sizing: border-box; }
body { font-family: "Jakarta", sans-serif; color: #1f2a22; font-size: 10.5pt; line-height: 1.55; margin: 0; }
h1 { font-size: 22pt; color: #15803d; margin: 0 0 6mm; break-before: page; line-height: 1.2; }
h2 { font-size: 14pt; margin: 8mm 0 2mm; break-after: avoid; }
h3 { font-size: 11.5pt; margin: 5mm 0 1mm; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
ul, ol { padding-left: 6mm; margin: 2mm 0; }
li { margin: 1mm 0; }
code { background: #eef3ee; padding: 0 1.2mm; border-radius: 1mm; font-size: 9.5pt; }
a { color: #15803d; text-decoration: none; }
strong { font-weight: 700; }
aside.tips { background: #f0f7f1; border-left: 1.2mm solid #15803d; border-radius: 2mm; padding: 3mm 4mm; margin: 4mm 0; break-inside: avoid; }
table { border-collapse: collapse; width: 100%; margin: 3mm 0; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 0.3mm solid #cfd8cf; padding: 1.8mm 2.5mm; text-align: left; vertical-align: top; }
th { background: #eef3ee; }
.galeri { display: flex; gap: 8mm; justify-content: center; flex-wrap: wrap; margin: 4mm 0 5mm; break-inside: avoid; }
figure { margin: 0; text-align: center; break-inside: avoid; }
figure.hp img { width: 56mm; max-height: 120mm; object-fit: cover; object-position: top; border: 0.4mm solid #d8ddd6; border-radius: 4mm; }
figure.lebar img { width: 150mm; max-height: 200mm; border-radius: 2mm; }
figcaption { font-size: 8.5pt; color: #5d6b60; margin-top: 1.5mm; }
.sampul { height: 255mm; display: flex; flex-direction: column; justify-content: center; }
.sampul img { width: 22mm; height: 22mm; border-radius: 5mm; }
.sampul .merk { font-size: 34pt; font-weight: 800; color: #15803d; margin: 6mm 0 0; letter-spacing: -0.5pt; }
.sampul .judul { font-size: 22pt; font-weight: 700; margin: 2mm 0 0; }
.sampul .sub { font-size: 12pt; color: #5d6b60; margin-top: 4mm; }
.sampul .kaki { margin-top: auto; font-size: 9.5pt; color: #5d6b60; }
.isi h2 { break-before: auto; }
nav.toc { break-before: page; }
nav.toc h1 { break-before: avoid; }
nav.toc ol { list-style: none; padding: 0; }
nav.toc li.l1 { font-weight: 700; margin-top: 3mm; }
nav.toc li.l2 { padding-left: 6mm; color: #3d4a40; }
`;

const tanggal = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(
  new Date(),
);

function halaman(edisi) {
  nomorJudul = 0;
  const toc = [];
  const isi = edisi.bab
    .map((k) => mdKeHtml(readFileSync(join(AKAR, BAB[k]), "utf8"), toc))
    .join("\n");
  const daftarIsi = toc
    .map((t) => `<li class="l${t.lvl}"><a href="#${t.id}">${inline(t.teks)}</a></li>`)
    .join("");
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${edisi.judul}</title>
<style>${CSS}</style></head><body>
<section class="sampul">
  <img src="${ikon}" alt="">
  <p class="merk">TARBIYAH</p>
  <p class="judul">${edisi.judul}</p>
  <p class="sub">Sistem informasi sekolah, pondok pesantren, dan madrasah:<br>presensi, akademik, keuangan, dan informasi dalam satu aplikasi.</p>
  <p class="kaki">https://tarbiyah.minhajussunnah.web.id · Edisi ${tanggal}<br>Gambar memakai data contoh, bukan data santri sungguhan.</p>
</section>
<nav class="toc"><h1>Daftar isi</h1><ol>${daftarIsi}</ol></nav>
<main class="isi">${isi}</main>
</body></html>`;
}

const sementara = join(tmpdir(), "manual-tarbiyah");
mkdirSync(sementara, { recursive: true });
const chrome = await bukaChrome({ port: 9334 });
for (const e of EDISI) {
  const html = join(sementara, e.berkas.replace(/\.pdf$/, ".html"));
  writeFileSync(html, halaman(e));
  const pdf = await cetakPdf(chrome, pathToFileURL(html).href, e.judul);
  writeFileSync(join(KELUAR, e.berkas), pdf);
  console.log(`✓ ${e.berkas} (${Math.round(pdf.length / 1024)} KB)`);
}
await chrome.tutup();
