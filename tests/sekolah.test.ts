import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pendaftaran, santri, users } from "../src/server/db/schema";
import { createTestContext, ORIGIN, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
type Key =
  | "kota"
  | "rahe"
  | "mdtu"
  | "ta"
  | "guruA"
  | "guruB"
  | "guruC"
  | "lain"
  | "kelasA"
  | "kelasB"
  | "fiqih"
  | "pengajaran"
  | "s1"
  | "s2"
  | "s3"
  | "wali";
const id = {} as Record<Key, string>;
const cookie = {} as Record<"guruA" | "guruC" | "wali" | "lain", string>;

async function post(path: string, body: unknown, c = admin) {
  const res = await t.req("POST", path, { cookie: c, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

beforeAll(async () => {
  t = await createTestContext();
  await t.makeUser({ nama: "Admin", nomor: "6281500000001", roleNama: ["Admin"] });
  admin = (await t.login("6281500000001", "rahasia123")).cookie;

  id.kota = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.rahe = (await post("/api/lokasi", { nama: "RAHE" })).id;
  id.mdtu = (await post("/api/units", { kode: "mdtu", nama: "MDT Ula", urutan: 1 })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).id;
  await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});

  const staf = [
    ["guruA", "Ustadz A"],
    ["guruB", "Ustadz B"],
    ["guruC", "Ustadzah C"],
    ["lain", "Staf Lain"],
  ] as const;
  for (const [i, [k, nama]] of staf.entries()) {
    id[k] = (await t.makeUser({ nama, nomor: `628150000010${i}` })).id;
  }
  const kelas = (lokasiId: string, waliKelasId: string) =>
    post("/api/kelas", {
      tahunAjaranId: id.ta,
      unitId: id.mdtu,
      lokasiId,
      nama: "Kelas 1 Banin",
      tingkat: 1,
      kelompok: "banin",
      waliKelasId,
    });
  id.kelasA = (await kelas(id.kota, id.guruA)).id;
  id.kelasB = (await kelas(id.rahe, id.guruB)).id;
  id.fiqih = (await post("/api/mapel", { nama: "Fiqih", namaArab: "الفقه", unitId: id.mdtu })).id;
  id.pengajaran = (
    await post("/api/pengajaran", {
      kelasId: id.kelasA,
      mapelId: id.fiqih,
      guruId: id.guruC,
      kkm: 70,
    })
  ).id;
  await post("/api/jadwal", {
    pengajaranId: id.pengajaran,
    hari: 1,
    jamMulai: "07:30",
    jamSelesai: "08:40",
  });

  const s = (nis: string, nama: string, namaPanggilan: string, kelasId: string) =>
    post("/api/santri", { nis, nama, namaPanggilan, jenisKelamin: "L", kelasId });
  id.s1 = (await s("1001", "Ahmad Fauzi", "Ahmad", id.kelasA)).id;
  id.s2 = (await s("1002", "Budi Santoso", "Budi", id.kelasA)).id;
  id.s3 = (await s("1003", "Cahya Ramadhan", "Cahya", id.kelasB)).id;

  const wali = await post("/api/wali", { nama: "Ibu Cahya", phones: [{ nomor: "081500000099" }] });
  id.wali = wali.id;
  await t.req("PUT", "/api/santri-wali", {
    cookie: admin,
    body: { santriId: id.s3, userId: id.wali, hubungan: "ibu" },
  });
  await t.db.update(users).set({ wajibGantiPassword: false });

  for (const k of ["guruA", "guruC", "wali", "lain"] as const) {
    const [p] = await t.db
      .execute<{ nomor: string }>(sql`select nomor from user_phones where user_id = ${id[k]}`)
      .then((r) => r.rows);
    cookie[k] = (
      await t.login(p?.nomor ?? "", k === "wali" ? wali.passwordSementara : "rahasia123")
    ).cookie;
  }
});
afterAll(() => t.drop());

const nisOf = (rows: { nis: string }[]) => rows.map((r) => r.nis).sort();

describe("struktur sekolah", () => {
  it("data master boleh dibaca semua yang login, diubah hanya yang berizin", async () => {
    expect((await t.req("GET", "/api/lokasi", { cookie: cookie.wali })).status).toBe(200);
    expect(
      (await t.req("POST", "/api/lokasi", { cookie: cookie.guruA, body: { nama: "X" } })).status,
    ).toBe(403);
    expect((await t.req("POST", "/api/kelas", { cookie: cookie.guruA, body: {} })).status).toBe(
      403,
    );
  });

  it("hanya satu tahun ajaran aktif", async () => {
    const ta2 = await post("/api/tahun-ajaran", {
      nama: "2027/2028",
      mulai: "2027-07-12",
      selesai: "2028-06-30",
    });
    await post(`/api/tahun-ajaran/${ta2.id}/aktifkan`, {});
    const list = (await t.req("GET", "/api/tahun-ajaran", { cookie: admin })).body;
    expect(
      list.filter((x: { aktif: boolean }) => x.aktif).map((x: { id: string }) => x.id),
    ).toEqual([ta2.id]);
    await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
  });

  it("nama kelas ganda di tahun/unit/lokasi yang sama → 409", async () => {
    const res = await t.req("POST", "/api/kelas", {
      cookie: admin,
      body: {
        tahunAjaranId: id.ta,
        unitId: id.mdtu,
        lokasiId: id.kota,
        nama: "Kelas 1 Banin",
        tingkat: 1,
      },
    });
    expect(res.status).toBe(409);
  });

  it("daftar kelas & pengajaran beserta jadwal", async () => {
    const kelas = (await t.req("GET", "/api/kelas", { cookie: admin })).body;
    expect(kelas.find((k: { id: string }) => k.id === id.kelasA)).toMatchObject({
      waliKelasNama: "Ustadz A",
      jumlahSantri: 2,
    });
    const p = (await t.req("GET", "/api/pengajaran", { cookie: cookie.guruC })).body;
    expect(p[0]).toMatchObject({ guruNama: "Ustadzah C", mapelNamaArab: "الفقه" });
    expect(p[0].jadwal[0]).toMatchObject({ hari: 1, jamMulai: "07:30", jamSelesai: "08:40" });
  });
});

describe("pilihan guru & daftar wali", () => {
  it("pilihan guru berisi staf, bukan wali santri murni; daftar wali berisi anaknya", async () => {
    const guru = (await t.req("GET", "/api/guru-pilihan", { cookie: admin })).body.map(
      (g: { nama: string }) => g.nama,
    );
    expect(guru).toEqual(expect.arrayContaining(["Ustadz A", "Ustadzah C", "Staf Lain"]));
    expect(guru).not.toContain("Ibu Cahya");
    expect((await t.req("GET", "/api/guru-pilihan", { cookie: cookie.wali })).status).toBe(403);
    const wali = (await t.req("GET", "/api/wali", { cookie: admin })).body;
    const ibu = wali.find((w: { nama: string }) => w.nama === "Ibu Cahya");
    expect(ibu.anak.map((a: { nis: string }) => a.nis)).toEqual(["1003"]);
    expect(wali.map((w: { nama: string }) => w.nama)).not.toContain("Ustadz A");
  });
});

describe("relasi can()", () => {
  it("wali kelas hanya melihat santri kelasnya", async () => {
    const list = (await t.req("GET", "/api/santri", { cookie: cookie.guruA })).body;
    expect(nisOf(list)).toEqual(["1001", "1002"]);
    expect(
      (await t.req("GET", `/api/santri?kelasId=${id.kelasB}`, { cookie: cookie.guruA })).status,
    ).toBe(403);
    expect((await t.req("GET", `/api/santri/${id.s3}`, { cookie: cookie.guruA })).status).toBe(403);
    expect((await t.req("GET", `/api/santri/${id.s1}`, { cookie: cookie.guruA })).status).toBe(200);
  });

  it("guru pengajar melihat santri kelas yang diajarnya", async () => {
    const list = (await t.req("GET", "/api/santri", { cookie: cookie.guruC })).body;
    expect(nisOf(list)).toEqual(["1001", "1002"]);
    expect((await t.req("GET", `/api/santri/${id.s3}`, { cookie: cookie.guruC })).status).toBe(403);
  });

  it("wali santri hanya melihat anaknya", async () => {
    const list = (await t.req("GET", "/api/santri", { cookie: cookie.wali })).body;
    expect(nisOf(list)).toEqual(["1003"]);
    const detail = await t.req("GET", `/api/santri/${id.s3}`, { cookie: cookie.wali });
    expect(detail.body.wali[0]).toMatchObject({ nama: "Ibu Cahya", hubungan: "ibu" });
    expect((await t.req("GET", `/api/santri/${id.s1}`, { cookie: cookie.wali })).status).toBe(403);
    const me = await t.req("GET", "/api/me", { cookie: cookie.wali });
    expect(me.body.relasi.anak).toEqual([id.s3]);
  });

  it("tanpa relasi dan izin → daftar kosong, detail ditolak", async () => {
    expect((await t.req("GET", "/api/santri", { cookie: cookie.lain })).body).toEqual([]);
    expect((await t.req("GET", `/api/santri/${id.s1}`, { cookie: cookie.lain })).status).toBe(403);
  });

  it("izin jabatan 'lihat semua' melihat semua santri", async () => {
    await t.makeUser({ nama: "Kepsek", nomor: "6281500000050", roleNama: ["Kepala Sekolah"] });
    const { cookie: c } = await t.login("6281500000050", "rahasia123");
    expect(nisOf((await t.req("GET", "/api/santri", { cookie: c })).body)).toEqual([
      "1001",
      "1002",
      "1003",
    ]);
  });
});

describe("santri", () => {
  it("peringatan nama panggilan kembar dalam satu kelas", async () => {
    const res = await t.req("POST", "/api/santri", {
      cookie: admin,
      body: { nis: "1004", nama: "Ahmad Rizki", namaPanggilan: "ahmad", kelasId: id.kelasA },
    });
    expect(res.status).toBe(201);
    expect(res.body.peringatan).toMatch(/Ahmad Fauzi/);
    const list = (await t.req("GET", `/api/santri?kelasId=${id.kelasA}`, { cookie: admin })).body;
    expect(list.filter((s: { panggilanKembar: boolean }) => s.panggilanKembar)).toHaveLength(2);
  });

  it("satu pendaftaran per santri per tahun ajaran (pindah kelas = ubah, bukan tambah)", async () => {
    await t.req("PATCH", `/api/santri/${id.s2}`, {
      cookie: admin,
      body: { nis: "1002", nama: "Budi Santoso", kelasId: id.kelasB },
    });
    const rows = await t.db.select().from(pendaftaran).where(eq(pendaftaran.santriId, id.s2));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kelasId).toBe(id.kelasB);
  });

  it("kelas pendaftaran wajib dari tahun ajaran yang sama (FK komposit)", async () => {
    const ta2 = await post("/api/tahun-ajaran", {
      nama: "2025/2026",
      mulai: "2025-07-14",
      selesai: "2026-06-30",
    });
    await expect(
      t.db
        .insert(pendaftaran)
        .values({ santriId: id.s1, tahunAjaranId: ta2.id, kelasId: id.kelasA }),
    ).rejects.toThrow();
  });

  it("wali.kelola tidak bisa mereset akun staf lewat halaman wali", async () => {
    expect(
      (await t.req("POST", `/api/wali/${id.guruA}/reset-password`, { cookie: admin })).status,
    ).toBe(403);
    expect(
      (await t.req("POST", `/api/wali/${id.wali}/reset-password`, { cookie: admin })).status,
    ).toBe(200);
  });
});

describe("impor CSV", () => {
  const rows = Array.from({ length: 200 }, (_, i) => {
    const n = String(i + 1).padStart(3, "0");
    // Kakak-beradik berbagi wali: dua santri per keluarga → 100 keluarga, ayah & ibu = 200 wali + nomor lama.
    const fam = String(Math.floor(i / 2)).padStart(3, "0");
    return {
      nis: `2${n}`,
      nama: `Santri Impor ${n}`,
      nama_panggilan: `Imp${n}`,
      jenis_kelamin: i % 2 ? "P" : "L",
      tempat_lahir: "Jayapura",
      tanggal_lahir: `${String((i % 28) + 1).padStart(2, "0")}/07/2017`,
      alamat: "Jl. Contoh",
      unit: "MDTU",
      lokasi: i % 2 ? "rahe" : "KOTA",
      kelas: "kelas 1 banin",
      wali1_nama: `Ayah ${fam}`,
      wali1_hubungan: "ayah",
      wali1_hp: `0800 1${fam}0001`,
      wali2_nama: `Ibu ${fam}`,
      wali2_hubungan: "Ibu",
      wali2_hp: `+62 800 2${fam}0002`,
    };
  });

  it("200 santri masuk tanpa error; wali dengan nomor sama digabung", async () => {
    const preview = await t.req("POST", "/api/impor/santri/pratinjau", {
      cookie: admin,
      body: { tahunAjaranId: id.ta, rows },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.ringkasan).toEqual({
      santriBaru: 200,
      santriUbah: 0,
      waliBaru: 200,
      waliAda: 0,
      barisError: 0,
    });

    const res = await t.req("POST", "/api/impor/santri", {
      cookie: admin,
      body: { tahunAjaranId: id.ta, rows },
    });
    expect(res.status).toBe(200);
    expect(res.body.akunBaru).toHaveLength(200);
    const [{ n }] = (
      await t.db.execute<{ n: number }>(sql`select count(*)::int n from santri where nis like '2%'`)
    ).rows as [{ n: number }];
    expect(n).toBe(200);
    const [{ links }] = (
      await t.db.execute<{ links: number }>(
        sql`select count(*)::int links from santri_wali sw join santri s on s.id = sw.santri_id where s.nis like '2%'`,
      )
    ).rows as [{ links: number }];
    expect(links).toBe(400);

    // Wali impor bisa login dengan password sementara.
    const first = res.body.akunBaru[0];
    expect((await t.login(first.nomor, first.passwordSementara, { ip: "10.40.0.1" })).status).toBe(
      200,
    );
  }, 60_000);

  it("impor ulang: santri diubah, wali dipakai ulang (idempoten)", async () => {
    const preview = await t.req("POST", "/api/impor/santri/pratinjau", {
      cookie: admin,
      body: { tahunAjaranId: id.ta, rows },
    });
    expect(preview.body.ringkasan).toMatchObject({
      santriBaru: 0,
      santriUbah: 200,
      waliBaru: 0,
      waliAda: 200,
    });
    const res = await t.req("POST", "/api/impor/santri", {
      cookie: admin,
      body: { tahunAjaranId: id.ta, rows },
    });
    expect(res.body.akunBaru).toHaveLength(0);
    const [{ n }] = (await t.db.execute<{ n: number }>(sql`select count(*)::int n from santri`))
      .rows as [{ n: number }];
    expect(n).toBe(204);
  }, 60_000);

  it("baris salah dilaporkan per baris dan tidak ada yang tersimpan", async () => {
    const bad = [
      { nis: "3001", nama: "Benar", unit: "MDTU", lokasi: "KOTA", kelas: "Kelas 1 Banin" },
      { nis: "3001", nama: "", jenis_kelamin: "X", tanggal_lahir: "31/02/2017" },
      { nis: "3003", nama: "Kelas Salah", unit: "MDTU", lokasi: "KOTA", kelas: "Kelas 9" },
      { nis: "3004", nama: "HP Salah", wali1_nama: "Ayah", wali1_hp: "12345" },
    ];
    const res = await t.req("POST", "/api/impor/santri", {
      cookie: admin,
      body: { tahunAjaranId: id.ta, rows: bad },
    });
    expect(res.status).toBe(400);
    const errs = res.body.rows.map((r: { errors: string[] }) => r.errors.join("; "));
    expect(errs[0]).toBe("");
    expect(errs[1]).toMatch(/NIS ganda dengan baris 2.*Nama kosong.*Jenis kelamin.*Tanggal lahir/);
    expect(errs[2]).toMatch(/Kelas "Kelas 9"/);
    expect(errs[3]).toMatch(/Nomor HP wali 1 tidak valid/);
    expect(await t.db.select().from(santri).where(eq(santri.nis, "3001"))).toHaveLength(0);
  });

  it("impor butuh izin santri.kelola dan wali.kelola", async () => {
    const res = await t.req("POST", "/api/impor/santri/pratinjau", {
      cookie: cookie.guruA,
      body: { tahunAjaranId: id.ta, rows: [{ nis: "1" }] },
    });
    expect(res.status).toBe(403);
  });
});

describe("identitas, logo & manifest", () => {
  const png = (extra = "ikon") =>
    new Blob(
      [
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from(extra),
        ]),
      ],
      { type: "image/png" },
    );
  const upload = (form: FormData, c = admin) =>
    t.app.request(
      "/api/pengaturan/logo",
      { method: "POST", headers: { origin: ORIGIN, cookie: c }, body: form },
      { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
    );

  it("identitas & zona waktu tersimpan; manifest memakai nama lembaga", async () => {
    const res = await t.req("PUT", "/api/pengaturan/identitas", {
      cookie: admin,
      body: {
        nama: "Pondok Pesantren Contoh",
        namaSingkat: "PP Contoh",
        alamat: "Jayapura",
        zonaWaktu: "Asia/Jayapura",
      },
    });
    expect(res.status).toBe(200);
    const manifest = await (await t.app.request("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({
      name: "Pondok Pesantren Contoh",
      short_name: "PP Contoh",
      display: "standalone",
    });
    expect(manifest.icons[0].src).toBe("/icons/icon-192.png");
    expect(
      (await t.req("PUT", "/api/pengaturan/identitas", { cookie: cookie.guruA, body: {} })).status,
    ).toBe(403);
  });

  it("unggah logo + ikon: tercatat di berkas, manifest & public-config memakai ikon baru", async () => {
    const form = new FormData();
    form.set("logo", png("logo"), "logo.png");
    form.set("ikon192", png("192"), "i192.png");
    form.set("ikon512", png("512"), "i512.png");
    form.set("ikonMaskable", png("m"), "m.png");
    const res = await upload(form);
    expect(res.status).toBe(200);
    const ident = await res.json();
    const manifest = await (await t.app.request("/manifest.webmanifest")).json();
    expect(manifest.icons.map((i: { src: string }) => i.src)).toEqual([
      `/api/files/${ident.ikon192Id}`,
      `/api/files/${ident.ikon512Id}`,
      `/api/files/${ident.ikonMaskableId}`,
    ]);
    const file = await t.app.request(`/api/files/${ident.logoId}`);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("image/png");
    expect(
      Buffer.from(await file.arrayBuffer())
        .subarray(8)
        .toString(),
    ).toBe("logo");
    const pub = (await t.req("GET", "/api/public-config")).body;
    expect(pub.logoUrl).toBe(`/api/files/${ident.logoId}`);
  });

  it("berkas yang bukan gambar ditolak walau namanya .png", async () => {
    const form = new FormData();
    form.set("logo", new Blob(["<script>alert(1)</script>"], { type: "image/png" }), "logo.png");
    form.set("ikon192", png(), "a.png");
    form.set("ikon512", png(), "b.png");
    form.set("ikonMaskable", png(), "c.png");
    const res = await upload(form);
    expect(res.status).toBe(400);
  });
});
