import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { backupFile, berkas, lokasi } from "../src/server/db/schema";
import { pemeliharaan } from "../src/server/lib/pemeliharaan";
import { createStorage } from "../src/server/lib/storage";
import {
  type BackupDeps,
  dumpKey,
  eksklusif,
  jalankanBackup,
  pgRestore,
  sinkronBerkas,
} from "../src/server/services/backup";
import { ambilDariB2, cekRestore, pulihkan } from "../src/server/services/restore";
import { createTestContext, ORIGIN, type TestContext } from "./helpers/app";
import { createMemoryB2 } from "./helpers/b2";
import { createTestDb } from "./helpers/db";

// pg_dump/pg_restore 17 wajib ada (CI memasangnya; image produksi juga). Tanpa itu tes dilewati.
const adaPgDump = spawnSync("pg_dump", ["--version"]).status === 0;
const KEY = Buffer.alloc(32, 9).toString("base64");

const b2 = createMemoryB2();
let t: TestContext;
let admin: string;
let guru: string;
let deps: BackupDeps;

const PENGATURAN_B2 = {
  intervalHari: 7,
  simpanDiServer: 10,
  b2Aktif: true,
  endpoint: "https://s3.us-east-005.backblazeb2.com",
  region: "us-east-005",
  bucket: "tarbiyah-backup",
  keyId: "kunci-id",
  appKey: "kunci-rahasia",
};

async function tungguSelesai() {
  for (let i = 0; i < 300 && (pemeliharaan.aktif() || (await status()).sibuk); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
}
const status = async () => (await t.req("GET", "/api/backup/status")).body;

// Di CI tes ini wajib jalan: pg_dump yang hilang harus membuat CI merah, bukan dilewati.
describe.skipIf(!adaPgDump && !process.env.CI)("backup & restore", () => {
  beforeAll(async () => {
    t = await createTestContext({ b2 });
    await t.makeUser({ nama: "Admin", nomor: "6282300000001", roleNama: ["Admin"] });
    await t.makeUser({ nama: "Guru", nomor: "6282300000002", roleNama: ["Kepala Sekolah"] });
    admin = (await t.login("6282300000001", "rahasia123")).cookie;
    guru = (await t.login("6282300000002", "rahasia123")).cookie;
    deps = {
      db: t.db,
      pool: t.pool,
      boss: t.boss,
      storage: t.storage,
      databaseUrl: t.url,
      encryptionKey: KEY,
      version: "v-tes",
      makeB2: () => b2,
    };
    await t.db.insert(lokasi).values({ nama: "KOTA" });
    // Satu berkas privat di disk, tercatat di tabel berkas.
    const { key, size } = await t.storage.put(
      t.storage.randomKey("files", "txt"),
      Buffer.from("lampiran"),
    );
    await t.db
      .insert(berkas)
      .values({ namaAsli: "a.txt", path: key, ukuran: size, tipe: "text/plain" });
  });
  afterAll(() => t?.drop());

  it("hanya admin; secret B2 tidak dikirim balik; tes koneksi tulis-baca-daftar", async () => {
    expect((await t.req("GET", "/api/backup", { cookie: guru })).status).toBe(403);
    expect((await t.req("POST", "/api/backup", { cookie: guru, body: {} })).status).toBe(403);
    const put = await t.req("PUT", "/api/backup/pengaturan", {
      cookie: admin,
      body: PENGATURAN_B2,
    });
    expect(put.status).toBe(200);
    expect(put.body.appKey).toEqual({ terisi: true });
    expect(JSON.stringify(put.body)).not.toContain("kunci-rahasia");
    const tes = await t.req("POST", "/api/backup/tes-b2", { cookie: admin, body: {} });
    expect(tes.body.ok).toBe(true);
    expect(b2.objects.has("tarbiyah/tes-koneksi.txt")).toBe(true);
  });

  it("pg_dump → disk + manifest → B2; dump lama dihapus dari disk saja", async () => {
    const a = await eksklusif(() => jalankanBackup(deps, { jenis: "manual" }));
    expect(a.status).toBe("berhasil");
    expect(await t.storage.exists(dumpKey(a.nama))).toBe(true);
    expect(b2.objects.has(`tarbiyah/db/${a.nama}.dump`)).toBe(true);
    const manifest = JSON.parse(String(b2.objects.get(`tarbiyah/db/${a.nama}.json`)));
    expect(manifest).toMatchObject({ nama: a.nama, versiAplikasi: "v-tes" });
    expect(manifest.versiSkema).toBeGreaterThan(5);

    await t.req("PUT", "/api/backup/pengaturan", {
      cookie: admin,
      body: { ...PENGATURAN_B2, simpanDiServer: 1, appKey: "" },
    });
    const b = await eksklusif(() => jalankanBackup(deps, { jenis: "manual" }));
    expect(await t.storage.exists(dumpKey(a.nama))).toBe(false);
    expect(await t.storage.exists(dumpKey(b.nama))).toBe(true);
    expect(b2.objects.has(`tarbiyah/db/${a.nama}.dump`)).toBe(true); // B2 tidak pernah dihapus
    const [rowA] = await t.db.select().from(backupFile).where(eq(backupFile.id, a.id));
    expect(rowA?.adaDiServer).toBe(false);
    await t.req("PUT", "/api/backup/pengaturan", {
      cookie: admin,
      body: { ...PENGATURAN_B2, appKey: "" },
    });

    const unduh = await t.app.request(`/api/backup/${b.id}/unduh`, {
      headers: { cookie: admin },
    });
    expect(unduh.status).toBe(200);
    expect(unduh.headers.get("content-disposition")).toContain(`${b.nama}.dump`);
    expect(
      (await t.app.request(`/api/backup/${b.id}/unduh`, { headers: { cookie: guru } })).status,
    ).toBe(403);
  });

  it("berkas disalin ke B2 sekali saja", async () => {
    const r1 = await sinkronBerkas(deps);
    expect(r1).toEqual({ disalin: 1, gagal: 0 });
    const [f] = await t.db.select().from(berkas);
    expect(f?.dibackupAt).not.toBeNull();
    expect(String(b2.objects.get(`tarbiyah/${f?.path}`))).toBe("lampiran");
    expect(await sinkronBerkas(deps)).toEqual({ disalin: 0, gagal: 0 });
  });

  it("dump dari skema lebih baru ditolak; berkas bukan dump ditolak", async () => {
    await t.db.execute(
      sql`insert into drizzle.__drizzle_migrations (hash, created_at) values ('masa-depan', 99999999999999)`,
    );
    const baru = await eksklusif(() => jalankanBackup(deps, { jenis: "manual" }));
    await t.db.execute(sql`delete from drizzle.__drizzle_migrations where hash = 'masa-depan'`);
    const cek = await cekRestore(deps, baru.id);
    expect(cek.boleh).toBe(false);
    expect(cek.pesan).toContain("lebih baru");

    const res = await t.app.request("/api/backup/unggah", {
      method: "POST",
      headers: { cookie: admin, origin: ORIGIN, "content-type": "application/octet-stream" },
      body: Buffer.from("bukan dump"),
    });
    expect(res.status).toBe(400);
  });

  it("restore: konfirmasi nama lembaga, backup pra-restore, data kembali, pemeliharaan menolak permintaan", async () => {
    const titik = await eksklusif(() => jalankanBackup(deps, { jenis: "manual" }));
    await t.db.insert(lokasi).values({ nama: "RAHE" }); // perubahan sesudah backup

    const salah = await t.req("POST", `/api/backup/${titik.id}/pulihkan`, {
      cookie: admin,
      body: { konfirmasi: "bukan nama" },
    });
    expect(salah.status).toBe(400);
    const ok = await t.req("POST", `/api/backup/${titik.id}/pulihkan`, {
      cookie: admin,
      body: { konfirmasi: "TARBIYAH" },
    });
    expect(ok.status).toBe(202);
    await tungguSelesai();
    const st = await status();
    expect(st.gagal).toBe(false);
    expect(st.pesan).toContain(titik.nama);

    const lok = await t.db.select().from(lokasi);
    expect(lok.map((l) => l.nama)).toEqual(["KOTA"]);
    const jenis = (await t.db.select().from(backupFile)).map((r) => r.jenis);
    expect(jenis).toContain("pra_restore"); // daftar disamakan dengan disk setelah restore
    // Sesi admin ikut dari backup, jadi masih bisa dipakai.
    expect((await t.req("GET", "/api/backup", { cookie: admin })).status).toBe(200);

    pemeliharaan.mulai("tes");
    const tolak = await t.req("GET", "/api/lokasi", { cookie: admin });
    expect(tolak.status).toBe(503);
    expect((await t.req("GET", "/api/backup/status")).status).toBe(200);
    pemeliharaan.selesai(false, "tes");
  });

  it("restore dump tertua tetap bisa walau server hanya menyimpan 1 dump", async () => {
    await t.req("PUT", "/api/backup/pengaturan", {
      cookie: admin,
      body: { ...PENGATURAN_B2, simpanDiServer: 1, appKey: "" },
    });
    const x = await eksklusif(() => jalankanBackup(deps, { jenis: "manual" }));
    const urutan: string[] = [];
    await pulihkan(
      {
        ...deps,
        jobs: {
          jeda: async () => void urutan.push(`jeda:${pemeliharaan.aktif()}`),
          lanjut: async () => void urutan.push(`lanjut:${pemeliharaan.aktif()}`),
        },
      },
      x.id,
    );
    expect(pemeliharaan.status().gagal).toBe(false);
    // Worker dijeda sebelum mode pemeliharaan dan dilanjutkan sesudahnya.
    expect(urutan).toEqual(["jeda:false", "lanjut:false"]);
    await t.req("PUT", "/api/backup/pengaturan", {
      cookie: admin,
      body: { ...PENGATURAN_B2, appKey: "" },
    });
  });

  it("pg_restore gagal → kondisi sebelumnya kembali; rincian error hanya untuk admin", async () => {
    const x = await eksklusif(() => jalankanBackup(deps, { jenis: "manual" }));
    await t.db.insert(lokasi).values({ nama: "SESUDAH" });
    let panggil = 0;
    await expect(
      pulihkan(
        {
          ...deps,
          restoreDump: async (storage, key, url) => {
            if (panggil++ === 0) throw new Error("pg_restore gagal: rahasia-internal db=x");
            return pgRestore(storage, key, url);
          },
        },
        x.id,
      ),
    ).rejects.toThrow(/rahasia-internal/);
    const lok = (await t.db.select().from(lokasi)).map((l) => l.nama);
    expect(lok).toContain("SESUDAH"); // data terbaru kembali dari backup pra-restore
    const publik = await t.req("GET", "/api/backup/status");
    expect(publik.body).toMatchObject({ aktif: false, gagal: true, detail: null });
    expect(JSON.stringify(publik.body)).not.toContain("rahasia-internal");
    const untukAdmin = await t.req("GET", "/api/backup/status", { cookie: admin });
    expect(untukAdmin.body.detail).toContain("rahasia-internal");
  });

  it("server baru: database & folder data kosong dipulihkan dari B2", async () => {
    const d2 = await createTestDb();
    const dir = mkdtempSync(join(tmpdir(), "tarbiyah-baru-"));
    const deps2: BackupDeps = {
      ...deps,
      db: d2.db,
      pool: d2.pool,
      storage: createStorage(dir),
      databaseUrl: d2.url,
    };
    try {
      // Di server baru admin cukup mengisi pengaturan B2 lalu mengambil dump dari B2.
      const { saveBackupSetting } = await import("../src/server/services/backup");
      await saveBackupSetting(d2.db, PENGATURAN_B2, KEY);
      const key = [...b2.objects.keys()]
        .filter((k) => /^tarbiyah\/db\/.*\.dump$/.test(k))
        .sort()
        .at(-1);
      const row = await ambilDariB2(deps2, key as string, null as unknown as string);
      await pulihkan(deps2, row.id);
      const lok = await d2.db.select().from(lokasi);
      expect(lok.map((l) => l.nama)).toContain("KOTA");
      const [f] = await d2.db.select().from(berkas);
      expect(await deps2.storage.exists(f?.path as string)).toBe(true); // diunduh dari B2
    } finally {
      await d2.drop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("restore dan pemulihan cadangan sama-sama gagal → aplikasi tetap terkunci", async () => {
    const x = await eksklusif(() => jalankanBackup(deps, { jenis: "manual" }));
    const urutan: string[] = [];
    await expect(
      pulihkan(
        {
          ...deps,
          jobs: {
            jeda: async () => void urutan.push("jeda"),
            lanjut: async () => void urutan.push("lanjut"),
          },
          restoreDump: async () => {
            throw new Error("rusak");
          },
        },
        x.id,
      ),
    ).rejects.toThrow("rusak");
    const st = pemeliharaan.status();
    expect(st).toMatchObject({ aktif: true, gagal: true });
    expect(st.pesan).toContain("Pulihkan manual");
    expect(urutan).toEqual(["jeda"]); // worker tidak dilanjutkan di database kosong
    expect((await t.req("GET", "/api/lokasi", { cookie: admin })).status).toBe(503);
    pemeliharaan.selesai(false, "reset tes");
  });
});
