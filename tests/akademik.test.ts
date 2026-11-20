import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, notifikasi } from "../src/server/db/schema";
import { DEFAULT_BOBOT, DEFAULT_SKALA, nilaiBerbobot, predikatDari } from "../src/shared/akademik";
import { checkTemplate, renderTemplate } from "../src/shared/template";
import { createTestContext, ORIGIN, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
type U = "guruA" | "guruB" | "guruC" | "kepsek" | "wali";
const c = {} as Record<U, string>;
const uid = {} as Record<U, string>;
const id = {} as Record<
  "unit" | "ta" | "sem1" | "kelas" | "fiqih" | "quran" | "pA" | "pB" | "s1" | "s2" | "d1" | "d2",
  string
>;

async function post(path: string, body: unknown, cookie = admin) {
  const res = await t.req("POST", path, { cookie, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const upload = (tugasId: string, file: Blob, name: string, cookie: string) => {
  const form = new FormData();
  form.set("berkas", file, name);
  return t.app.request(
    `/api/tugas/${tugasId}/lampiran`,
    { method: "POST", headers: { origin: ORIGIN, cookie }, body: form },
    { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
  );
};

beforeAll(async () => {
  t = await createTestContext();
  await t.makeUser({ nama: "Admin", nomor: "6282000000001", roleNama: ["Admin"] });
  admin = (await t.login("6282000000001", "rahasia123")).cookie;
  const lokasi = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.unit = (await post("/api/units", { kode: "MDTU", nama: "MDT Ula" })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
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
  for (const [i, [k, roles]] of (
    [
      ["guruA", []],
      ["guruB", []],
      ["guruC", []],
      ["kepsek", ["Kepala Sekolah"]],
    ] as [U, string[]][]
  ).entries()) {
    uid[k] = (await t.makeUser({ nama: k, nomor: `628200000010${i}`, roleNama: roles })).id;
  }
  id.kelas = (
    await post("/api/kelas", {
      tahunAjaranId: id.ta,
      unitId: id.unit,
      lokasiId: lokasi,
      nama: "Kelas 1",
      tingkat: 1,
      waliKelasId: uid.guruA,
    })
  ).id;
  id.fiqih = (await post("/api/mapel", { nama: "Fiqih", namaArab: "الفقه" })).id;
  id.quran = (await post("/api/mapel", { nama: "Al-Qur'an" })).id;
  id.pA = (
    await post("/api/pengajaran", {
      kelasId: id.kelas,
      mapelId: id.fiqih,
      guruId: uid.guruB,
      kkm: 70,
    })
  ).id;
  id.pB = (
    await post("/api/pengajaran", { kelasId: id.kelas, mapelId: id.quran, guruId: uid.guruA })
  ).id;
  id.s1 = (await post("/api/santri", { nis: "S1", nama: "Santri <Satu>", kelasId: id.kelas })).id;
  id.s2 = (await post("/api/santri", { nis: "S2", nama: "Santri Dua", kelasId: id.kelas })).id;
  const w = await post("/api/wali", { nama: "Wali S1", phones: [{ nomor: "6282000000200" }] });
  uid.wali = w.id;
  await t.req("PUT", "/api/santri-wali", {
    cookie: admin,
    body: { santriId: id.s1, userId: w.id },
  });
  const d = await t.db.execute<{ id: string; santri_id: string }>(
    sql`select id, santri_id from pendaftaran`,
  );
  id.d1 = d.rows.find((r) => r.santri_id === id.s1)?.id as string;
  id.d2 = d.rows.find((r) => r.santri_id === id.s2)?.id as string;
  await t.db.execute(sql`update users set wajib_ganti_password = false`);
  for (const [i, k] of (["guruA", "guruB", "guruC", "kepsek"] as U[]).entries()) {
    c[k] = (await t.login(`628200000010${i}`, "rahasia123")).cookie;
  }
  c.wali = (await t.login("6282000000200", w.passwordSementara)).cookie;
});
afterAll(() => t.drop());

describe("perhitungan", () => {
  it("nilai berbobot; jenis yang belum ada nilainya tidak dihitung", () => {
    expect(nilaiBerbobot({ UH: [80], UTS: [90], UAS: [100] }, DEFAULT_BOBOT)).toBe(92); // 7350/80 = 91,875
    expect(nilaiBerbobot({ UH: [70, 90], UTS: [60] }, DEFAULT_BOBOT)).toBe(69); // (80×20 + 60×25)/45 = 68,9
    expect(nilaiBerbobot({ PR: [100] }, { ...DEFAULT_BOBOT, PR: 0 })).toBeNull();
    expect(nilaiBerbobot({}, DEFAULT_BOBOT)).toBeNull();
  });

  it("batas predikat", () => {
    const p = (n: number) => predikatDari(n, DEFAULT_SKALA, "Fiqih")?.predikat;
    expect([p(100), p(90), p(89), p(80), p(79), p(70), p(69), p(0)]).toEqual([
      "A",
      "A",
      "B",
      "B",
      "C",
      "C",
      "D",
      "D",
    ]);
    expect(predikatDari(92, DEFAULT_SKALA, "Fiqih")?.deskripsi).toBe(
      "Sangat baik dalam menguasai materi Fiqih.",
    );
    expect(predikatDari(null, DEFAULT_SKALA)).toBeNull();
  });
});

describe("renderer template", () => {
  it("meng-escape semua nilai, mengulang daftar, dan bagian kosong", () => {
    const html = renderTemplate(
      "<h1>{{santri.nama}}</h1>{{#mapel}}<li>{{nama}}/{{kelas}}</li>{{/mapel}}{{^aspek}}kosong{{/aspek}}",
      {
        santri: { nama: '<script>alert("x")</script>' },
        kelas: "1A",
        mapel: [{ nama: "Fiqih & Adab" }, { nama: "Qur'an" }],
        aspek: [],
      },
    );
    expect(html).toBe(
      "<h1>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</h1><li>Fiqih &amp; Adab/1A</li><li>Qur&#39;an/1A</li>kosong",
    );
    expect(checkTemplate("{{#mapel}}x")).toMatch(/belum ditutup/);
    expect(checkTemplate("{{#a}}{{/b}}")).toMatch(/tidak cocok/);
  });
});

describe("tugas & lampiran", () => {
  let tugasId: string;
  let lampiranId: string;

  it("hanya guru mapel itu yang membuat tugas", async () => {
    const body = {
      pengajaranId: id.pA,
      judul: "Hafalkan doa wudhu",
      tanggalDiberi: "2026-11-18",
      tenggat: "2099-01-01",
    };
    expect((await t.req("POST", "/api/tugas", { cookie: c.guruC, body })).status).toBe(403);
    expect((await t.req("POST", "/api/tugas", { cookie: c.guruA, body })).status).toBe(403); // wali kelas, bukan guru Fiqih
    const res = await t.req("POST", "/api/tugas", { cookie: c.guruB, body });
    expect(res.status).toBe(201);
    tugasId = res.body.id;
  });

  it("lampiran diperiksa dari isinya; diunduh lewat route yang memeriksa hak", async () => {
    const palsu = await upload(tugasId, new Blob(["bukan pdf"]), "soal.pdf", c.guruB);
    expect(palsu.status).toBe(400);
    const besar = await upload(
      tugasId,
      new Blob([Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2_200_000)])]),
      "foto.jpg",
      c.guruB,
    );
    expect(besar.status).toBe(400);
    const ok = await upload(tugasId, new Blob(["%PDF-1.4 isi soal"]), "soal.pdf", c.guruB);
    expect(ok.status).toBe(201);
    lampiranId = (await ok.json()).id;
    const get = (cookie?: string) =>
      t.app.request(
        `/api/files/${lampiranId}`,
        { headers: cookie ? { cookie } : {} },
        { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
      );
    expect((await get()).status).toBe(401);
    expect((await get(c.guruC)).status).toBe(404);
    const byWali = await get(c.wali);
    expect(byWali.status).toBe(200);
    expect(byWali.headers.get("cache-control")).toBe("private, no-store");
    expect(await byWali.text()).toBe("%PDF-1.4 isi soal");
    expect((await get(c.guruA)).status).toBe(200); // wali kelas
  });

  it("kirim notifikasi tugas ke wali santri kelas itu", async () => {
    const res = await t.req("POST", `/api/tugas/${tugasId}/notifikasi`, { cookie: c.guruB });
    expect(res.body.penerima).toBe(1);
    const n = await t.db.select().from(notifikasi).where(eq(notifikasi.userId, uid.wali));
    expect(n[0]?.judul).toMatch(/PR Fiqih/);
  });
});

describe("penilaian, nilai, rapor", () => {
  const nilaiUntuk = async (jenis: string, judul: string, n1: number, n2: number | null) => {
    const pn = await post(
      "/api/penilaian",
      { pengajaranId: id.pA, jenis, judul, tanggal: "2026-11-18" },
      c.guruB,
    );
    const res = await t.req("PUT", `/api/penilaian/${pn.id}/nilai`, {
      cookie: c.guruB,
      body: {
        items: [
          { pendaftaranId: id.d1, nilai: n1 },
          { pendaftaranId: id.d2, nilai: n2 },
        ],
      },
    });
    expect(res.status).toBe(200);
    return pn.id as string;
  };
  let uhId: string;

  it("guru mengisi nilai; guru lain ditolak; perubahan tercatat", async () => {
    uhId = await nilaiUntuk("UH", "UH 1", 80, 60);
    await nilaiUntuk("UTS", "UTS", 90, 70);
    await nilaiUntuk("UAS", "UAS", 100, null);
    const res = await t.req("PUT", `/api/penilaian/${uhId}/nilai`, {
      cookie: c.guruC,
      body: { items: [{ pendaftaranId: id.d1, nilai: 10 }] },
    });
    expect(res.status).toBe(403);
    expect((await t.db.select().from(auditLog).where(eq(auditLog.aksi, "nilai.ubah"))).length).toBe(
      3,
    );
  });

  it("rapor mapel: nilai otomatis berbobot + predikat; nilai akhir manual tercatat", async () => {
    const r = await t.req("GET", `/api/rapor/mapel?pengajaranId=${id.pA}&semesterId=${id.sem1}`, {
      cookie: c.guruB,
    });
    const s1 = r.body.santri.find((s: { pendaftaranId: string }) => s.pendaftaranId === id.d1);
    expect(s1).toMatchObject({ nilaiOtomatis: 92, nilaiAkhir: 92, predikat: "A", manual: false });
    const s2 = r.body.santri.find((s: { pendaftaranId: string }) => s.pendaftaranId === id.d2);
    expect(s2.nilaiOtomatis).toBe(66); // (60×20 + 70×25)/45 = 65,6
    const put = await t.req("PUT", "/api/rapor/mapel", {
      cookie: c.guruB,
      body: {
        pengajaranId: id.pA,
        semesterId: id.sem1,
        items: [{ pendaftaranId: id.d1, nilaiAkhir: 88, deskripsi: null }],
      },
    });
    expect(put.status).toBe(200);
    const after = await t.req(
      "GET",
      `/api/rapor/mapel?pengajaranId=${id.pA}&semesterId=${id.sem1}`,
      { cookie: c.guruB },
    );
    expect(
      after.body.santri.find((s: { pendaftaranId: string }) => s.pendaftaranId === id.d1),
    ).toMatchObject({ nilaiAkhir: 88, manual: true, predikat: "B" });
    expect(
      (await t.db.select().from(auditLog).where(eq(auditLog.aksi, "rapor_nilai.ubah"))).length,
    ).toBe(1);
  });

  it("rapor kelas diisi wali kelas saja", async () => {
    const body = {
      semesterId: id.sem1,
      aspek: [],
      catatanWali: "Rajin & sopan",
      keputusan: "naik",
    };
    expect(
      (await t.req("PUT", `/api/rapor/kelas/${id.d1}`, { cookie: c.guruB, body })).status,
    ).toBe(403);
    expect(
      (await t.req("PUT", `/api/rapor/kelas/${id.d1}`, { cookie: c.guruA, body })).status,
    ).toBe(200);
  });

  it("wali santri belum bisa melihat rapor draft", async () => {
    const res = await t.req(
      "GET",
      `/api/rapor/cetak?pendaftaranId=${id.d1}&semesterId=${id.sem1}`,
      { cookie: c.wali },
    );
    expect(res.status).toBe(403);
  });

  it("kunci rapor: hanya izin rapor.kunci; setelah final nilai & catatan terkunci", async () => {
    const body = { kelasId: id.kelas, semesterId: id.sem1 };
    expect((await t.req("POST", "/api/rapor/kunci", { cookie: c.guruA, body })).status).toBe(403);
    expect((await t.req("POST", "/api/rapor/kunci", { cookie: c.kepsek, body })).status).toBe(200);
    const ubahNilai = await t.req("PUT", `/api/penilaian/${uhId}/nilai`, {
      cookie: c.guruB,
      body: { items: [{ pendaftaranId: id.d1, nilai: 50 }] },
    });
    expect(ubahNilai.status).toBe(409);
    const ubahCatatan = await t.req("PUT", `/api/rapor/kelas/${id.d1}`, {
      cookie: c.guruA,
      body: { semesterId: id.sem1, aspek: [], catatanWali: "ubah", keputusan: null },
    });
    expect(ubahCatatan.status).toBe(409);
  });

  it("setelah final wali santri melihat & mencetak rapor anaknya (bukan anak lain)", async () => {
    const res = await t.req(
      "GET",
      `/api/rapor/cetak?pendaftaranId=${id.d1}&semesterId=${id.sem1}`,
      { cookie: c.wali },
    );
    expect(res.status).toBe(200);
    const [d] = res.body.data;
    expect(d).toMatchObject({ draft: false, catatan: "Rajin & sopan", keputusan: "" }); // keputusan hanya semester 2
    expect(d.mapel.find((m: { nama: string }) => m.nama === "Fiqih")).toMatchObject({
      nilai: "88",
      predikat: "B",
      namaArab: "الفقه",
      kkm: "70",
    });
    expect(d.santri.nama).toBe("Santri <Satu>");
    expect(renderTemplate(res.body.template.html, d)).toContain("Santri &lt;Satu&gt;");
    expect(
      (
        await t.req("GET", `/api/rapor/cetak?pendaftaranId=${id.d2}&semesterId=${id.sem1}`, {
          cookie: c.wali,
        })
      ).status,
    ).toBe(403);
    const anak = await t.req("GET", `/api/akademik/anak/${id.s1}`, { cookie: c.wali });
    expect(anak.body.rapor).toHaveLength(1);
    expect(anak.body.tugas[0].lampiran).toHaveLength(1);
    expect((await t.req("GET", `/api/akademik/anak/${id.s2}`, { cookie: c.wali })).status).toBe(
      403,
    );
  });

  it("buka kunci mengembalikan ke draft", async () => {
    await post("/api/rapor/buka", {
      kelasId: id.kelas,
      semesterId: id.sem1,
      pendaftaranIds: [id.d1],
    });
    expect(
      (
        await t.req("GET", `/api/rapor/cetak?pendaftaranId=${id.d1}&semesterId=${id.sem1}`, {
          cookie: c.wali,
        })
      ).status,
    ).toBe(403);
  });
});

describe("pengaturan & template", () => {
  it("bobot harus total 100; template dengan sintaks salah ditolak", async () => {
    const skala = [
      { predikat: "A", min: 85 },
      { predikat: "B", min: 0 },
    ];
    const bad = await t.req("PUT", `/api/akademik/pengaturan/${id.unit}`, {
      cookie: admin,
      body: { bobot: { PR: 50, tugas: 0, UH: 0, UTS: 0, UAS: 0, praktik: 0 }, skala, aspek: [] },
    });
    expect(bad.status).toBe(400);
    const ok = await t.req("PUT", `/api/akademik/pengaturan/${id.unit}`, {
      cookie: admin,
      body: {
        bobot: { PR: 0, tugas: 0, UH: 100, UTS: 0, UAS: 0, praktik: 0 },
        skala,
        aspek: [{ kelompok: "Sikap", nama: "Akhlak", tipe: "predikat" }],
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.aspek).toHaveLength(1);
    const r = await t.req("GET", `/api/rapor/mapel?pengajaranId=${id.pA}&semesterId=${id.sem1}`, {
      cookie: c.guruB,
    });
    // d2 sudah final → nilai dibekukan (tidak ikut bobot baru); d1 draft → dihitung ulang dengan bobot baru.
    expect(
      r.body.santri.find((s: { pendaftaranId: string }) => s.pendaftaranId === id.d2),
    ).toMatchObject({ nilaiOtomatis: 66, final: true });
    expect(
      r.body.santri.find((s: { pendaftaranId: string }) => s.pendaftaranId === id.d1),
    ).toMatchObject({ nilaiOtomatis: 80, nilaiAkhir: 88, manual: true, predikat: "A" });
    expect(
      (
        await t.req("PUT", `/api/rapor/template/${id.unit}`, {
          cookie: admin,
          body: { nama: "X", html: "{{#mapel}}", css: "" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await t.req("PUT", `/api/rapor/template/${id.unit}`, {
          cookie: c.guruA,
          body: { nama: "X", html: "ok", css: "" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await t.req("PUT", `/api/rapor/template/${id.unit}`, {
          cookie: admin,
          body: { nama: "Baru", html: "<p>{{santri.nama}}</p>", css: "p{}" },
        })
      ).status,
    ).toBe(200);
    const cetak = await t.req("GET", `/api/rapor/cetak?kelasId=${id.kelas}&semesterId=${id.sem1}`, {
      cookie: c.guruA,
    });
    expect(cetak.body.template.html).toBe("<p>{{santri.nama}}</p>");
    expect(cetak.body.data).toHaveLength(2);
  });
});

describe("review M5", () => {
  it("nilai yang masuk setelah guru menyimpan rapor mapel ikut terhitung saat dikunci (regresi)", async () => {
    await post("/api/rapor/buka", {
      kelasId: id.kelas,
      semesterId: id.sem1,
      pendaftaranIds: [id.d2],
    });
    // Bobot kini UH 100%; skala A ≥85, B ≥0. Nilai UH d2 sejauh ini: 60.
    await t.req("PUT", "/api/rapor/mapel", {
      cookie: c.guruB,
      body: {
        pengajaranId: id.pA,
        semesterId: id.sem1,
        items: [{ pendaftaranId: id.d2, nilaiAkhir: null, deskripsi: null }],
      },
    });
    const uh2 = await post(
      "/api/penilaian",
      { pengajaranId: id.pA, jenis: "UH", judul: "UH 2", tanggal: "2026-11-25" },
      c.guruB,
    );
    await t.req("PUT", `/api/penilaian/${uh2.id}/nilai`, {
      cookie: c.guruB,
      body: { items: [{ pendaftaranId: id.d2, nilai: 100 }] },
    });
    const draft = await t.req(
      "GET",
      `/api/rapor/cetak?pendaftaranId=${id.d2}&semesterId=${id.sem1}`,
      { cookie: admin },
    );
    expect(
      draft.body.data[0].mapel.find((m: { nama: string }) => m.nama === "Fiqih"),
    ).toMatchObject({ nilai: "80", predikat: "B" });
    await post("/api/rapor/kunci", {
      kelasId: id.kelas,
      semesterId: id.sem1,
      pendaftaranIds: [id.d2],
    });
    const final = await t.req(
      "GET",
      `/api/rapor/cetak?pendaftaranId=${id.d2}&semesterId=${id.sem1}`,
      { cookie: admin },
    );
    expect(
      final.body.data[0].mapel.find((m: { nama: string }) => m.nama === "Fiqih"),
    ).toMatchObject({ nilai: "80", predikat: "B" });
  });

  it("guru mapel lain di kelas yang sama tidak melihat nilai & lampiran mapel ini", async () => {
    const tarikh = (await post("/api/mapel", { nama: "Tarikh" })).id;
    await post("/api/pengajaran", { kelasId: id.kelas, mapelId: tarikh, guruId: uid.guruC });
    expect(
      (await t.req("GET", `/api/penilaian?pengajaranId=${id.pA}`, { cookie: c.guruC })).status,
    ).toBe(403);
    expect(
      (
        await t.req("GET", `/api/rapor/mapel?pengajaranId=${id.pA}&semesterId=${id.sem1}`, {
          cookie: c.guruC,
        })
      ).status,
    ).toBe(403);
    expect(
      (await t.req("GET", `/api/tugas?pengajaranId=${id.pA}`, { cookie: c.guruC })).status,
    ).toBe(403);
    expect(
      (await t.req("GET", `/api/penilaian?pengajaranId=${id.pA}`, { cookie: c.guruA })).status,
    ).toBe(200); // wali kelas
  });

  it("aspek unit lain & semester tahun ajaran lain ditolak", async () => {
    const unit2 = (await post("/api/units", { kode: "MDTW", nama: "MDT Wustha" })).id;
    const set = await t.req("PUT", `/api/akademik/pengaturan/${unit2}`, {
      cookie: admin,
      body: {
        bobot: { PR: 0, tugas: 0, UH: 100, UTS: 0, UAS: 0, praktik: 0 },
        skala: [{ predikat: "A", min: 0 }],
        aspek: [{ kelompok: "X", nama: "Y", tipe: "teks" }],
      },
    });
    await post("/api/rapor/buka", {
      kelasId: id.kelas,
      semesterId: id.sem1,
      pendaftaranIds: [id.d1],
    });
    const res = await t.req("PUT", `/api/rapor/kelas/${id.d1}`, {
      cookie: c.guruA,
      body: {
        semesterId: id.sem1,
        aspek: [{ aspekId: set.body.aspek[0].id, nilai: "x" }],
        catatanWali: null,
        keputusan: null,
      },
    });
    expect(res.status).toBe(400);
    const ta2 = (
      await post("/api/tahun-ajaran", {
        nama: "2027/2028",
        mulai: "2027-07-12",
        selesai: "2028-06-30",
      })
    ).id;
    const sem = (
      await post("/api/semester", {
        tahunAjaranId: ta2,
        nomor: 1,
        mulai: "2027-07-12",
        selesai: "2027-12-18",
      })
    ).id;
    expect(
      (
        await t.req("GET", `/api/penilaian?pengajaranId=${id.pA}&semesterId=${sem}`, {
          cookie: c.guruB,
        })
      ).status,
    ).toBe(400);
  });

  it("hapus tugas ikut menghapus berkas lampiran di disk", async () => {
    const tg = await post(
      "/api/tugas",
      { pengajaranId: id.pA, judul: "Sementara", tanggalDiberi: "2026-11-20" },
      c.guruB,
    );
    expect((await upload(tg.id, new Blob(["%PDF-1.4 x"]), "a.pdf", c.guruB)).status).toBe(201);
    const before = (await t.storage.list("files")).length;
    expect((await t.req("DELETE", `/api/tugas/${tg.id}`, { cookie: c.guruB })).status).toBe(200);
    expect((await t.storage.list("files")).length).toBe(before - 1);
  });

  it("cetak satu kelas tidak memuat santri yang sudah keluar (tanpa rapor final)", async () => {
    const s3 = (await post("/api/santri", { nis: "S3", nama: "Santri Keluar", kelasId: id.kelas }))
      .id;
    await t.req("PATCH", `/api/santri/${s3}`, {
      cookie: admin,
      body: { nis: "S3", nama: "Santri Keluar", kelasId: id.kelas, status: "keluar" },
    });
    const res = await t.req("GET", `/api/rapor/cetak?kelasId=${id.kelas}&semesterId=${id.sem1}`, {
      cookie: admin,
    });
    const names = res.body.data.map((d: { santri: { nama: string } }) => d.santri.nama);
    expect(names).not.toContain("Santri Keluar");
    expect(names).toEqual(expect.arrayContaining(["Santri <Satu>", "Santri Dua"]));
  });
});
