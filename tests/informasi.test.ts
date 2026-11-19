import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transactionWithClient } from "../src/server/db/client";
import { notifikasi, pushSubscriptions, settings, users } from "../src/server/db/schema";
import { createBoss } from "../src/server/jobs/boss";
import { QUEUES } from "../src/server/jobs/queues";
import { penerimaDariSasaran } from "../src/server/services/pengumuman";
import { notify, sendPush } from "../src/server/services/push";
import { createTestContext, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
type U = "admin" | "guruA" | "guruB" | "guruC" | "kepsek" | "w1" | "w2" | "w3" | "w4";
const uid = {} as Record<U, string>;
const c = {} as Record<U, string>;
const id = {} as Record<"kota" | "rahe" | "mdtu" | "ta" | "kelasA" | "kelasB", string>;

async function post(path: string, body: unknown, cookie = admin) {
  const res = await t.req("POST", path, { cookie, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const kirim = (cookie: string, sasaran: unknown[], extra: Record<string, unknown> = {}) =>
  t.req("POST", "/api/pengumuman", {
    cookie,
    body: { judul: "Info", isi: "Isi pengumuman", sasaran, ...extra },
  });
const set = (ids: string[]) => [...ids].sort();

beforeAll(async () => {
  t = await createTestContext();
  uid.admin = (await t.makeUser({ nama: "Admin", nomor: "6281900000001", roleNama: ["Admin"] })).id;
  admin = (await t.login("6281900000001", "rahasia123")).cookie;
  id.kota = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.rahe = (await post("/api/lokasi", { nama: "RAHE" })).id;
  id.mdtu = (await post("/api/units", { kode: "MDTU", nama: "MDT Ula" })).id;
  const unitTa = (await post("/api/units", { kode: "TA", nama: "TA" })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).id;
  await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
  const staf: [U, string, string[]][] = [
    ["guruA", "Guru A", []],
    ["guruB", "Guru B", []],
    ["guruC", "Guru C", []],
    ["kepsek", "Kepsek", ["Kepala Sekolah"]],
  ];
  for (const [i, [k, nama, roleNama]] of staf.entries()) {
    uid[k] = (await t.makeUser({ nama, nomor: `628190000010${i}`, roleNama })).id;
  }
  id.kelasA = (
    await post("/api/kelas", {
      tahunAjaranId: id.ta,
      unitId: id.mdtu,
      lokasiId: id.kota,
      nama: "A",
      tingkat: 1,
      waliKelasId: uid.guruA,
    })
  ).id;
  id.kelasB = (
    await post("/api/kelas", {
      tahunAjaranId: id.ta,
      unitId: unitTa,
      lokasiId: id.rahe,
      nama: "B",
      tingkat: 1,
      waliKelasId: uid.guruB,
    })
  ).id;
  const mapel = (await post("/api/mapel", { nama: "Fiqih" })).id;
  await post("/api/pengajaran", { kelasId: id.kelasA, mapelId: mapel, guruId: uid.guruC });
  const santri = async (nis: string, kelasId: string, status = "aktif") =>
    (await post("/api/santri", { nis, nama: nis, kelasId, status })).id;
  const a1 = await santri("a1", id.kelasA);
  const b1 = await santri("b1", id.kelasB);
  const a2 = await santri("a2", id.kelasA, "keluar");
  const passwords: Partial<Record<U, string>> = {};
  for (const [i, [k, santriId]] of (
    [
      ["w1", a1],
      ["w2", b1],
      ["w3", a2],
      ["w4", a1],
    ] as [U, string][]
  ).entries()) {
    const w = await post("/api/wali", {
      nama: k.toUpperCase(),
      phones: [{ nomor: `628190000020${i}` }],
    });
    uid[k] = w.id;
    passwords[k] = w.passwordSementara;
    await t.req("PUT", "/api/santri-wali", { cookie: admin, body: { santriId, userId: w.id } });
  }
  await t.db.update(users).set({ status: "nonaktif" }).where(eq(users.id, uid.w4));
  await t.db.execute(sql`update users set wajib_ganti_password = false`);
  for (const [i, k] of (["guruA", "guruB", "guruC", "kepsek"] as U[]).entries()) {
    c[k] = (await t.login(`628190000010${i}`, "rahasia123")).cookie;
  }
  c.w1 = (await t.login("6281900000200", passwords.w1 as string)).cookie;
  c.w2 = (await t.login("6281900000201", passwords.w2 as string)).cookie;
});
afterAll(() => t.drop());

describe("penerima dari sasaran", () => {
  it("kelas: wali santri aktif + wali kelas + guru pengajar (tanpa santri keluar, akun nonaktif, pengirim)", async () => {
    const r = await penerimaDariSasaran(
      t.db,
      [{ unitId: null, lokasiId: null, kelasId: id.kelasA }],
      uid.admin,
    );
    expect(set(r)).toEqual(set([uid.w1, uid.guruA, uid.guruC]));
    const tanpaPengirim = await penerimaDariSasaran(
      t.db,
      [{ unitId: null, lokasiId: null, kelasId: id.kelasA }],
      uid.guruA,
    );
    expect(tanpaPengirim).not.toContain(uid.guruA);
  });

  it("unit, lokasi, dan seluruh sekolah", async () => {
    const unitTa = await penerimaDariSasaran(
      t.db,
      [
        {
          unitId:
            (await t.db.execute<{ id: string }>(sql`select id from units where kode='TA'`)).rows[0]
              ?.id ?? null,
          lokasiId: null,
          kelasId: null,
        },
      ],
      uid.admin,
    );
    expect(set(unitTa)).toEqual(set([uid.w2, uid.guruB]));
    const kota = await penerimaDariSasaran(
      t.db,
      [{ unitId: null, lokasiId: id.kota, kelasId: null }],
      uid.admin,
    );
    expect(set(kota)).toEqual(set([uid.w1, uid.guruA, uid.guruC]));
    const semua = await penerimaDariSasaran(
      t.db,
      [{ unitId: null, lokasiId: null, kelasId: null }],
      uid.admin,
    );
    expect(set(semua)).toEqual(set([uid.w1, uid.w2, uid.guruA, uid.guruB, uid.guruC, uid.kepsek]));
  });
});

describe("hak mengirim pengumuman", () => {
  it("wali santri tidak bisa; wali kelas hanya kelasnya; pengajar kelas/unit; jabatan semua sasaran", async () => {
    expect((await kirim(c.w1, [{ kelasId: id.kelasA }])).status).toBe(403);
    expect((await kirim(c.guruA, [{ kelasId: id.kelasB }])).status).toBe(403);
    expect((await kirim(c.guruA, [{ unitId: id.mdtu }])).status).toBe(403);
    expect((await kirim(c.guruC, [{ unitId: id.mdtu }], { kirimNotifikasi: false })).status).toBe(
      201,
    );
    expect((await kirim(c.guruC, [{ lokasiId: id.kota }])).status).toBe(403);
    expect((await kirim(c.kepsek, [{}], { judul: "Libur semester" })).status).toBe(201);
  });
});

describe("notifikasi", () => {
  it("pengumuman ke satu kelas masuk kotak notifikasi penerimanya saja, beserta nama pengirim", async () => {
    await t.db.insert(pushSubscriptions).values({
      userId: uid.w1,
      endpoint: "https://push.contoh/abc",
      p256dh: "p".repeat(20),
      auth: "a".repeat(10),
    });
    t.jobs.length = 0;
    const res = await kirim(c.guruA, [{ kelasId: id.kelasA }], { judul: "PR Fiqih" });
    expect(res.status).toBe(201);
    expect(res.body.penerima).toBe(2); // W1 + guru C (pengirim tidak termasuk)
    const w1 = await t.req("GET", "/api/notifikasi", { cookie: c.w1 });
    expect(w1.body.find((n: { judul: string }) => n.judul === "PR Fiqih")).toMatchObject({
      pengirimNama: "Guru A",
      dibacaAt: null,
    });
    const w2 = await t.req("GET", "/api/notifikasi", { cookie: c.w2 });
    expect(w2.body.map((n: { judul: string }) => n.judul)).not.toContain("PR Fiqih");
    // Satu job push per perangkat penerima.
    expect(t.jobs).toEqual([expect.objectContaining({ name: QUEUES.pushSend })]);
  });

  it("hanya bisa menandai notifikasi sendiri; jumlah belum dibaca berkurang", async () => {
    const [n] = (await t.req("GET", "/api/notifikasi?status=belum", { cookie: c.w1 })).body;
    expect((await t.req("POST", `/api/notifikasi/${n.id}/baca`, { cookie: c.w2 })).status).toBe(
      404,
    );
    const before = (await t.req("GET", "/api/notifikasi/jumlah", { cookie: c.w1 })).body.belum;
    expect((await t.req("POST", `/api/notifikasi/${n.id}/baca`, { cookie: c.w1 })).status).toBe(
      200,
    );
    expect((await t.req("GET", "/api/notifikasi/jumlah", { cookie: c.w1 })).body.belum).toBe(
      before - 1,
    );
    await t.req("POST", "/api/notifikasi/baca-semua", { cookie: c.w1 });
    expect((await t.req("GET", "/api/notifikasi/jumlah", { cookie: c.w1 })).body.belum).toBe(0);
  });

  it("tanpa centang kirim notifikasi: pengumuman tampil, notifikasi tidak dibuat", async () => {
    const before = (await t.db.select().from(notifikasi)).length;
    expect(
      (
        await kirim(c.guruA, [{ kelasId: id.kelasA }], {
          judul: "Diam-diam",
          kirimNotifikasi: false,
        })
      ).status,
    ).toBe(201);
    expect((await t.db.select().from(notifikasi)).length).toBe(before);
    const list = (await t.req("GET", "/api/pengumuman", { cookie: c.w1 })).body.map(
      (p: { judul: string }) => p.judul,
    );
    expect(list).toContain("Diam-diam");
  });

  it("daftar pengumuman relevan per pengguna", async () => {
    const judul = async (cookie: string) =>
      (await t.req("GET", "/api/pengumuman", { cookie })).body.map(
        (p: { judul: string }) => p.judul,
      );
    const w1 = await judul(c.w1);
    const w2 = await judul(c.w2);
    expect(w1).toEqual(expect.arrayContaining(["PR Fiqih", "Libur semester"]));
    expect(w2).toContain("Libur semester");
    expect(w2).not.toContain("PR Fiqih");
    expect(w2).not.toContain("Info"); // unit MDTU dari guru C
  });
});

describe("antrean push", () => {
  it("job tidak dibuat bila transaksi gagal; dibuat bila berhasil", async () => {
    const boss = createBoss(t.url);
    await boss.start();
    await boss.createQueue(QUEUES.pushSend);
    const jobCount = async () =>
      Number(
        (
          await t.db.execute<{ n: string }>(
            sql`select count(*) n from pgboss.job where name = ${QUEUES.pushSend}`,
          )
        ).rows[0]?.n,
      );
    const notifCount = async () =>
      (await t.db.select().from(notifikasi).where(eq(notifikasi.judul, "Uji transaksi"))).length;
    const n = { jenis: "sistem", judul: "Uji transaksi", isi: "x", pengirimUserId: null };
    await expect(
      transactionWithClient(t.pool, async (tx, client) => {
        await notify(tx, client, boss, [uid.w1], n);
        throw new Error("gagal setelah notify");
      }),
    ).rejects.toThrow("gagal setelah notify");
    expect(await jobCount()).toBe(0);
    expect(await notifCount()).toBe(0);
    await transactionWithClient(t.pool, (tx, client) => notify(tx, client, boss, [uid.w1], n));
    expect(await jobCount()).toBe(1);
    expect(await notifCount()).toBe(1);
    await boss.stop({ graceful: false, wait: true });
  });

  it("kirim push: 410 menghapus langganan, error lain dilempar untuk dicoba ulang", async () => {
    const [n] = await t.db.select().from(notifikasi).where(eq(notifikasi.userId, uid.w1)).limit(1);
    const [sub] = await t.db
      .insert(pushSubscriptions)
      .values({
        userId: uid.w1,
        endpoint: "https://push.contoh/mati",
        p256dh: "p".repeat(20),
        auth: "a".repeat(10),
      })
      .returning();
    const cfg = {
      encryptionKey: Buffer.alloc(32, 9).toString("base64"),
      appUrl: "https://app.contoh.sch.id",
    };
    const job = { subscriptionId: sub?.id as string, notifikasiId: n?.id as string };
    let payload = "";
    const ok = await sendPush(t.db, cfg, job, (async (_s: unknown, p: string) => {
      payload = p;
      return { statusCode: 201, body: "", headers: {} };
    }) as never);
    expect(ok).toBe("terkirim");
    expect(JSON.parse(payload)).toMatchObject({ judul: n?.judul, url: n?.url ?? "/notifikasi" });
    const fail500 = (async () => {
      throw Object.assign(new Error("server"), { statusCode: 500 });
    }) as never;
    await expect(sendPush(t.db, cfg, job, fail500)).rejects.toThrow(/status 500/);
    expect(
      await t.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.id, sub?.id as string)),
    ).toHaveLength(1);
    const gone = (async () => {
      throw Object.assign(new Error("gone"), { statusCode: 410 });
    }) as never;
    expect(await sendPush(t.db, cfg, job, gone)).toBe("langganan-dihapus");
    expect(
      await t.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.id, sub?.id as string)),
    ).toHaveLength(0);
  });
});

describe("langganan & VAPID", () => {
  it("kunci VAPID dibuat sekali; kunci privat tersimpan terenkripsi", async () => {
    const k1 = (await t.req("GET", "/api/push/kunci")).body.publicKey;
    const k2 = (await t.req("GET", "/api/push/kunci")).body.publicKey;
    expect(k1).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(k2).toBe(k1);
    const [row] = await t.db.select().from(settings).where(eq(settings.key, "vapid"));
    expect(row?.terenkripsi).toBe(true);
    const v = row?.value as { privateKey: { data: string; iv: string } };
    expect(v.privateKey.iv).toBeTruthy();
  });

  it("langganan milik pengguna yang login; endpoint http ditolak; tidak bisa menghapus milik orang lain", async () => {
    const body = {
      endpoint: "https://push.contoh/w2",
      keys: { p256dh: "x".repeat(30), auth: "y".repeat(12) },
    };
    expect(
      (
        await t.req("PUT", "/api/push/langganan", {
          cookie: c.w2,
          body: { ...body, endpoint: "http://jahat" },
        })
      ).status,
    ).toBe(400);
    expect((await t.req("PUT", "/api/push/langganan", { cookie: c.w2, body })).status).toBe(200);
    await t.req("DELETE", "/api/push/langganan", {
      cookie: c.w1,
      body: { endpoint: body.endpoint },
    });
    const rows = await t.db
      .select()
      .from(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.endpoint, body.endpoint), eq(pushSubscriptions.userId, uid.w2)),
      );
    expect(rows).toHaveLength(1);
    expect(
      (
        await t.req("DELETE", "/api/push/langganan", {
          cookie: c.w2,
          body: { endpoint: body.endpoint },
        })
      ).status,
    ).toBe(200);
    expect(
      await t.db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, body.endpoint)),
    ).toHaveLength(0);
  });
});
