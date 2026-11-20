import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pendaftaran, santri, tahunAjaran, tarifSpp } from "../src/server/db/schema";
import { audit } from "../src/server/lib/audit";
import { buatTagihan } from "../src/server/services/keuangan";
import { createTestContext, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
let guru: string;
let wali: string;
const id = {} as Record<
  "lok" | "unit" | "ta" | "k1" | "k2" | "a" | "b" | "c" | "ajar" | "guru" | "wali",
  string
>;

async function post(path: string, body: unknown, cookie = admin) {
  const res = await t.req("POST", path, { cookie, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

beforeAll(async () => {
  t = await createTestContext();
  await t.makeUser({ nama: "Admin", nomor: "6282500000001", roleNama: ["Admin"] });
  admin = (await t.login("6282500000001", "rahasia123")).cookie;
  id.guru = (await t.makeUser({ nama: "Guru", nomor: "6282500000002" })).id;
  id.lok = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.unit = (await post("/api/units", { kode: "MDTU", nama: "Ula" })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).id;
  await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
  const sem = (
    await post("/api/semester", {
      tahunAjaranId: id.ta,
      nomor: 1,
      mulai: "2026-07-13",
      selesai: "2026-12-19",
    })
  ).id;
  await post(`/api/semester/${sem}/aktifkan`, {});
  await post("/api/semester", {
    tahunAjaranId: id.ta,
    nomor: 2,
    mulai: "2027-01-04",
    selesai: "2027-06-30",
  });
  const kelas = (nama: string, tingkat: number) =>
    post("/api/kelas", {
      tahunAjaranId: id.ta,
      unitId: id.unit,
      lokasiId: id.lok,
      nama,
      tingkat,
      waliKelasId: id.guru,
    }).then((r) => r.id);
  id.k1 = await kelas("Kelas 1", 1);
  id.k2 = await kelas("Kelas 2", 2);
  id.a = (await post("/api/santri", { nis: "A1", nama: "Ahmad", kelasId: id.k1 })).id;
  id.c = (await post("/api/santri", { nis: "C1", nama: "Chairul", kelasId: id.k1 })).id;
  id.b = (await post("/api/santri", { nis: "B1", nama: "Bilal", kelasId: id.k2 })).id;
  const mapel = (await post("/api/mapel", { nama: "Fiqih" })).id;
  id.ajar = (await post("/api/pengajaran", { kelasId: id.k1, mapelId: mapel, guruId: id.guru })).id;
  await t.req("PUT", "/api/keuangan/tarif", {
    cookie: admin,
    body: { unitId: id.unit, lokasiId: id.lok, nominal: 150_000 },
  });
  const w = await post("/api/wali", { nama: "Wali Ahmad", phones: [{ nomor: "6282500000200" }] });
  id.wali = w.id;
  await t.req("PUT", "/api/santri-wali", { cookie: admin, body: { santriId: id.a, userId: w.id } });
  await t.db.execute(sql`update users set wajib_ganti_password = false`);
  guru = (await t.login("6282500000002", "rahasia123")).cookie;
  wali = (await t.login("6282500000200", w.passwordSementara, { setujui: false })).cookie;
});
afterAll(() => t.drop());

describe("persetujuan pemrosesan data", () => {
  it("wali wajib menyetujui sebelum memakai aplikasi; tercatat di audit", async () => {
    const me = await t.req("GET", "/api/me", { cookie: wali });
    expect(me.body.perluPersetujuan).toBe(true);
    expect((await t.req("GET", "/api/keuangan/anak", { cookie: wali })).status).toBe(403);
    const teks = await t.req("GET", "/api/me/persetujuan", { cookie: wali });
    expect(teks.body.teks).toContain("data pribadi");
    await t.req("PUT", "/api/pengaturan/persetujuan", {
      cookie: admin,
      body: { teks: "Teks persetujuan versi lembaga, cukup panjang untuk lolos validasi." },
    });
    expect((await t.req("GET", "/api/me/persetujuan", { cookie: wali })).body.teks).toContain(
      "versi lembaga",
    );
    expect((await t.req("POST", "/api/me/persetujuan", { cookie: wali, body: {} })).status).toBe(
      200,
    );
    expect((await t.req("GET", "/api/keuangan/anak", { cookie: wali })).status).toBe(200);
    // Staf tanpa anak tidak diminta.
    expect((await t.req("GET", "/api/me", { cookie: guru })).body.perluPersetujuan).toBe(false);
  });
});

describe("dashboard per peran", () => {
  it("tugas aktif untuk guru & wali; rekap per unit hanya untuk yang berhak", async () => {
    await post(
      "/api/tugas",
      {
        pengajaranId: id.ajar,
        judul: "Hafalan doa",
        tanggalDiberi: "2026-11-01",
        tenggat: "2099-01-01",
      },
      guru,
    );
    const g = await t.req("GET", "/api/akademik/tugas-aktif", { cookie: guru });
    expect(g.body.map((x: { judul: string }) => x.judul)).toEqual(["Hafalan doa"]);
    const w = await t.req("GET", "/api/akademik/tugas-aktif", { cookie: wali });
    expect(w.body).toHaveLength(1);
    expect((await t.req("GET", "/api/presensi/rekap-unit", { cookie: wali })).status).toBe(403);
    expect((await t.req("GET", "/api/presensi/rekap-unit", { cookie: admin })).status).toBe(200);
  });
});

describe("wizard tahun ajaran baru", () => {
  it("usulan: naik ke tingkat +1, kelas tertinggi lulus, tanggal +1 tahun", async () => {
    expect((await t.req("GET", "/api/tahun-baru", { cookie: guru })).status).toBe(403);
    const u = (await t.req("GET", "/api/tahun-baru", { cookie: admin })).body;
    expect(u.usulan.tahunAjaran).toEqual({
      nama: "2027/2028",
      mulai: "2027-07-13",
      selesai: "2028-06-30",
    });
    expect(u.usulan.semester).toHaveLength(2);
    const by = Object.fromEntries(u.santri.map((s: { nis: string }) => [s.nis, s]));
    expect(by.A1).toMatchObject({ status: "naik", kelasTujuanId: id.k2 });
    expect(by.B1).toMatchObject({ status: "lulus", kelasTujuanId: null });
  });

  it("validasi: semua santri wajib diputuskan; tahun baru setelah tahun lama", async () => {
    const u = (await t.req("GET", "/api/tahun-baru", { cookie: admin })).body;
    const body = {
      tahunAjaran: u.usulan.tahunAjaran,
      semester: u.usulan.semester,
      keputusan: [{ santriId: id.a, status: "naik", kelasId: id.k2 }],
    };
    expect((await t.req("POST", "/api/tahun-baru", { cookie: admin, body })).status).toBe(400);
    const awal = {
      ...body,
      tahunAjaran: { ...u.usulan.tahunAjaran, mulai: "2027-01-01" },
      semester: [{ nomor: 1, mulai: "2027-01-02", selesai: "2027-06-01" }],
    };
    expect((await t.req("POST", "/api/tahun-baru", { cookie: admin, body: awal })).status).toBe(
      400,
    );
    const [aktif] = await t.db.select().from(tahunAjaran).where(eq(tahunAjaran.aktif, true));
    expect(aktif?.id).toBe(id.ta); // tidak ada yang berubah
  });

  it("naik/tinggal/lulus dalam satu transaksi; kelas & tarif disalin; tahun lama baca-saja", async () => {
    const u = (await t.req("GET", "/api/tahun-baru", { cookie: admin })).body;
    const hasil = await post("/api/tahun-baru", {
      tahunAjaran: u.usulan.tahunAjaran,
      semester: u.usulan.semester,
      keputusan: [
        { santriId: id.a, status: "naik", kelasId: id.k2 },
        { santriId: id.c, status: "tinggal", kelasId: id.k1 },
        { santriId: id.b, status: "lulus" },
      ],
    });
    expect(hasil).toMatchObject({
      kelas: 2,
      tarif: 1,
      keputusan: { naik: 1, tinggal: 1, lulus: 1 },
    });
    const baru = hasil.tahunAjaran.id;
    const [aktif] = await t.db.select().from(tahunAjaran).where(eq(tahunAjaran.aktif, true));
    expect(aktif?.id).toBe(baru);
    expect(await t.db.select().from(tarifSpp).where(eq(tarifSpp.tahunAjaranId, baru))).toHaveLength(
      1,
    );
    const { rows } = await t.db.execute<{ nis: string; kelas: string; tingkat: number }>(sql`
      select s.nis, k.nama kelas, k.tingkat from pendaftaran p join santri s on s.id = p.santri_id
      join kelas k on k.id = p.kelas_id where p.tahun_ajaran_id = ${baru} order by s.nis`);
    expect(rows).toEqual([
      { nis: "A1", kelas: "Kelas 2", tingkat: 2 },
      { nis: "C1", kelas: "Kelas 1", tingkat: 1 },
    ]);
    const lama = await t.db.select().from(pendaftaran).where(eq(pendaftaran.tahunAjaranId, id.ta));
    expect(lama.map((p) => p.status).sort()).toEqual(["lulus", "naik", "tinggal"]);
    const [b] = await t.db.select().from(santri).where(eq(santri.id, id.b));
    expect(b?.status).toBe("lulus");
    // Santri lulus tidak ditagih di tahun baru.
    const tg = await buatTagihan(t.db, "2027-08", { simpan: false });
    expect(tg.items.map((i) => i.nis).sort()).toEqual(["A1", "C1"]);

    // Tahun lama arsip: presensi, tugas, dan kelas baru di tahun itu ditolak.
    const presensi = await t.req("PUT", "/api/presensi", {
      cookie: admin,
      body: {
        kelasId: id.k1,
        tanggal: "2026-11-02",
        items: [{ pendaftaranId: lama.find((p) => p.santriId === id.c)?.id, status: "H" }],
      },
    });
    expect(presensi.status).toBe(409);
    const tugas = await t.req("POST", "/api/tugas", {
      cookie: admin,
      body: { pengajaranId: id.ajar, judul: "Telat", tanggalDiberi: "2027-06-01" },
    });
    expect(tugas.status).toBe(409);
    const kelas = await t.req("POST", "/api/kelas", {
      cookie: admin,
      body: { tahunAjaranId: id.ta, unitId: id.unit, lokasiId: id.lok, nama: "Baru", tingkat: 3 },
    });
    expect(kelas.status).toBe(409);
  });
});

describe("log aktivitas", () => {
  it("hanya admin; filter aksi & halaman berikutnya tanpa baris terlewat", async () => {
    expect((await t.req("GET", "/api/audit", { cookie: guru })).status).toBe(403);
    const opsi = await t.req("GET", "/api/audit/opsi", { cookie: admin });
    expect(opsi.body.aksi).toContain("tahun_ajaran.baru");
    const satu = await t.req("GET", "/api/audit?aksi=tahun_ajaran.baru", { cookie: admin });
    expect(satu.body.rows).toHaveLength(1);
    expect(satu.body.rows[0].userNama).toBe("Admin");

    // id audit = UUID v7 dari aplikasi (urut waktu), sama seperti audit() sungguhan.
    for (let i = 0; i < 60; i++)
      await audit(t.db, { userId: null, aksi: "tes.massal", entitas: "x" });
    const p1 = await t.req("GET", "/api/audit?aksi=tes.massal", { cookie: admin });
    expect(p1.body.rows).toHaveLength(50);
    const p2 = await t.req("GET", `/api/audit?aksi=tes.massal&sebelum=${p1.body.berikutnya}`, {
      cookie: admin,
    });
    expect(p2.body.rows).toHaveLength(10);
    expect(p2.body.berikutnya).toBeNull();
    const semua = new Set([...p1.body.rows, ...p2.body.rows].map((r: { id: string }) => r.id));
    expect(semua.size).toBe(60);
  });
});
