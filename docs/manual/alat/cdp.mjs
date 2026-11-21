// Pengendali Chrome headless lewat Chrome DevTools Protocol, tanpa dependensi (Node 24: WebSocket bawaan).
// Hanya untuk membuat manual di laptop pengembang; tidak dipakai aplikasi.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

export async function bukaChrome({ port = 9333 } = {}) {
  const profil = mkdtempSync(join(tmpdir(), "manual-chrome-"));
  const proses = spawn(
    "google-chrome",
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profil}`,
      "--no-first-run",
      "--hide-scrollbars",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let daftar;
  for (let i = 0; i < 50 && !daftar; i++) {
    await tunggu(200);
    daftar = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((r) => r.json())
      .catch(() => null);
  }
  const halaman = daftar?.find((t) => t.type === "page");
  if (!halaman) throw new Error("Chrome tidak bisa dibuka");
  const ws = new WebSocket(halaman.webSocketDebuggerUrl);
  await new Promise((ok, gagal) => {
    ws.onopen = ok;
    ws.onerror = gagal;
  });
  let id = 0;
  const menunggu = new Map();
  const pendengar = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && menunggu.has(m.id)) {
      const { ok, gagal } = menunggu.get(m.id);
      menunggu.delete(m.id);
      if (m.error) gagal(new Error(m.error.message));
      else ok(m.result);
    } else if (m.method && pendengar.has(m.method)) {
      for (const f of pendengar.get(m.method)) f(m.params);
      pendengar.delete(m.method);
    }
  };
  const kirim = (method, params = {}) =>
    new Promise((ok, gagal) => {
      const n = ++id;
      menunggu.set(n, { ok, gagal });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const sekali = (method) =>
    new Promise((ok) => pendengar.set(method, [...(pendengar.get(method) ?? []), ok]));

  await kirim("Page.enable");
  await kirim("Runtime.enable");

  return {
    kirim,
    async ukuran(lebar, tinggi, mobile = true) {
      await kirim("Emulation.setDeviceMetricsOverride", {
        width: lebar,
        height: tinggi,
        deviceScaleFactor: 2,
        mobile,
      });
      await kirim("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-color-scheme", value: "light" }],
      });
    },
    async buka(url) {
      const muat = sekali("Page.loadEventFired");
      await kirim("Page.navigate", { url });
      await Promise.race([muat, tunggu(15000)]);
      await this.tenang();
    },
    /** Tunggu sampai tidak ada kerangka pemuatan (skeleton) lalu beri jeda render. */
    async tenang(maks = 8000) {
      const mulai = Date.now();
      await tunggu(600);
      while (Date.now() - mulai < maks) {
        const sibuk = await this.js(
          "!!document.querySelector('[aria-busy=true], .animate-pulse') || document.readyState !== 'complete'",
        );
        if (!sibuk) break;
        await tunggu(250);
      }
      await tunggu(700);
    },
    async js(ekspresi) {
      const r = await kirim("Runtime.evaluate", {
        expression: ekspresi,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description ?? ekspresi);
      return r.result.value;
    },
    async foto({ penuh = false, maksTinggi = 2000, lebar = 390, tinggi = 844 } = {}) {
      if (penuh) {
        // Layar dibuat setinggi halaman agar elemen tetap (navbar bawah) berada di dasar gambar.
        const h = await this.js("document.documentElement.scrollHeight");
        await this.ukuran(lebar, Math.min(Math.max(h, tinggi), maksTinggi));
        await tunggu(700);
      }
      const r = await kirim("Page.captureScreenshot", { format: "jpeg", quality: 82 });
      if (penuh) await this.ukuran(lebar, tinggi);
      return Buffer.from(r.data, "base64");
    },
    async tutup() {
      ws.close();
      proses.kill();
      await new Promise((r) => proses.once("exit", r));
      // Profil sementara Chrome bisa ratusan MB; jangan ditinggal di /tmp.
      rmSync(profil, { recursive: true, force: true });
    },
  };
}

/** Cetak halaman HTML lokal ke PDF A4 (dipakai build-pdf.mjs). */
export async function cetakPdf(chrome, url, judul = "") {
  await chrome.buka(url);
  await chrome.js("document.fonts.ready.then(() => true)");
  const r = await chrome.kirim("Page.printToPDF", {
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="font-size:8px;color:#6b7a6e;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:sans-serif">
      <span>TARBIYAH · ${judul}</span><span>Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span></span></div>`,
  });
  return Buffer.from(r.data, "base64");
}
