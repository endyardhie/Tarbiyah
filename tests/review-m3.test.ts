import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { santri } from "../src/server/db/schema";
import { isHariLibur, liburKelas } from "../src/server/services/presensi";
import { createTestContext, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
const c = {} as Record<"kepsek" | "koreksi" | "wali", string>;
const id = {} as Record<
  "kota" | "rahe" | "mdtu" | "ta" | "kelasA" | "kelasC" | "a1" | "a2" | "a3" | "wali",
  string
>;

async function post(path: string, body: unknown) {
  const res = await t.req("POST", path, { cookie: admin, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const isi = async (kelasId: string, tanggal: string, cookie: string) => {
  const r = await t.req("GET", `/api/presensi?kelasId=${kelasId}&tanggal=${tanggal}`, {
    cookie: admin,
  });
  return t.req("PUT", "/api/presensi", {
    cookie,
    body: {
      kelasId,
      tanggal,
      items: (r.body.santri ?? []).map((s: { pendaftaranId: string }) => ({
        pendaftaranId: s.pendaftaranId,
        status: "H",
      })),
    },
  });
};

beforeAll(async () => {
  t = await createTestContext();
  t.clock.now = new Date("2026-11-18T03:00:00Z"); // Rabu 18 Nov 2026, 12.00 WIT
  await t.makeUser({ nama: "Admin", nomor: "6281800000001", roleNama: ["Admin"] });
  admin = (await t.login("6281800000001", "rahasia123")).cookie;
  id.kota = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.rahe = (await post("/api/lokasi", { nama: "RAHE" })).id;
  id.mdtu = (await post("/api/units", { kode: "MDTU", nama: "MDT Ula" })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).id;
  await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
  const kelas = (lokasiId: string, nama: string) =>
    post("/api/kelas", { tahunAjaranId: id.ta, unitId: id.mdtu, lokasiId, nama, tingkat: 1 });
  id.kelasA = (await kelas(id.kota, "Kelas A")).id;
  id.kelasC = (await kelas(id.rahe, "Kelas C")).id;
  for (const n of ["a1", "a2", "a3"] as const) {
    id[n] = (await post("/api/santri", { nis: n, nama: `Santri ${n}`, kelasId: id.kelasA })).id;
  }
  const w = await post("/api/wali", { nama: "Wali", phones: [{ nomor: "6281800000200" }] });
  id.wali = w.id;
  for (const s of [id.a1, id.a2])
    await t.req("PUT", "/api/santri-wali", {
      cookie: admin,
      body: { santriId: s, userId: id.wali },
    });
  await post("/api/roles", { nama: "Koreksi Presensi", izin: ["presensi.koreksi"] });
  await t.makeUser({ nama: "Kepsek", nomor: "6281800000002", roleNama: ["Kepala Sekolah"] });
  await t.makeUser({ nama: "Operator", nomor: "6281800000003", roleNama: ["Koreksi Presensi"] });
  await t.db.execute(sql`update users set wajib_ganti_password = false`);
  c.kepsek = (await t.login("6281800000002", "rahasia123")).cookie;
  c.koreksi = (await t.login("6281800000003", "rahasia123")).cookie;
  c.wali = (await t.login("6281800000200", w.passwordSementara)).cookie;
});
afterAll(() => t.drop());

describe("hak jabatan", () => {
  it("Kepala Sekolah melihat semua & laporan, tetapi tidak bisa mengisi", async () => {
    const hari = await t.req("GET", "/api/presensi/hari-ini", { cookie: c.kepsek });
    expect(hari.body.kelas).toHaveLength(2);
    expect(hari.body.kelas.every((k: { bisaIsi: boolean }) => !k.bisaIsi)).toBe(true);
    expect(
      (
        await t.req(
          "GET",
          `/api/presensi/laporan?kelasId=${id.kelasA}&dari=2026-11-01&sampai=2026-11-30`,
          { cookie: c.kepsek },
        )
      ).status,
    ).toBe(200);
    expect((await isi(id.kelasA, "2026-11-18", c.kepsek)).status).toBe(403);
  });

  it("jabatan berizin presensi.koreksi (bukan admin) bisa mengoreksi tanggal lampau", async () => {
    expect((await isi(id.kelasA, "2026-11-17", c.koreksi)).status).toBe(200);
  });

  it("tanggal di luar tahun ajaran kelas ditolak", async () => {
    const res = await isi(id.kelasA, "2026-07-01", admin);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/di luar tahun ajaran/);
  });
});

describe("hari libur bersasaran", () => {
  it("libur mingguan per lokasi dan agenda bersasaran unit+lokasi (irisan)", async () => {
    await post("/api/libur-mingguan", { hari: 4, lokasiId: id.kota }); // Kamis, KOTA saja
    expect((await isHariLibur(t.db, id.kelasA, "2026-11-26")).libur).toBe(true);
    expect((await isHariLibur(t.db, id.kelasC, "2026-11-26")).libur).toBe(false);
    await post("/api/agenda", {
      judul: "Libur MDTU RAHE",
      mulai: "2026-11-24",
      selesai: "2026-11-24",
      libur: true,
      sasaran: [{ unitId: id.mdtu, lokasiId: id.rahe }],
    });
    expect((await isHariLibur(t.db, id.kelasA, "2026-11-24")).libur).toBe(false);
    expect((await isHariLibur(t.db, id.kelasC, "2026-11-24")).libur).toBe(true);
  });

  it("perhitungan libur sekaligus (dashboard) sama dengan per kelas", async () => {
    const kelas = await t.db.execute<{ id: string; unitId: string; lokasiId: string }>(
      sql`select id, unit_id as "unitId", lokasi_id as "lokasiId" from kelas`,
    );
    for (const tanggal of ["2026-11-22", "2026-11-24", "2026-11-25", "2026-11-26"]) {
      const batch = await liburKelas(t.db, kelas.rows, tanggal);
      for (const k of kelas.rows)
        expect(batch.get(k.id)).toEqual(await isHariLibur(t.db, k.id, tanggal));
    }
  });
});

describe("daftar & laporan", () => {
  it("santri non-aktif tidak masuk daftar isi", async () => {
    await t.db.update(santri).set({ status: "keluar" }).where(eq(santri.id, id.a3));
    const r = await t.req("GET", `/api/presensi?kelasId=${id.kelasA}`, { cookie: admin });
    expect(r.body.santri.map((s: { santriId: string }) => s.santriId)).not.toContain(id.a3);
    await t.db.update(santri).set({ status: "aktif" }).where(eq(santri.id, id.a3));
  });

  it("rentang laporan lebih dari setahun atau terbalik ditolak", async () => {
    const q = (dari: string, sampai: string) =>
      t.req("GET", `/api/presensi/laporan?kelasId=${id.kelasA}&dari=${dari}&sampai=${sampai}`, {
        cookie: admin,
      });
    expect((await q("1900-01-01", "2100-01-01")).status).toBe(400);
    expect((await q("2026-12-01", "2026-11-01")).status).toBe(400);
    expect((await q("2026-07-13", "2027-06-30")).status).toBe(200);
  });

  it("ringkasan bulan ini untuk wali dengan dua anak", async () => {
    const r = await t.req("GET", "/api/presensi/ringkasan-anak", { cookie: c.wali });
    expect(r.body.anak.map((a: { santriId: string }) => a.santriId).sort()).toEqual(
      [id.a1, id.a2].sort(),
    );
  });
});

describe("agenda untuk wali santri", () => {
  it("hanya agenda yang sasarannya mengenai kelas anaknya", async () => {
    await post("/api/agenda", {
      judul: "Rapat guru RAHE",
      mulai: "2026-11-27",
      selesai: "2026-11-27",
      sasaran: [{ lokasiId: id.rahe }],
    });
    await post("/api/agenda", {
      judul: "Wisuda",
      mulai: "2026-11-28",
      selesai: "2026-11-28",
      sasaran: [{}],
    });
    await post("/api/agenda", {
      judul: "Ujian Kelas A",
      mulai: "2026-11-29",
      selesai: "2026-11-29",
      sasaran: [{ kelasId: id.kelasA }],
    });
    const judul = async (cookie: string) =>
      (await t.req("GET", "/api/agenda?dari=2026-11-01&sampai=2026-11-30", { cookie })).body.map(
        (a: { judul: string }) => a.judul,
      );
    const wali = await judul(c.wali);
    expect(wali).toEqual(expect.arrayContaining(["Wisuda", "Ujian Kelas A"]));
    expect(wali).not.toContain("Rapat guru RAHE");
    expect(wali).not.toContain("Libur MDTU RAHE");
    expect(await judul(c.kepsek)).toEqual(
      expect.arrayContaining(["Rapat guru RAHE", "Wisuda", "Ujian Kelas A"]),
    );
  });
});
