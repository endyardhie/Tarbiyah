import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, berkas, santri, users } from "../src/server/db/schema";
import { createTestContext, ORIGIN, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
let guru: string;
const id = {} as Record<
  "ta" | "ta2" | "sem1" | "kelas" | "santri" | "guru" | "unit" | "lokasi",
  string
>;

async function post(path: string, body: unknown) {
  const res = await t.req("POST", path, { cookie: admin, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

beforeAll(async () => {
  t = await createTestContext();
  await t.makeUser({ nama: "Admin", nomor: "6281600000001", roleNama: ["Admin"] });
  admin = (await t.login("6281600000001", "rahasia123")).cookie;
  id.guru = (await t.makeUser({ nama: "Wali Kelas", nomor: "6281600000002" })).id;
  guru = (await t.login("6281600000002", "rahasia123")).cookie;

  id.lokasi = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.unit = (await post("/api/units", { kode: "MDTU", nama: "MDT Ula" })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).id;
  id.ta2 = (
    await post("/api/tahun-ajaran", {
      nama: "2027/2028",
      mulai: "2027-07-12",
      selesai: "2028-06-30",
    })
  ).id;
  await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
  id.sem1 = (
    await post("/api/semester", {
      tahunAjaranId: id.ta,
      nomor: 1,
      mulai: "2026-07-13",
      selesai: "2026-12-19",
    })
  ).id;
  await post(`/api/semester/${id.sem1}/aktifkan`, {});
  id.kelas = (
    await post("/api/kelas", {
      tahunAjaranId: id.ta,
      unitId: id.unit,
      lokasiId: id.lokasi,
      nama: "Kelas 1",
      tingkat: 1,
      waliKelasId: id.guru,
    })
  ).id;
  id.santri = (
    await post("/api/santri", {
      nis: "5001",
      nama: "Santri Lengkap",
      namaPanggilan: "Lengkap",
      tempatLahir: "Jayapura",
      tanggalLahir: "2017-01-02",
      alamat: "Jl. Asli",
      kelasId: id.kelas,
    })
  ).id;
});
afterAll(() => t.drop());

describe("impor tidak menghapus data", () => {
  it("sel kosong mempertahankan data lama; perubahan tercatat per santri", async () => {
    const rows = [{ nis: "5001", nama: "Santri Lengkap Baru" }];
    const res = await t.req("POST", "/api/impor/santri", {
      cookie: admin,
      body: { tahunAjaranId: id.ta, rows },
    });
    expect(res.status).toBe(200);
    const [s] = await t.db.select().from(santri).where(eq(santri.nis, "5001"));
    expect(s).toMatchObject({
      nama: "Santri Lengkap Baru",
      namaPanggilan: "Lengkap",
      tempatLahir: "Jayapura",
      tanggalLahir: "2017-01-02",
      alamat: "Jl. Asli",
    });
    const logs = await t.db.select().from(auditLog).where(eq(auditLog.aksi, "santri.ubah_impor"));
    expect(logs).toHaveLength(1);
    expect(logs[0]?.sebelum).toEqual({ nama: "Santri Lengkap" });
    expect(logs[0]?.sesudah).toEqual({ nama: "Santri Lengkap Baru" });
  });
});

describe("relasi hanya tahun ajaran aktif", () => {
  it("wali kelas tahun lalu tidak lagi melihat santri bekas kelasnya", async () => {
    expect((await t.req("GET", `/api/santri/${id.santri}`, { cookie: guru })).status).toBe(200);
    await post(`/api/tahun-ajaran/${id.ta2}/aktifkan`, {});
    expect((await t.req("GET", `/api/santri/${id.santri}`, { cookie: guru })).status).toBe(403);
    expect((await t.req("GET", "/api/me", { cookie: guru })).body.relasi.kelasWali).toEqual([]);
    await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
    expect((await t.req("GET", `/api/santri/${id.santri}`, { cookie: guru })).status).toBe(200);
  });
});

describe("tahun ajaran & semester", () => {
  it("semester tahun ajaran tidak aktif tidak bisa diaktifkan; ganti tahun mematikan semester lama", async () => {
    const sem = await post("/api/semester", {
      tahunAjaranId: id.ta2,
      nomor: 1,
      mulai: "2027-07-12",
      selesai: "2027-12-18",
    });
    const bad = await t.req("POST", `/api/semester/${sem.id}/aktifkan`, { cookie: admin });
    expect(bad.status).toBe(400);
    await post(`/api/tahun-ajaran/${id.ta2}/aktifkan`, {});
    const list = (await t.req("GET", "/api/tahun-ajaran", { cookie: admin })).body;
    const sems = list.flatMap((x: { semester: { aktif: boolean }[] }) => x.semester);
    expect(sems.filter((s: { aktif: boolean }) => s.aktif)).toHaveLength(0);
    await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
    await post(`/api/semester/${id.sem1}/aktifkan`, {});
  });

  it("aktivasi & libur mingguan hanya admin", async () => {
    expect(
      (await t.req("POST", `/api/semester/${id.sem1}/aktifkan`, { cookie: guru })).status,
    ).toBe(403);
    expect(
      (await t.req("POST", `/api/tahun-ajaran/${id.ta}/aktifkan`, { cookie: guru })).status,
    ).toBe(403);
    expect(
      (await t.req("POST", "/api/libur-mingguan", { cookie: guru, body: { hari: 5 } })).status,
    ).toBe(403);
    expect(
      (await t.req("POST", "/api/libur-mingguan", { cookie: admin, body: { hari: 5 } })).status,
    ).toBe(201);
  });
});

describe("validasi & izin", () => {
  it("parameter id yang bukan UUID → 400, bukan 500", async () => {
    expect((await t.req("GET", "/api/santri?kelasId=abc", { cookie: admin })).status).toBe(400);
    expect((await t.req("GET", "/api/kelas?tahunAjaranId=1;drop", { cookie: admin })).status).toBe(
      400,
    );
    expect((await t.req("GET", "/api/pengajaran?tahunAjaranId=x", { cookie: admin })).status).toBe(
      400,
    );
  });

  it("hubungkan/lepas santri-wali butuh wali.kelola; akun staf tidak bisa diubah lewat /wali", async () => {
    const body = { santriId: id.santri, userId: id.guru, hubungan: "ayah" };
    expect((await t.req("PUT", "/api/santri-wali", { cookie: guru, body })).status).toBe(403);
    expect((await t.req("PUT", "/api/santri-wali", { cookie: admin, body })).status).toBe(200);
    expect(
      (await t.req("DELETE", `/api/santri-wali/${id.santri}/${id.guru}`, { cookie: guru })).status,
    ).toBe(403);
    expect(
      (await t.req("DELETE", `/api/santri-wali/${id.santri}/${id.guru}`, { cookie: admin })).status,
    ).toBe(200);
    const upd = await t.req("PATCH", `/api/wali/${id.guru}`, {
      cookie: admin,
      body: { nama: "X", phones: [{ nomor: "6281600000002" }], status: "aktif" },
    });
    expect(upd.status).toBe(403);
    const [u] = await t.db.select().from(users).where(eq(users.id, id.guru));
    expect(u?.nama).toBe("Wali Kelas");
  });

  it("akun guru tidak tampil di daftar wali, tapi bisa dipilih saat menghubungkan (?semua=1)", async () => {
    const ids = async (path: string) =>
      ((await t.req("GET", path, { cookie: admin })).body as { id: string }[]).map((w) => w.id);
    expect(await ids("/api/wali")).not.toContain(id.guru);
    expect(await ids("/api/wali?semua=1")).toContain(id.guru);
    expect((await t.req("GET", "/api/wali?semua=1", { cookie: guru })).status).toBe(403);
  });
});

describe("berkas & logo", () => {
  const upload = (form: FormData) =>
    t.app.request(
      "/api/pengaturan/logo",
      { method: "POST", headers: { origin: ORIGIN, cookie: admin }, body: form },
      { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
    );
  const png = (extra: string | Buffer) =>
    new Blob([
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from(extra),
      ]),
    ]);

  it("berkas privat tidak tersaji lewat /api/files", async () => {
    const [row] = await t.db
      .insert(berkas)
      .values({
        namaAsli: "rahasia.pdf",
        path: "files/xx/rahasia.pdf",
        ukuran: 1,
        tipe: "application/pdf",
        publik: false,
      })
      .returning();
    expect((await t.app.request(`/api/files/${row?.id}`)).status).toBe(401);
    expect((await t.req("GET", `/api/files/${row?.id}`, { cookie: guru })).status).toBe(404);
  });

  it("unggahan logo lebih dari 6 MB ditolak 413", async () => {
    const form = new FormData();
    form.set("logo", png(Buffer.alloc(7 * 1024 * 1024)), "besar.png");
    expect((await upload(form)).status).toBe(413);
  });

  it("ikon iPhone disajikan langsung (tanpa redirect) setelah logo diunggah", async () => {
    expect((await t.app.request("/apple-touch-icon.png")).status).toBe(404); // tanpa staticDir & logo
    const form = new FormData();
    for (const f of ["logo", "ikon192", "ikon512", "ikonMaskable"]) form.set(f, png(f), `${f}.png`);
    expect((await upload(form)).status).toBe(200);
    const res = await t.app.request("/apple-touch-icon.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(
      Buffer.from(await res.arrayBuffer())
        .subarray(8)
        .toString(),
    ).toBe("ikon192");
    const logos = await t.db
      .select()
      .from(berkas)
      .where(and(eq(berkas.rujukanTipe, "logo"), eq(berkas.publik, true)));
    expect(logos).toHaveLength(4);
  });

  it("logo antara 1 MB dan 6 MB diterima batas body (batas per berkas dicek di route)", async () => {
    const form = new FormData();
    form.set("logo", png(Buffer.alloc(1_500_000)), "logo.png");
    for (const f of ["ikon192", "ikon512", "ikonMaskable"]) form.set(f, png(f), `${f}.png`);
    expect((await upload(form)).status).toBe(200);
  });
});

describe("zona waktu", () => {
  it("mengganti zona waktu menjadwal ulang cron dengan zona baru", async () => {
    t.scheduled.length = 0;
    const res = await t.req("PUT", "/api/pengaturan/identitas", {
      cookie: admin,
      body: { nama: "Pondok", namaSingkat: "Pondok", zonaWaktu: "Asia/Makassar" },
    });
    expect(res.status).toBe(200);
    expect(t.scheduled.length).toBeGreaterThan(0);
    expect(t.scheduled.every((s) => s.tz === "Asia/Makassar")).toBe(true);
    expect((await t.req("GET", "/api/health")).body.zonaWaktu).toBe("Asia/Makassar");
  });
});
