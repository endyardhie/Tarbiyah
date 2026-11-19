import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, units } from "../src/server/db/schema";
import { schoolToday } from "../src/server/lib/tanggal";
import { isHariLibur } from "../src/server/services/presensi";
import { createTestContext, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
const c = {} as Record<"guruA" | "guruB" | "guruC" | "wali", string>;
const id = {} as Record<
  "kota" | "rahe" | "mdtu" | "ta" | "kelasA" | "kelasB" | "a1" | "a2" | "a3" | "b1" | "wali",
  string
>;
// Rabu, 18 November 2026 pukul 12.00 WIT.
const SIANG = new Date("2026-11-18T03:00:00Z");

async function post(path: string, body: unknown) {
  const res = await t.req("POST", path, { cookie: admin, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const isi = (
  kelasId: string,
  tanggal: string,
  cookie: string,
  override: Record<string, string> = {},
) =>
  // Daftar santri diambil sebagai admin agar uji izin benar-benar menguji PUT.
  t.req("GET", `/api/presensi?kelasId=${kelasId}&tanggal=${tanggal}`, { cookie: admin }).then((r) =>
    t.req("PUT", "/api/presensi", {
      cookie,
      body: {
        kelasId,
        tanggal,
        items: (r.body.santri ?? []).map((s: { pendaftaranId: string; santriId: string }) => ({
          pendaftaranId: s.pendaftaranId,
          status: override[s.santriId] ?? "H",
          keterangan: override[s.santriId] === "S" ? "Demam" : undefined,
        })),
      },
    }),
  );

beforeAll(async () => {
  t = await createTestContext();
  t.clock.now = SIANG;
  await t.makeUser({ nama: "Admin", nomor: "6281700000001", roleNama: ["Admin"] });
  admin = (await t.login("6281700000001", "rahasia123")).cookie;
  id.kota = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.rahe = (await post("/api/lokasi", { nama: "RAHE" })).id;
  id.mdtu = (await post("/api/units", { kode: "MDTU", nama: "MDT Ula" })).id;
  const ta = (await post("/api/units", { kode: "TA", nama: "Taman Al-Qur'an" })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).id;
  await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
  const guru: Record<string, string> = {};
  for (const [i, k] of (["guruA", "guruB", "guruC"] as const).entries()) {
    guru[k] = (await t.makeUser({ nama: k, nomor: `628170000010${i}` })).id;
  }
  const kelas = (unitId: string, lokasiId: string, waliKelasId: string, nama: string) =>
    post("/api/kelas", { tahunAjaranId: id.ta, unitId, lokasiId, nama, tingkat: 1, waliKelasId });
  id.kelasA = (await kelas(id.mdtu, id.kota, guru.guruA as string, "Kelas 1 Banin")).id;
  id.kelasB = (await kelas(ta, id.rahe, guru.guruB as string, "Kelas A")).id;
  const fiqih = (await post("/api/mapel", { nama: "Fiqih" })).id;
  await post("/api/pengajaran", { kelasId: id.kelasA, mapelId: fiqih, guruId: guru.guruC });
  const s = async (nis: string, kelasId: string) =>
    (await post("/api/santri", { nis, nama: `Santri ${nis}`, namaPanggilan: nis, kelasId })).id;
  id.a1 = await s("A1", id.kelasA);
  id.a2 = await s("A2", id.kelasA);
  id.a3 = await s("A3", id.kelasA);
  id.b1 = await s("B1", id.kelasB);
  const w = await post("/api/wali", { nama: "Wali A1", phones: [{ nomor: "6281700000200" }] });
  id.wali = w.id;
  await t.req("PUT", "/api/santri-wali", {
    cookie: admin,
    body: { santriId: id.a1, userId: id.wali },
  });
  await t.db.execute(sql`update users set wajib_ganti_password = false`);
  for (const [i, k] of (["guruA", "guruB", "guruC"] as const).entries()) {
    c[k] = (await t.login(`628170000010${i}`, "rahasia123")).cookie;
  }
  c.wali = (await t.login("6281700000200", w.passwordSementara)).cookie;
});
afterAll(() => t.drop());

describe("hari sekolah & hari libur", () => {
  it("'hari ini' berganti tepat tengah malam WIT, bukan UTC", () => {
    expect(schoolToday("Asia/Jayapura", new Date("2026-11-18T14:59:59Z"))).toBe("2026-11-18");
    expect(schoolToday("Asia/Jayapura", new Date("2026-11-18T15:00:00Z"))).toBe("2026-11-19");
  });

  it("libur mingguan bawaan (Sabtu/Ahad) dan libur mingguan per unit", async () => {
    expect(await isHariLibur(t.db, id.kelasA, "2026-11-22")).toEqual({
      libur: true,
      alasan: "Libur mingguan (Ahad)",
    });
    expect((await isHariLibur(t.db, id.kelasA, "2026-11-20")).libur).toBe(false);
    await post("/api/libur-mingguan", {
      hari: 5,
      unitId: await t.db
        .execute("select id from units where kode = 'TA'" as never)
        .then((r) => (r.rows[0] as { id: string }).id),
    });
    expect((await isHariLibur(t.db, id.kelasB, "2026-11-20")).libur).toBe(true);
    expect((await isHariLibur(t.db, id.kelasA, "2026-11-20")).libur).toBe(false);
  });

  it("agenda libur hanya mengenai kelas di sasarannya", async () => {
    await post("/api/agenda", {
      judul: "Libur Maulid (KOTA)",
      mulai: "2026-11-19",
      selesai: "2026-11-19",
      libur: true,
      sasaran: [{ lokasiId: id.kota }],
    });
    await post("/api/agenda", {
      judul: "Rapat (bukan libur)",
      mulai: "2026-11-23",
      selesai: "2026-11-23",
      sasaran: [{}],
    });
    expect(await isHariLibur(t.db, id.kelasA, "2026-11-19")).toEqual({
      libur: true,
      alasan: "Libur Maulid (KOTA)",
    });
    expect((await isHariLibur(t.db, id.kelasB, "2026-11-19")).libur).toBe(false);
    expect((await isHariLibur(t.db, id.kelasA, "2026-11-23")).libur).toBe(false);
  });
});

describe("isi presensi", () => {
  it("default H, belum tersimpan; wali kelas bisa mengubah hari ini", async () => {
    const r = await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: c.guruA });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      tanggal: "2026-11-18",
      hariIni: "2026-11-18",
      libur: false,
      bisaUbah: true,
      sesi: null,
    });
    expect(
      r.body.santri.map((s: { status: string; tersimpan: boolean }) => [s.status, s.tersimpan]),
    ).toEqual([
      ["H", false],
      ["H", false],
      ["H", false],
    ]);
    const hari = await t.req("GET", "/api/presensi/hari-ini", { cookie: admin });
    expect(hari.body.kelas.find((k: { id: string }) => k.id === id.kelasA)).toMatchObject({
      sudah: false,
      bisaIsi: true,
    });
  });

  it("wali kelas menyimpan; keterangan hanya untuk S/I; status kelas jadi sudah diabsen", async () => {
    const res = await isi(id.kelasA, "2026-11-18", c.guruA, { [id.a2]: "S", [id.a3]: "A" });
    expect(res.status).toBe(200);
    const r = await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: c.guruA });
    expect(r.body.sesi.disimpanOleh).toBe("guruA");
    const a2 = r.body.santri.find((s: { santriId: string }) => s.santriId === id.a2);
    expect(a2).toMatchObject({ status: "S", keterangan: "Demam", tersimpan: true });
    const hari = await t.req("GET", "/api/presensi/hari-ini", { cookie: admin });
    expect(hari.body.kelas.find((k: { id: string }) => k.id === id.kelasA).sudah).toBe(true);
    expect(hari.body.kelas.find((k: { id: string }) => k.id === id.kelasB).sudah).toBe(false);
  });

  it("wali kelas lain, pengajar, dan wali santri tidak bisa mengisi", async () => {
    expect((await isi(id.kelasA, "2026-11-18", c.guruB)).status).toBe(403);
    expect(
      (await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: c.guruC })).status,
    ).toBe(200);
    expect((await isi(id.kelasA, "2026-11-18", c.guruC)).status).toBe(403);
    expect(
      (await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: c.wali })).status,
    ).toBe(403);
  });

  it("daftar santri harus lengkap", async () => {
    const r = await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: c.guruA });
    const one = r.body.santri
      .slice(0, 1)
      .map((s: { pendaftaranId: string }) => ({ pendaftaranId: s.pendaftaranId, status: "H" }));
    const res = await t.req("PUT", "/api/presensi", {
      cookie: c.guruA,
      body: { kelasId: id.kelasA, tanggal: "2026-11-18", items: one },
    });
    expect(res.status).toBe(400);
  });

  it("tanggal lampau hanya dengan izin koreksi, tercatat di audit_log", async () => {
    expect((await isi(id.kelasA, "2026-11-17", c.guruA)).status).toBe(403);
    expect((await isi(id.kelasA, "2026-11-17", admin, { [id.a1]: "I" })).status).toBe(200);
    expect((await isi(id.kelasA, "2026-11-17", admin, { [id.a1]: "A" })).status).toBe(200);
    const logs = await t.db.select().from(auditLog).where(eq(auditLog.aksi, "presensi.koreksi"));
    expect(logs).toHaveLength(2);
    expect(logs[1]?.sebelum).toEqual([expect.objectContaining({ status: "I" })]);
    expect(logs[1]?.sesudah).toEqual([expect.objectContaining({ status: "A" })]);
  });

  it("tanggal mendatang ditolak", async () => {
    expect((await isi(id.kelasA, "2026-11-19", admin)).status).toBe(400);
  });

  it("hari libur terkunci", async () => {
    t.clock.now = new Date("2026-11-22T03:00:00Z"); // Ahad
    const r = await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: c.guruA });
    expect(r.body).toMatchObject({ libur: true, bisaUbah: false });
    const res = await isi(id.kelasA, "2026-11-22", c.guruA);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Hari libur/);
    t.clock.now = SIANG;
  });

  it("bisa diubah sampai 23.59 WIT; tepat 00.00 menjadi tanggal lampau", async () => {
    t.clock.now = new Date("2026-11-18T14:59:59Z");
    expect((await isi(id.kelasA, "2026-11-18", c.guruA)).status).toBe(200);
    t.clock.now = new Date("2026-11-18T15:00:00Z");
    expect((await isi(id.kelasA, "2026-11-18", c.guruA)).status).toBe(403);
    const r = await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: c.guruA });
    expect(r.body.hariIni).toBe("2026-11-19");
    t.clock.now = SIANG;
  });
});

describe("laporan", () => {
  it("rekap kelas: tanggal yang diabsen, total, dan persen", async () => {
    const r = await t.req(
      "GET",
      `/api/presensi/laporan?kelasId=${id.kelasA}&dari=2026-11-01&sampai=2026-11-30`,
      {
        cookie: c.guruC,
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.tanggal).toEqual(["2026-11-17", "2026-11-18"]);
    const a1 = r.body.rows.find((x: { santriId: string }) => x.santriId === id.a1);
    expect(a1.total).toEqual({ H: 1, S: 0, I: 0, A: 1 });
    expect(a1.persen).toBe(50);
  });

  it("wali santri hanya melihat baris anaknya", async () => {
    const own = await t.req(
      "GET",
      `/api/presensi/laporan?santriId=${id.a1}&dari=2026-11-01&sampai=2026-11-30`,
      { cookie: c.wali },
    );
    expect(own.status).toBe(200);
    expect(own.body.rows).toHaveLength(1);
    expect(own.body.rows[0].santriId).toBe(id.a1);
    expect(
      (
        await t.req(
          "GET",
          `/api/presensi/laporan?santriId=${id.a2}&dari=2026-11-01&sampai=2026-11-30`,
          { cookie: c.wali },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await t.req(
          "GET",
          `/api/presensi/laporan?kelasId=${id.kelasA}&dari=2026-11-01&sampai=2026-11-30`,
          { cookie: c.wali },
        )
      ).status,
    ).toBe(403);
    const ringkasan = await t.req("GET", "/api/presensi/ringkasan-anak", { cookie: c.wali });
    expect(ringkasan.body.anak).toEqual([expect.objectContaining({ santriId: id.a1, persen: 50 })]);
  });

  it("wali kelas lain tidak bisa melihat laporan kelas ini", async () => {
    expect(
      (
        await t.req(
          "GET",
          `/api/presensi/laporan?kelasId=${id.kelasA}&dari=2026-11-01&sampai=2026-11-30`,
          { cookie: c.guruB },
        )
      ).status,
    ).toBe(403);
  });
});

describe("agenda", () => {
  it("kelola butuh izin kalender.kelola; sasaran wajib; daftar memuat sasaran", async () => {
    const body = {
      judul: "Ujian",
      mulai: "2026-12-01",
      selesai: "2026-12-05",
      sasaran: [{ unitId: id.mdtu }],
    };
    expect((await t.req("POST", "/api/agenda", { cookie: c.guruA, body })).status).toBe(403);
    expect(
      (await t.req("POST", "/api/agenda", { cookie: admin, body: { ...body, sasaran: [] } }))
        .status,
    ).toBe(400);
    const created = await post("/api/agenda", body);
    const list = await t.req("GET", "/api/agenda?dari=2026-12-01&sampai=2026-12-31", {
      cookie: c.wali,
    });
    expect(list.body.find((a: { id: string }) => a.id === created.id).sasaran).toEqual([
      { unitId: id.mdtu, lokasiId: null, kelasId: null },
    ]);
    expect(
      (
        await t.req("PATCH", `/api/agenda/${created.id}`, {
          cookie: admin,
          body: { ...body, libur: true },
        })
      ).status,
    ).toBe(200);
    expect((await t.req("DELETE", `/api/agenda/${created.id}`, { cookie: admin })).status).toBe(
      200,
    );
  });
});
