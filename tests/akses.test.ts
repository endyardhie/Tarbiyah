import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, ORIGIN, type TestContext } from "./helpers/app";

/**
 * Matriks hak akses terhadap SEMUA endpoint yang terdaftar di app:
 * - tanpa login: hanya endpoint publik yang boleh menjawab selain 401/403/404;
 * - wali santri: endpoint staf/admin tidak pernah menjawab 2xx;
 * - tidak ada endpoint yang menjawab 5xx untuk input sembarang.
 */
let t: TestContext;
let wali: string;
let guru: string;
let santriLain: string;
const UUID = "01960000-0000-7000-8000-000000000000";

const PUBLIK = new Set([
  "GET /api/health",
  "GET /api/public-config",
  "POST /api/auth/login",
  "POST /api/auth/otp/minta",
  "POST /api/auth/otp/reset",
  "GET /api/backup/status",
  "POST /api/webhooks/:provider",
  "GET /api/files/:id",
  "GET /api/push/kunci", // kunci publik VAPID, memang publik
]);

/** Endpoint yang tidak boleh berhasil untuk wali santri biasa. */
const KHUSUS_STAF = [
  /^\/api\/pengaturan(?!\/identitas$)/,
  /^\/api\/backup(?!\/status$)/,
  /^\/api\/audit/,
  /^\/api\/tahun-baru/,
  /^\/api\/users/,
  /^\/api\/roles/,
  /^\/api\/impor/,
  /^\/api\/wali/,
  /^\/api\/santri-wali/,
  /^\/api\/keuangan\/(tagihan|laporan|ekspor|tarif|potongan|wa|ringkasan|santri|perlu-dicek|pembayaran)/,
  /^\/api\/presensi\/rekap-unit/,
];

function semuaRute() {
  const seen = new Set<string>();
  const out: { method: string; path: string }[] = [];
  for (const r of t.app.routes) {
    if (r.method === "ALL" || !r.path.startsWith("/api/") || r.path.includes("*")) continue;
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ method: r.method, path: r.path });
  }
  return out;
}

const isi = (path: string) => path.replace(/:provider/g, "noken-pay").replace(/:[A-Za-z]+/g, UUID);

async function panggil(method: string, path: string, cookie?: string) {
  return t.req(method, isi(path), {
    cookie,
    body: method === "GET" || method === "DELETE" ? undefined : {},
    headers: { origin: ORIGIN },
  });
}

beforeAll(async () => {
  t = await createTestContext();
  await t.makeUser({ nama: "Admin", nomor: "6282400000001", roleNama: ["Admin"] });
  const admin = (await t.login("6282400000001", "rahasia123")).cookie;
  await t.makeUser({ nama: "Guru", nomor: "6282400000002" });
  guru = (await t.login("6282400000002", "rahasia123")).cookie;
  const post = (path: string, body: unknown) => t.req("POST", path, { cookie: admin, body });
  const lok = (await post("/api/lokasi", { nama: "KOTA" })).body.id;
  const unit = (await post("/api/units", { kode: "TA", nama: "Taman" })).body.id;
  const ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).body.id;
  await post(`/api/tahun-ajaran/${ta}/aktifkan`, {});
  const kelas = (
    await post("/api/kelas", {
      tahunAjaranId: ta,
      unitId: unit,
      lokasiId: lok,
      nama: "A",
      tingkat: 1,
    })
  ).body.id;
  const s = (await post("/api/santri", { nis: "Z1", nama: "Zaid", kelasId: kelas })).body.id;
  // Santri lain di kelas yang sama, dengan wali lain: tidak boleh terlihat oleh wali Zaid.
  santriLain = (await post("/api/santri", { nis: "Z2", nama: "Yusuf", kelasId: kelas })).body.id;
  const w = (await post("/api/wali", { nama: "Wali Zaid", phones: [{ nomor: "6282400000200" }] }))
    .body;
  await t.req("PUT", "/api/santri-wali", { cookie: admin, body: { santriId: s, userId: w.id } });
  await t.db.execute(sql`update users set wajib_ganti_password = false`);
  wali = (await t.login("6282400000200", w.passwordSementara)).cookie;
});
afterAll(() => t.drop());

describe("matriks hak akses semua endpoint", () => {
  it("daftar rute terbaca (sanity)", () => {
    expect(semuaRute().length).toBeGreaterThan(100);
  });

  it("tanpa login: selain endpoint publik → 401/403/404, tidak pernah 5xx", async () => {
    const bocor: string[] = [];
    for (const r of semuaRute()) {
      const res = await panggil(r.method, r.path);
      const key = `${r.method} ${r.path}`;
      if (res.status >= 500) bocor.push(`${key} → ${res.status}`);
      else if (!PUBLIK.has(key) && ![401, 403, 404].includes(res.status)) {
        bocor.push(`${key} → ${res.status}`);
      }
    }
    expect(bocor).toEqual([]);
  });

  it("wali santri: endpoint staf/admin tidak pernah berhasil; tidak ada 5xx", async () => {
    const bocor: string[] = [];
    for (const r of semuaRute()) {
      if (r.path === "/api/auth/logout") continue; // mengakhiri sesi tes
      const res = await panggil(r.method, r.path, wali);
      const key = `${r.method} ${r.path}`;
      if (res.status >= 500) bocor.push(`${key} → ${res.status}`);
      else if (KHUSUS_STAF.some((re) => re.test(r.path)) && res.status < 300) {
        bocor.push(`${key} → ${res.status}`);
      }
    }
    expect(bocor).toEqual([]);
  });

  it("guru tanpa jabatan: endpoint admin tidak pernah berhasil", async () => {
    const bocor: string[] = [];
    for (const r of semuaRute()) {
      if (r.path === "/api/auth/logout") continue;
      if (!KHUSUS_STAF.slice(0, 7).some((re) => re.test(r.path))) continue;
      const res = await panggil(r.method, r.path, guru);
      if (res.status < 300 || res.status >= 500)
        bocor.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(bocor).toEqual([]);
  });
});

describe("akses berbasis relasi (id sungguhan)", () => {
  it("wali tidak bisa membuka data santri lain lewat endpoint ber-parameter santri", async () => {
    const bocor: string[] = [];
    const rute = semuaRute().filter((r) => r.method === "GET" && r.path.includes(":santriId"));
    expect(rute.length).toBeGreaterThan(0);
    for (const r of rute) {
      const path = r.path.replace(":santriId", santriLain).replace(/:[A-Za-z]+/g, UUID);
      const res = await t.req("GET", path, { cookie: wali });
      if (res.status < 400 || res.status >= 500) bocor.push(`${r.path} → ${res.status}`);
    }
    const lain = [
      `/api/santri/${santriLain}`,
      `/api/presensi/laporan?santriId=${santriLain}&dari=2026-11-01&sampai=2026-11-30`,
    ];
    for (const path of lain) {
      const res = await t.req("GET", path, { cookie: wali });
      if (res.status < 400 || res.status >= 500) bocor.push(`${path} → ${res.status}`);
    }
    expect(bocor).toEqual([]);
    // Pembanding: data anaknya sendiri tetap bisa dibuka.
    const anak = await t.req("GET", "/api/keuangan/anak", { cookie: wali });
    expect(anak.body.anak.map((a: { nis: string }) => a.nis)).toEqual(["Z1"]);
  });
});

describe("header keamanan", () => {
  it("CSP, HSTS (APP_URL https), nosniff, referrer, frame", async () => {
    const res = await t.app.request("/api/health");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("https://challenges.cloudflare.com");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });

  it("error tak terduga tidak membocorkan detail internal", async () => {
    const res = await t.req("GET", "/api/tidak-ada");
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });
});
