import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { transactionWithClient } from "../src/server/db/client";
import { notifikasi, otpCodes, pembayaran, tagihan, waOutbox } from "../src/server/db/schema";
import { nokenSignature } from "../src/server/payment/noken-pay";
import { tagihanHarian } from "../src/server/services/keuangan";
import { rekonsiliasi } from "../src/server/services/pembayaran-online";
import { processWaJob, queueWa } from "../src/server/services/wa";
import { hitungPotongan, isiTemplate } from "../src/shared/keuangan";
import { createTestContext, type TestContext } from "./helpers/app";

const KEY = Buffer.alloc(32, 9).toString("base64"); // sama dengan helper tes
const SECRET = "rahasia-webhook";
let t: TestContext;
let admin: string;
let bendahara: string;
let wali: string;
const id = {} as Record<"ta" | "unit" | "lokasi" | "kelas" | "s1" | "s2" | "wali", string>;

// ---------------------------------------------------------------- server tiruan
type Pay = {
  id: string;
  external_id: string;
  status: "pending" | "paid" | "expired" | "canceled";
  base_amount: number;
  charged_amount: number;
  qris: string;
  expires_at: string;
  paid_at: string | null;
};
const payments = new Map<string, Pay>();
const gowaReq: { auth?: string; device?: string; body: { phone: string; message: string } }[] = [];
let gowaFail = false;
let noken: Server;
let gowa: Server;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    let s = "";
    req.on("data", (d) => {
      s += d;
    });
    req.on("end", () => ok(s));
  });

function listen(srv: Server) {
  return new Promise<string>((ok) =>
    srv.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`)),
  );
}

async function post(path: string, body: unknown, cookie = admin) {
  const res = await t.req("POST", path, { cookie, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
const put = async (path: string, body: unknown, cookie = admin) => {
  const res = await t.req("PUT", path, { cookie, body });
  if (res.status >= 300) throw new Error(`${path}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
};

function webhook(p: Pay, opts: { secret?: string; ts?: number } = {}) {
  const body = { event: "payment.paid", late: false, previous_status: "pending", payment: p };
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  return t.req("POST", "/api/webhooks/noken-pay", {
    body,
    headers: {
      origin: "",
      "x-noken-timestamp": ts,
      "x-noken-signature": nokenSignature(opts.secret ?? SECRET, ts, JSON.stringify(body)),
    },
  });
}

beforeAll(async () => {
  let n = 0;
  noken = createServer(async (req, res) => {
    const raw = await readBody(req);
    if (req.headers["x-api-key"] !== "kunci-api") {
      res.writeHead(401).end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/payments") {
      const b = JSON.parse(raw);
      const p: Pay = {
        id: `pay_${++n}`,
        external_id: b.external_id,
        status: "pending",
        base_amount: b.amount,
        charged_amount: b.amount + 3,
        qris: "00020101021226QRISCONTOH",
        expires_at: new Date(Date.now() + b.expiry_s * 1000).toISOString(),
        paid_at: null,
      };
      payments.set(p.id, p);
      res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify(p));
      return;
    }
    const m = req.url?.match(/^\/v1\/payments\/(.+)$/);
    const p = m && payments.get(decodeURIComponent(m[1] as string));
    if (p) res.writeHead(200).end(JSON.stringify(p));
    else res.writeHead(404).end(JSON.stringify({ error: "not found" }));
  });
  gowa = createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req));
    gowaReq.push({
      auth: req.headers.authorization,
      device: req.headers["x-device-id"] as string | undefined,
      body,
    });
    if (gowaFail) {
      res
        .writeHead(500)
        .end(JSON.stringify({ code: "INTERNAL_SERVER_ERROR", message: "you are not loggin" }));
      return;
    }
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(
        JSON.stringify({ code: "SUCCESS", message: "Success", results: { message_id: "3EB0" } }),
      );
  });
  const [nokenUrl, gowaUrl] = await Promise.all([listen(noken), listen(gowa)]);

  t = await createTestContext();
  await t.makeUser({ nama: "Admin", nomor: "6282100000001", roleNama: ["Admin"] });
  await t.makeUser({ nama: "Bendahara", nomor: "6282100000002", roleNama: ["Bendahara"] });
  admin = (await t.login("6282100000001", "rahasia123")).cookie;
  bendahara = (await t.login("6282100000002", "rahasia123")).cookie;
  id.lokasi = (await post("/api/lokasi", { nama: "KOTA" })).id;
  id.unit = (await post("/api/units", { kode: "TA", nama: "Taman" })).id;
  id.ta = (
    await post("/api/tahun-ajaran", {
      nama: "2026/2027",
      mulai: "2026-07-13",
      selesai: "2027-06-30",
    })
  ).id;
  await post(`/api/tahun-ajaran/${id.ta}/aktifkan`, {});
  id.kelas = (
    await post("/api/kelas", {
      tahunAjaranId: id.ta,
      unitId: id.unit,
      lokasiId: id.lokasi,
      nama: "A",
      tingkat: 1,
    })
  ).id;
  id.s1 = (await post("/api/santri", { nis: "K1", nama: "Ahmad", kelasId: id.kelas })).id;
  id.s2 = (await post("/api/santri", { nis: "K2", nama: "Fatimah", kelasId: id.kelas })).id;
  const w = await post("/api/wali", {
    nama: "Bapak Ahmad",
    phones: [{ nomor: "6282100000200" }, { nomor: "6282100000201", untukLogin: false }],
  });
  id.wali = w.id;
  await put("/api/santri-wali", { santriId: id.s1, userId: w.id });
  await t.db.execute(sql`update users set wajib_ganti_password = false`);
  wali = (await t.login("6282100000200", w.passwordSementara)).cookie;

  await put("/api/pengaturan/pembayaran", {
    aktif: true,
    provider: "noken-pay",
    url: nokenUrl,
    apiKey: "kunci-api",
    webhookSecret: SECRET,
    urlWebhook: "",
    kedaluwarsaMenit: 15,
  });
  await put("/api/pengaturan/wa", {
    aktif: true,
    url: gowaUrl,
    user: "gowa",
    password: "sandi-gowa",
    deviceId: "",
    jedaDetik: 1,
  });
});
afterAll(async () => {
  noken.close();
  gowa.close();
  await t.drop();
});

describe("perhitungan", () => {
  it("potongan nominal/persen tidak pernah melebihi tarif", () => {
    expect(hitungPotongan(100_000, { jenis: "persen", nilai: 25 })).toBe(25_000);
    expect(hitungPotongan(100_000, { jenis: "nominal", nilai: 150_000 })).toBe(100_000);
    expect(hitungPotongan(100_000, null)).toBe(0);
    expect(isiTemplate("Hai {{nama_santri}} {{x}}", { nama_santri: "A" })).toBe("Hai A {{x}}");
  });
});

describe("pengaturan rahasia", () => {
  it("password GOWA & kunci noken-pay tidak pernah dikirim balik", async () => {
    const wa = await t.req("GET", "/api/pengaturan/wa", { cookie: admin });
    expect(wa.body.password).toEqual({ terisi: true });
    const pb = await t.req("GET", "/api/pengaturan/pembayaran", { cookie: admin });
    expect(pb.body.apiKey).toEqual({ terisi: true });
    expect(JSON.stringify(pb.body)).not.toContain("kunci-api");
    expect(JSON.stringify(wa.body)).not.toContain("sandi-gowa");
    const bend = await t.req("GET", "/api/pengaturan/wa", { cookie: bendahara });
    expect(bend.status).toBe(403);
  });
});

describe("pembuatan tagihan", () => {
  it("tarif − potongan, idempoten, bulan yang tidak ditagih ditolak", async () => {
    await put(
      "/api/keuangan/tarif",
      { unitId: id.unit, lokasiId: id.lokasi, nominal: 150_000 },
      bendahara,
    );
    await put(
      "/api/keuangan/potongan",
      { santriId: id.s2, jenis: "persen", nilai: 50, alasan: "Yatim" },
      bendahara,
    );
    const pra = await t.req("GET", "/api/keuangan/tagihan/pratinjau?periode=2026-11", {
      cookie: bendahara,
    });
    expect(
      pra.body.items.map((i: { status: string; total: number }) => [i.status, i.total]),
    ).toEqual([
      ["baru", 150_000],
      ["baru", 75_000],
    ]);
    expect(await t.db.select().from(tagihan)).toHaveLength(0); // pratinjau tidak menyimpan
    expect(
      (await post("/api/keuangan/tagihan/buat", { periode: "2026-11" }, bendahara)).dibuat,
    ).toBe(2);
    expect(
      (await post("/api/keuangan/tagihan/buat", { periode: "2026-11" }, bendahara)).dibuat,
    ).toBe(0);
    await post("/api/keuangan/tagihan/buat", { periode: "2026-12" }, bendahara);

    await put("/api/pengaturan/keuangan", {
      bulanDitagih: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
      tanggalJatuhTempo: 10,
      templateBukti: "Lunas {{nama_santri}} {{bulan}} {{jumlah}} {{metode}}",
    });
    const juli = await t.req("POST", "/api/keuangan/tagihan/buat", {
      cookie: bendahara,
      body: { periode: "2026-07" },
    });
    expect(juli.status).toBe(400);
    const list = await t.req("GET", "/api/keuangan/tagihan?periode=2026-11", { cookie: bendahara });
    expect(list.body).toHaveLength(2);
    expect(list.body[0].jatuhTempo).toBe("2026-11-10");
  });

  it("job harian hanya membuat tagihan pada tanggal 1 (zona waktu sekolah)", async () => {
    // 31 Juli 23.00 WIT → belum tanggal 1; 1 Agustus 09.00 WIT → dibuat.
    expect(await tagihanHarian(t.db, new Date("2026-07-31T14:00:00Z"))).toBeNull();
    const hasil = await tagihanHarian(t.db, new Date("2026-08-01T00:00:00Z"));
    expect(hasil?.periode).toBe("2026-08");
    expect(hasil?.dibuat).toBe(2);
    expect((await tagihanHarian(t.db, new Date("2026-08-01T00:00:00Z")))?.dibuat).toBe(0);
  });

  it("wali dan guru tidak bisa membuka daftar tagihan bendahara", async () => {
    expect((await t.req("GET", "/api/keuangan/tagihan", { cookie: wali })).status).toBe(403);
    expect(
      (
        await t.req("POST", "/api/keuangan/tagihan/buat", {
          cookie: wali,
          body: { periode: "2026-11" },
        })
      ).status,
    ).toBe(403);
  });
});

describe("pembayaran manual & bukti WA", () => {
  it("catat tunai → lunas; tidak bisa dobel; kirim bukti ke semua nomor WA wali", async () => {
    const [s2Nov] = await t.db
      .select()
      .from(tagihan)
      .where(sql`${tagihan.santriId} = ${id.s2} and ${tagihan.periode} = '2026-11'`);
    const [s1Des] = await t.db
      .select()
      .from(tagihan)
      .where(sql`${tagihan.santriId} = ${id.s1} and ${tagihan.periode} = '2026-12'`);
    if (!s2Nov || !s1Des) throw new Error("tagihan tidak ada");
    const r = await post(`/api/keuangan/tagihan/${s1Des.id}/bayar`, { metode: "tunai" }, bendahara);
    const again = await t.req("POST", `/api/keuangan/tagihan/${s1Des.id}/bayar`, {
      cookie: bendahara,
      body: { metode: "tunai" },
    });
    expect(again.status).toBe(409);
    // Bukti tidak dikirim otomatis untuk pembayaran manual.
    expect(await t.db.select().from(waOutbox)).toHaveLength(0);
    const kirim = await post(
      `/api/keuangan/pembayaran/${r.pembayaranId}/kirim-bukti`,
      {},
      bendahara,
    );
    expect(kirim.pesan).toBe(2);
    const out = await t.db.select().from(waOutbox);
    expect(out.map((o) => o.nomor).sort()).toEqual(["6282100000200", "6282100000201"]);
    expect(out[0]?.pesan).toBe("Lunas Ahmad Desember 2026 Rp 150.000 Tunai");
    expect(t.jobs.filter((j) => j.name === "wa.send")).toHaveLength(2);

    // s2 tidak punya wali → tidak ada nomor tujuan.
    const r2 = await post(
      `/api/keuangan/tagihan/${s2Nov.id}/bayar`,
      { metode: "transfer" },
      bendahara,
    );
    const k2 = await t.req("POST", `/api/keuangan/pembayaran/${r2.pembayaranId}/kirim-bukti`, {
      cookie: bendahara,
      body: {},
    });
    expect(k2.status).toBe(409);
    const [pb2] = await t.db.select().from(pembayaran).where(eq(pembayaran.id, r2.pembayaranId));
    expect(pb2?.buktiWaDikirimAt).toBeNull();
    expect(kirim.waAktif).toBe(true);
  });

  it("batal butuh alasan dan tercatat di audit", async () => {
    await post("/api/keuangan/tagihan/buat", { periode: "2027-01" }, bendahara);
    const [tg] = await t.db
      .select()
      .from(tagihan)
      .where(sql`${tagihan.santriId} = ${id.s2} and ${tagihan.periode} = '2027-01'`);
    if (!tg) throw new Error("tagihan tidak ada");
    const no = await t.req("POST", `/api/keuangan/tagihan/${tg.id}/batal`, {
      cookie: bendahara,
      body: { alasan: "" },
    });
    expect(no.status).toBe(400);
    await post(`/api/keuangan/tagihan/${tg.id}/batal`, { alasan: "Santri pindah" }, bendahara);
    const [after] = await t.db.select().from(tagihan).where(eq(tagihan.id, tg.id));
    expect(after?.status).toBe("batal");
    const audit = await t.db.execute(sql`select 1 from audit_log where aksi = 'tagihan.batal'`);
    expect(audit.rows).toHaveLength(1);
  });
});

describe("pembayaran QRIS noken-pay", () => {
  let novS1: string;
  let janS1: string;
  let intentId: string;

  it("wali hanya bisa membayar tagihan anaknya; intent + QRIS dibuat", async () => {
    const anak = await t.req("GET", "/api/keuangan/anak", { cookie: wali });
    expect(anak.body.online).toBe(true);
    expect(anak.body.anak).toHaveLength(1);
    const tg = anak.body.anak[0].tagihan as { id: string; periode: string; status: string }[];
    novS1 = tg.find((x) => x.periode === "2026-11")?.id as string;
    janS1 = tg.find((x) => x.periode === "2027-01")?.id as string;
    const [s2Nov] = await t.db
      .select()
      .from(tagihan)
      .where(sql`${tagihan.santriId} = ${id.s2} and ${tagihan.periode} = '2026-11'`);
    const bukan = await t.req("POST", "/api/keuangan/bayar", {
      cookie: wali,
      body: { tagihanIds: [s2Nov?.id] },
    });
    expect(bukan.status).toBe(404);

    const intent = await post("/api/keuangan/bayar", { tagihanIds: [novS1, janS1] }, wali);
    intentId = intent.id;
    expect(intent).toMatchObject({ status: "menunggu", total: 300_000, jumlahBayar: 300_003 });
    expect(intent.qris).toContain("QRIS");
    expect(intent.bulan).toEqual(["November 2026", "Januari 2027"]);
    // Pilihan yang sama → QRIS lama ditampilkan lagi; tumpang tindih → ditolak.
    expect((await post("/api/keuangan/bayar", { tagihanIds: [janS1, novS1] }, wali)).id).toBe(
      intentId,
    );
    const tumpang = await t.req("POST", "/api/keuangan/bayar", {
      cookie: wali,
      body: { tagihanIds: [novS1] },
    });
    expect(tumpang.status).toBe(409);
    // Tagihan yang menunggu QRIS tidak bisa dibatalkan bendahara.
    const batal = await t.req("POST", `/api/keuangan/tagihan/${novS1}/batal`, {
      cookie: bendahara,
      body: { alasan: "coba batal" },
    });
    expect(batal.status).toBe(409);
  });

  it("tanda tangan salah / kedaluwarsa ditolak", async () => {
    const p = payments.get("pay_1") as Pay;
    const paid = { ...p, status: "paid" as const, paid_at: new Date().toISOString() };
    expect((await webhook(paid, { secret: "salah" })).status).toBe(401);
    expect((await webhook(paid, { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    const [tg] = await t.db.select().from(tagihan).where(eq(tagihan.id, novS1));
    expect(tg?.status).toBe("belum");
  });

  it("webhook lunas diproses sekali walau datang dua kali; bukti WA + push", async () => {
    await t.db.delete(waOutbox);
    t.jobs.length = 0;
    const p = payments.get("pay_1") as Pay;
    const paid = { ...p, status: "paid" as const, paid_at: new Date().toISOString() };
    const r1 = await webhook(paid);
    expect(r1.status).toBe(200);
    expect(r1.body.hasil).toBe("lunas");
    const r2 = await webhook(paid);
    expect(r2.body.duplikat).toBe(true);

    const pb = await t.db.select().from(pembayaran).where(eq(pembayaran.metode, "gateway"));
    expect(pb).toHaveLength(2);
    const tg = await t.db.select().from(tagihan).where(sql`${tagihan.id} in (${novS1}, ${janS1})`);
    expect(tg.every((x) => x.status === "lunas")).toBe(true);
    const out = await t.db.select().from(waOutbox);
    expect(out).toHaveLength(2); // satu pesan gabungan ke 2 nomor wali
    expect(out[0]?.pesan).toContain("November 2026, Januari 2027");
    expect(out[0]?.pesan).toContain("Rp 300.000");
    const notif = await t.db.select().from(notifikasi).where(eq(notifikasi.userId, id.wali));
    expect(notif.some((n) => n.judul === "Pembayaran diterima")).toBe(true);
    const view = await t.req("GET", `/api/keuangan/intent/${intentId}`, { cookie: wali });
    expect(view.body.status).toBe("lunas");
    expect(view.body.qris).toBeNull();
    // Wali lain / bendahara tidak bisa membuka intent orang lain lewat endpoint wali.
    expect(
      (await t.req("GET", `/api/keuangan/intent/${intentId}`, { cookie: bendahara })).status,
    ).toBe(404);
  });

  it("jumlah tidak cocok → tidak lunas, bendahara diberi tahu", async () => {
    await post("/api/keuangan/tagihan/buat", { periode: "2027-02" }, bendahara);
    const [feb] = await t.db
      .select()
      .from(tagihan)
      .where(sql`${tagihan.santriId} = ${id.s1} and ${tagihan.periode} = '2027-02'`);
    const intent = await post("/api/keuangan/bayar", { tagihanIds: [feb?.id] }, wali);
    const p = payments.get("pay_2") as Pay;
    expect(p.external_id).toBe(intent.id);
    const r = await webhook({
      ...p,
      status: "paid",
      base_amount: 1000,
      paid_at: new Date().toISOString(),
    });
    expect(r.body.hasil).toBe("selisih");
    const [tg] = await t.db
      .select()
      .from(tagihan)
      .where(eq(tagihan.id, feb?.id as string));
    expect(tg?.status).toBe("belum");
    const [bend] = await t.db
      .execute<{ id: string }>(sql`select u.id from users u where u.nama = 'Bendahara'`)
      .then((x) => x.rows);
    const notif = await t.db
      .select()
      .from(notifikasi)
      .where(eq(notifikasi.userId, bend?.id as string));
    expect(notif.some((n) => n.judul === "Pembayaran QRIS tidak cocok")).toBe(true);
  });

  it("rekonsiliasi menandai lunas bila webhook hilang", async () => {
    await post("/api/keuangan/tagihan/buat", { periode: "2027-03" }, bendahara);
    const [mar] = await t.db
      .select()
      .from(tagihan)
      .where(sql`${tagihan.santriId} = ${id.s1} and ${tagihan.periode} = '2027-03'`);
    await post("/api/keuangan/bayar", { tagihanIds: [mar?.id] }, wali);
    const p = payments.get("pay_3") as Pay;
    p.status = "paid";
    p.paid_at = new Date().toISOString();
    await rekonsiliasi({
      db: t.db,
      pool: t.pool,
      boss: t.boss,
      config: { encryptionKey: KEY, appUrl: "https://app.contoh.sch.id" },
    });
    const [tg] = await t.db
      .select()
      .from(tagihan)
      .where(eq(tagihan.id, mar?.id as string));
    expect(tg?.status).toBe("lunas");
  });

  const tagihanS1 = async (periode: string) => {
    await post("/api/keuangan/tagihan/buat", { periode }, bendahara);
    const [x] = await t.db
      .select()
      .from(tagihan)
      .where(sql`${tagihan.santriId} = ${id.s1} and ${tagihan.periode} = ${periode}`);
    return x?.id as string;
  };
  const paidNow = (p: Pay) => ({
    ...p,
    status: "paid" as const,
    paid_at: new Date().toISOString(),
  });

  it("nominal QRIS atau external_id beda → selisih; Perlu dicek bisa ditandai", async () => {
    const apr = await tagihanS1("2027-04");
    const i1 = await post("/api/keuangan/bayar", { tagihanIds: [apr] }, wali);
    const p4 = payments.get("pay_4") as Pay;
    // Nominal dasar sama, tetapi yang dibayar kurang dari nominal unik yang ditampilkan.
    const r1 = await webhook({ ...paidNow(p4), charged_amount: p4.charged_amount - 3 });
    expect(r1.body.hasil).toBe("selisih");

    const mei = await tagihanS1("2027-05");
    const i2 = await post("/api/keuangan/bayar", { tagihanIds: [mei] }, wali);
    const p5 = payments.get("pay_5") as Pay;
    expect((await webhook({ ...paidNow(p5), external_id: "intent-lain" })).body.hasil).toBe(
      "selisih",
    );
    const st = await t.db.select().from(tagihan).where(sql`${tagihan.id} in (${apr}, ${mei})`);
    expect(st.every((x) => x.status === "belum")).toBe(true);

    const list = await t.req("GET", "/api/keuangan/perlu-dicek", { cookie: bendahara });
    const ids = list.body.map((m: { id: string }) => m.id);
    expect(ids).toEqual(expect.arrayContaining([i1.id, i2.id]));
    const tanpaCatatan = await t.req("POST", `/api/keuangan/perlu-dicek/${i1.id}/selesai`, {
      cookie: bendahara,
      body: { catatan: "" },
    });
    expect(tanpaCatatan.status).toBe(400);
    await post(
      `/api/keuangan/perlu-dicek/${i1.id}/selesai`,
      { catatan: "Kurang Rp 3, sudah ditagih" },
      bendahara,
    );
    const after = await t.req("GET", "/api/keuangan/perlu-dicek", { cookie: bendahara });
    expect(after.body.map((m: { id: string }) => m.id)).not.toContain(i1.id);
    expect((await t.req("GET", "/api/keuangan/perlu-dicek", { cookie: wali })).status).toBe(403);
  });

  it("dicatat tunai saat QRIS menunggu → ditandai, lalu QRIS lunas tercatat sebagai bayar ganda", async () => {
    const jun = await tagihanS1("2027-06");
    const i = await post("/api/keuangan/bayar", { tagihanIds: [jun] }, wali);
    const list = await t.req("GET", "/api/keuangan/tagihan?periode=2027-06", { cookie: bendahara });
    const row = list.body.find((r: { id: string }) => r.id === jun);
    expect(row.menungguQris).toBe(true);
    await post(`/api/keuangan/tagihan/${jun}/bayar`, { metode: "tunai" }, bendahara);
    const r = await webhook(paidNow(payments.get("pay_6") as Pay));
    expect(r.body.hasil).toBe("lunas");
    const pb = await t.db.select().from(pembayaran).where(eq(pembayaran.tagihanId, jun));
    expect(pb).toHaveLength(1); // tetap satu pembayaran (tunai)
    const cek = await t.req("GET", "/api/keuangan/perlu-dicek", { cookie: bendahara });
    expect(cek.body.find((m: { id: string }) => m.id === i.id)?.jenis).toBe("ganda");
  });

  it("QRIS yang lewat batas waktu tidak ditampilkan lagi", async () => {
    const okt = await tagihanS1("2026-10");
    const i = await post("/api/keuangan/bayar", { tagihanIds: [okt] }, wali);
    await t.db.execute(
      sql`update payment_intent set kedaluwarsa_at = now() - interval '1 minute' where id = ${i.id}`,
    );
    const v = await t.req("GET", `/api/keuangan/intent/${i.id}`, { cookie: wali });
    expect(v.body).toMatchObject({ status: "kedaluwarsa", qris: null });
  });
});

describe("laporan & ekspor", () => {
  it("laporan penerimaan per metode; rentang tanggal divalidasi", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const lalu = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const besok = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const lap = await t.req("GET", `/api/keuangan/laporan?dari=${lalu}&sampai=${besok}`, {
      cookie: bendahara,
    });
    expect(lap.status).toBe(200);
    const m = Object.fromEntries(
      lap.body.perMetode.map((x: { metode: string; n: number }) => [x.metode, x.n]),
    );
    expect(m.tunai).toBe(2);
    expect(m.transfer).toBe(1);
    expect(m.gateway).toBeGreaterThanOrEqual(3);
    expect(lap.body.pembayaran.some((p: { santriNama: string }) => p.santriNama === "Ahmad")).toBe(
      true,
    );
    const terbalik = await t.req("GET", `/api/keuangan/laporan?dari=${today}&sampai=${lalu}`, {
      cookie: bendahara,
    });
    expect(terbalik.status).toBe(400);
    const panjang = await t.req("GET", "/api/keuangan/laporan?dari=2025-01-01&sampai=2026-12-31", {
      cookie: bendahara,
    });
    expect(panjang.status).toBe(400);
  });

  it("ekspor CSV sesuai filter, tanpa data pribadi di URL", async () => {
    const res = await t.app.request(
      "/api/keuangan/ekspor.csv?periode=2026-11",
      { headers: { cookie: bendahara } },
      { incoming: { socket: { remoteAddress: "10.0.0.1" } } },
    );
    expect(res.headers.get("content-type")).toContain("text/csv");
    const buf = Buffer.from(await res.arrayBuffer());
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM agar Excel membaca UTF-8
    const lines = buf.toString("utf8").slice(1).trim().split("\n");
    expect(lines[0]?.startsWith("NIS,Nama")).toBe(true);
    expect(lines).toHaveLength(3); // header + Ahmad + Fatimah
    expect(lines.some((l) => l.startsWith("K2,Fatimah") && l.includes(",lunas,Transfer,"))).toBe(
      true,
    );
  });
});

function fakeBoss() {
  return { insert: async () => {} } as never;
}

describe("WA via GOWA (server tiruan)", () => {
  async function antri(nomor: string) {
    const [outId] = await transactionWithClient(t.pool, (tx, client) =>
      queueWa(tx, client, fakeBoss(), [
        { nomor, pesan: "Tes", rujukanTipe: "pembayaran", rujukanId: "x" },
      ]),
    );
    return outId as string;
  }
  const deps = () => ({ db: t.db, encryptionKey: KEY, sleep: async () => {} });

  it("mengirim ke /send/message dengan basic auth dan format nomor JID", async () => {
    gowaReq.length = 0;
    const outId = await antri("6282100000300");
    expect(await processWaJob(deps(), outId)).toBe("terkirim");
    expect(gowaReq[0]?.body).toEqual({ phone: "6282100000300@s.whatsapp.net", message: "Tes" });
    expect(gowaReq[0]?.auth).toBe(`Basic ${Buffer.from("gowa:sandi-gowa").toString("base64")}`);
    const [row] = await t.db.select().from(waOutbox).where(eq(waOutbox.id, outId));
    expect(row?.status).toBe("terkirim");
  });

  it("gagal → dicoba ulang; setelah 4 percobaan berstatus gagal & bisa dikirim ulang", async () => {
    gowaFail = true;
    const outId = await antri("6282100000301");
    for (let i = 0; i < 3; i++)
      await expect(processWaJob(deps(), outId)).rejects.toThrow(/GOWA 500/);
    expect(await processWaJob(deps(), outId)).toBe("gagal");
    gowaFail = false;
    const r = await t.req("POST", `/api/keuangan/wa/${outId}/kirim-ulang`, {
      cookie: bendahara,
      body: {},
    });
    expect(r.status).toBe(200);
    expect(await processWaJob(deps(), outId)).toBe("terkirim");
  });

  it("kode OTP disamarkan setelah pesan diproses dan tidak bisa dikirim ulang", async () => {
    const [outId] = await transactionWithClient(t.pool, (tx, client) =>
      queueWa(tx, client, fakeBoss(), [
        {
          nomor: "6282100000303",
          pesan: "Kode: 123456\nBerlaku 5 menit",
          rujukanTipe: "otp",
          rujukanId: "x",
        },
      ]),
    );
    expect(await processWaJob(deps(), outId as string)).toBe("terkirim");
    expect(gowaReq.at(-1)?.body.message).toContain("123456");
    const [row] = await t.db
      .select()
      .from(waOutbox)
      .where(eq(waOutbox.id, outId as string));
    expect(row?.pesan).toBe("Kode: ******\nBerlaku 5 menit");
    const r = await t.req("POST", `/api/keuangan/wa/${outId}/kirim-ulang`, {
      cookie: bendahara,
      body: {},
    });
    expect(r.status).toBe(404);
  });

  it("WA nonaktif → dilewati", async () => {
    const outId = await antri("6282100000302");
    await t.db.execute(
      sql`update settings set value = jsonb_set(value, '{aktif}', 'false') where key = 'wa'`,
    );
    expect(await processWaJob(deps(), outId)).toBe("dilewati");
    await t.db.execute(
      sql`update settings set value = jsonb_set(value, '{aktif}', 'true') where key = 'wa'`,
    );
  });
});

describe("lupa password via OTP WA", () => {
  const minta = (nomor: string, ip = "10.0.0.9") =>
    t.req("POST", "/api/auth/otp/minta", { ip, body: { nomor, turnstileToken: "turnstile-ok" } });
  const kodeTerakhir = async () => {
    const [row] = await t.db
      .select()
      .from(waOutbox)
      .where(eq(waOutbox.rujukanTipe, "otp"))
      .orderBy(sql`${waOutbox.dibuatAt} desc`)
      .limit(1);
    return row?.pesan.match(/\d{6}/)?.[0] as string;
  };
  const reset = (kode: string, passwordBaru = "passwordBaru1") =>
    t.req("POST", "/api/auth/otp/reset", { body: { nomor: "082100000200", kode, passwordBaru } });

  it("nomor tak terdaftar dijawab sama, tanpa kode", async () => {
    const r = await minta("6289999999999");
    expect(r.status).toBe(200);
    expect(await t.db.select().from(otpCodes)).toHaveLength(0);
  });

  it("kode disimpan ter-hash, maks 5 percobaan", async () => {
    expect((await minta("6282100000200")).status).toBe(200);
    const kode = await kodeTerakhir();
    const [otp] = await t.db.select().from(otpCodes);
    expect(otp?.kodeHash).not.toContain(kode);
    const salah = kode === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await reset(salah)).status).toBe(400);
    expect((await reset(kode)).status).toBe(429);
  });

  it("kode kedaluwarsa ditolak; kode benar mengganti password & mengeluarkan sesi", async () => {
    await minta("6282100000200");
    const lama = await kodeTerakhir();
    await t.db.execute(sql`update otp_codes set kedaluwarsa = now() - interval '1 minute'`);
    expect((await reset(lama)).status).toBe(400);
    await minta("6282100000200");
    const kode = await kodeTerakhir();
    // Nomor terkunci karena salah password berkali-kali; reset OTP membuka kuncinya.
    for (let i = 0; i < 5; i++) await t.login("6282100000200", "salah-salah");
    expect((await t.login("6282100000200", "passwordBaru1")).status).toBe(429);
    expect((await reset(kode)).status).toBe(200);
    expect((await reset(kode)).status).toBe(400); // sekali pakai
    expect((await t.req("GET", "/api/me", { cookie: wali })).status).toBe(401);
    expect((await t.login("6282100000200", "passwordBaru1")).status).toBe(200);
  });

  it("maks 10 permintaan per jam per IP", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await minta(`62899000000${String(i).padStart(2, "0")}`, "10.0.0.50")).status).toBe(
        200,
      );
    }
    expect((await minta("6289900000099", "10.0.0.50")).status).toBe(429);
  });

  it("maks 3 permintaan per jam per nomor", async () => {
    const r = await minta("6282100000200", "10.0.0.10");
    expect(r.status).toBe(429);
  });
});
