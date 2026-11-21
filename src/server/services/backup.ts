import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { z } from "zod";
import type { PengaturanBackupView, pengaturanBackupSchema } from "../../shared/backup";
import { type Db, type Tx, transactionWithClient } from "../db/client";
import { backupFile, berkas } from "../db/schema";
import { QUEUES } from "../jobs/queues";
import { type B2, B2_PREFIX, type B2Config, createB2 } from "../lib/b2";
import { decryptSecret, type Encrypted, encryptSecret } from "../lib/crypto";
import { safeError } from "../lib/log";
import type { Storage } from "../lib/storage";
import { schoolNow } from "../lib/tanggal";
import { usersWithPermission } from "./keuangan";
import { readSetting, schoolTimeZone, writeSetting } from "./pengaturan";
import { notify } from "./push";

// ------------------------------------------------------------------ pengaturan

type Stored = {
  intervalHari: number;
  simpanDiServer: number;
  b2Aktif: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  keyId: string;
  appKey: Encrypted | null;
};
const DEFAULT: Stored = {
  intervalHari: 7,
  simpanDiServer: 10,
  b2Aktif: false,
  endpoint: "",
  region: "",
  bucket: "",
  keyId: "",
  appKey: null,
};

export const getBackupSetting = (db: Db | Tx) => readSetting(db, "backup", DEFAULT);

export async function getBackupView(db: Db): Promise<PengaturanBackupView> {
  const { appKey, ...rest } = await getBackupSetting(db);
  return { ...rest, appKey: { terisi: !!appKey } };
}

export async function saveBackupSetting(
  tx: Db | Tx,
  input: z.output<typeof pengaturanBackupSchema>,
  encryptionKey: string,
) {
  const before = await getBackupSetting(tx);
  const { appKey, ...rest } = input;
  await writeSetting(
    tx,
    "backup",
    { ...rest, appKey: appKey ? encryptSecret(appKey, encryptionKey) : before.appKey },
    true,
  );
}

/** Jeda/lanjutkan semua worker pg-boss (dipakai restore). */
export type KendaliJobs = { jeda(): Promise<void>; lanjut(): Promise<void> };

export type BackupDeps = {
  db: Db;
  pool: pg.Pool;
  boss: PgBoss;
  storage: Storage;
  databaseUrl: string;
  encryptionKey: string;
  version: string;
  makeB2?: (cfg: B2Config) => B2;
};

/** Klien B2 sesuai pengaturan, atau null bila B2 nonaktif/belum lengkap. */
export async function getB2(deps: Pick<BackupDeps, "db" | "encryptionKey" | "makeB2">) {
  const s = await getBackupSetting(deps.db);
  if (!s.b2Aktif || !s.endpoint || !s.bucket || !s.keyId || !s.appKey) return null;
  const cfg: B2Config = {
    endpoint: s.endpoint,
    region: s.region || "us-east-005",
    bucket: s.bucket,
    keyId: s.keyId,
    appKey: decryptSecret(s.appKey, deps.encryptionKey),
  };
  return (deps.makeB2 ?? createB2)(cfg);
}

/** Tulis, baca, dan daftar satu objek uji (tanpa hapus: kunci B2 memang tidak punya izin hapus). */
export async function tesKoneksiB2(deps: Pick<BackupDeps, "db" | "encryptionKey" | "makeB2">) {
  const s = await getBackupSetting(deps.db);
  const kurang = [
    !s.b2Aktif && "centang “Salin backup ke Backblaze B2”",
    !s.endpoint && "Endpoint S3",
    !s.bucket && "Bucket",
    !s.keyId && "Key ID",
    !s.appKey && "Application key",
  ].filter(Boolean);
  if (kurang.length)
    throw new Error(`Pengaturan B2 yang tersimpan belum lengkap: ${kurang.join(", ")}.`);
  const b2 = await getB2(deps);
  if (!b2) throw new Error("B2 belum aktif atau pengaturannya belum lengkap");
  const key = `${B2_PREFIX}tes-koneksi.txt`;
  const isi = `tes ${new Date().toISOString()}`;
  await b2.put(key, Buffer.from(isi), "text/plain");
  const chunks: Buffer[] = [];
  for await (const c of await b2.get(key)) chunks.push(Buffer.from(c));
  if (Buffer.concat(chunks).toString() !== isi) throw new Error("Isi objek uji tidak sama");
  const list = await b2.list(key);
  if (!list.some((o) => o.key === key)) throw new Error("Objek uji tidak muncul di daftar");
}

// ------------------------------------------------------------------ pg_dump / pg_restore

/** Jumlah migrasi milik aplikasi ini (drizzle/meta/_journal.json). */
export function versiSkemaAplikasi() {
  const j = JSON.parse(readFileSync(join("drizzle", "meta", "_journal.json"), "utf8")) as {
    entries: unknown[];
  };
  return j.entries.length;
}

/** Password lewat env PGPASSWORD, bukan argumen (argumen proses terlihat di `ps`). */
function koneksi(databaseUrl: string) {
  const u = new URL(databaseUrl);
  const password = decodeURIComponent(u.password);
  u.password = "";
  return { url: u.toString(), env: { ...process.env, PGPASSWORD: password } };
}

/** Jalankan klien Postgres; stdin/stdout di-stream, stderr dibatasi untuk pesan error. */
function jalankan(
  cmd: "pg_dump" | "pg_restore",
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; stdin?: Readable; stdout?: (out: Readable) => Promise<unknown> },
) {
  const child = spawn(cmd, args, {
    env: opts.env ?? process.env,
    stdio: [opts.stdin ? "pipe" : "ignore", "pipe", "pipe"],
  });
  const { stdout, stderr: err } = child;
  if (!stdout || !err) throw new Error(`${cmd}: stdio tidak tersedia`);
  let stderr = "";
  err.on("data", (d) => {
    if (stderr.length < 4000) stderr += String(d);
  });
  const selesai = new Promise<void>((resolve, reject) => {
    child.on("error", (e) => reject(new Error(`${cmd} tidak bisa dijalankan: ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} gagal (kode ${code}): ${stderr.trim()}`)),
    );
  });
  if (opts.stdin && child.stdin) {
    opts.stdin.on("error", () => child.kill());
    child.stdin.on("error", () => {}); // proses bisa berhenti lebih dulu; error dilaporkan lewat kode keluar
    opts.stdin.pipe(child.stdin);
  }
  const keluar = opts.stdout ? opts.stdout(stdout) : (stdout.resume(), Promise.resolve());
  return Promise.all([selesai, keluar]).then(() => undefined);
}

/** pg_dump format custom, streaming ke storage. Skema pgboss (antrean sementara) tidak ikut. */
async function dumpKe(storage: Storage, key: string, databaseUrl: string) {
  const { url, env } = koneksi(databaseUrl);
  let size = 0;
  await jalankan(
    "pg_dump",
    ["-Fc", "--no-owner", "--no-privileges", "--exclude-schema=pgboss", `--dbname=${url}`],
    { env, stdout: async (out) => (size = (await storage.put(key, out)).size) },
  );
  return size;
}

/** Versi skema di dalam dump = jumlah baris drizzle.__drizzle_migrations (null: bukan backup TARBIYAH). */
export async function versiSkemaDump(storage: Storage, key: string): Promise<number | null> {
  const { stream } = await storage.get(key);
  let teks = "";
  await jalankan("pg_restore", ["-f", "-", "-a", "-n", "drizzle", "-t", "__drizzle_migrations"], {
    stdin: stream,
    stdout: async (out) => {
      for await (const c of out) teks += String(c);
    },
  });
  const m = teks.match(/^COPY drizzle\.__drizzle_migrations[^\n]*\n([\s\S]*?)^\\\.$/m);
  if (!m) return null;
  return (m[1] ?? "").split("\n").filter((l) => l.trim()).length;
}

/** Pulihkan dump ke database dalam satu transaksi (gagal = tidak ada yang berubah oleh pg_restore). */
export async function pgRestore(storage: Storage, key: string, databaseUrl: string) {
  const { url, env } = koneksi(databaseUrl);
  const { stream } = await storage.get(key);
  await jalankan(
    "pg_restore",
    [
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      "--single-transaction",
      "--exit-on-error",
      `--dbname=${url}`,
    ],
    { env, stdin: stream },
  );
}

// ------------------------------------------------------------------ backup

let sibuk = false;
export const PESAN_SIBUK = "Backup atau restore lain sedang berjalan";
/** Backup dan restore tidak boleh berjalan bersamaan (satu container). */
export async function eksklusif<T>(fn: () => Promise<T>): Promise<T> {
  if (sibuk) throw new Error(PESAN_SIBUK);
  sibuk = true;
  try {
    return await fn();
  } finally {
    sibuk = false;
  }
}
export const sedangSibuk = () => sibuk;

export const dumpKey = (nama: string) => `backups/${nama}.dump`;
const manifestKey = (nama: string) => `backups/${nama}.json`;

async function namaBaru(db: Db) {
  const t = schoolNow(await schoolTimeZone(db)); // "2026-11-20 02:00:05"
  const dasar = `tarbiyah-${t.slice(0, 10).replaceAll("-", "")}-${t.slice(11, 16).replace(":", "")}`;
  for (let i = 0; ; i++) {
    const nama = i ? `${dasar}-${i + 1}` : dasar;
    const [ada] = await db
      .select({ id: backupFile.id })
      .from(backupFile)
      .where(eq(backupFile.nama, nama));
    if (!ada) return nama;
  }
}

export async function notifyAdmin(
  deps: Pick<BackupDeps, "db" | "pool" | "boss">,
  judul: string,
  isi: string,
) {
  const admins = await usersWithPermission(deps.db, "backup.kelola");
  await transactionWithClient(deps.pool, (tx, client) =>
    notify(tx, client, deps.boss, admins, {
      jenis: "sistem",
      judul,
      isi,
      url: "/sistem/backup",
      pengirimUserId: null,
    }),
  );
}

type Manifest = {
  nama: string;
  jenis: (typeof backupFile.$inferSelect)["jenis"];
  versiSkema: number | null;
  versiAplikasi: string | null;
  ukuran: number | null;
  dibuatAt: string;
};

async function tulisManifest(storage: Storage, m: Manifest) {
  await storage.delete(manifestKey(m.nama)); // manifest boleh diperbarui (dump tidak pernah)
  await storage.put(manifestKey(m.nama), Buffer.from(JSON.stringify(m, null, 2)));
}

/** Unggah dump + manifest ke B2 `tarbiyah/db/`. */
async function unggahKeB2(deps: BackupDeps, b2: B2, nama: string) {
  const key = `${B2_PREFIX}db/${nama}.dump`;
  await b2.put(key, (await deps.storage.get(dumpKey(nama))).stream);
  await b2.put(
    `${B2_PREFIX}db/${nama}.json`,
    (await deps.storage.get(manifestKey(nama))).stream,
    "application/json",
  );
  return key;
}

/**
 * Backup database penuh: pg_dump → DATA_DIR/backups → manifest → B2 (bila aktif) → hapus dump
 * tertua di server (hanya di disk). Gagal → status "gagal" + notifikasi admin.
 */
export async function jalankanBackup(
  deps: BackupDeps,
  opts: {
    jenis: "otomatis" | "manual" | "pra_restore";
    userId?: string | null;
    /** false: jangan hapus dump lama (backup pra-restore tidak boleh menghapus dump sumbernya). */
    retensi?: boolean;
  },
) {
  const { db, storage } = deps;
  const nama = await namaBaru(db);
  const versiSkema = versiSkemaAplikasi();
  const [row] = await db
    .insert(backupFile)
    .values({
      nama,
      jenis: opts.jenis,
      versiSkema,
      versiAplikasi: deps.version,
      dibuatOleh: opts.userId ?? null,
    })
    .returning();
  if (!row) throw new Error("backup_file gagal dicatat");
  try {
    const ukuran = await dumpKe(storage, dumpKey(nama), deps.databaseUrl).catch(async (e) => {
      await storage.delete(dumpKey(nama));
      throw e;
    });
    await tulisManifest(storage, {
      nama,
      jenis: opts.jenis,
      versiSkema,
      versiAplikasi: deps.version,
      ukuran,
      dibuatAt: row.dibuatAt.toISOString(),
    });
    await db.update(backupFile).set({ ukuran, adaDiServer: true }).where(eq(backupFile.id, row.id));
    // Dump di server sudah aman; gagal unggah ke B2 dicatat & diberitahukan, tidak membatalkan backup.
    let b2Key: string | null = null;
    let error: string | null = null;
    try {
      const b2 = await getB2(deps);
      if (b2) b2Key = await unggahKeB2(deps, b2, nama);
    } catch (e) {
      error = `Unggah ke B2 gagal: ${safeError(e)}`;
      await notifyAdmin(deps, "Unggah backup ke B2 gagal", `${nama}: ${error.slice(0, 300)}`).catch(
        () => {},
      );
    }
    await db
      .update(backupFile)
      .set({
        status: "berhasil",
        b2Key,
        b2At: b2Key ? new Date() : null,
        error,
        selesaiAt: new Date(),
      })
      .where(eq(backupFile.id, row.id));
    if (opts.retensi !== false) await hapusDumpLama(deps);
    // Berkas baru ikut disalin setelah backup database.
    await deps.boss.send(QUEUES.filesSync, {}).catch(() => {});
    return { ...row, status: "berhasil" as const, ukuran, b2Key };
  } catch (e) {
    const error = safeError(e);
    await db
      .update(backupFile)
      .set({ status: "gagal", error, selesaiAt: new Date() })
      .where(eq(backupFile.id, row.id));
    await notifyAdmin(deps, "Backup gagal", `Backup ${nama} gagal: ${error.slice(0, 300)}`).catch(
      () => {},
    );
    throw e;
  }
}

/** Simpan N dump terakhir di server; yang lebih lama dihapus dari disk saja (B2 tidak disentuh). */
async function hapusDumpLama(deps: BackupDeps) {
  const { simpanDiServer } = await getBackupSetting(deps.db);
  const lama = await deps.db
    .select({ id: backupFile.id, nama: backupFile.nama })
    .from(backupFile)
    .where(eq(backupFile.adaDiServer, true))
    .orderBy(desc(backupFile.dibuatAt))
    .offset(simpanDiServer);
  for (const r of lama) {
    await deps.storage.delete(dumpKey(r.nama));
    await deps.storage.delete(manifestKey(r.nama));
    await deps.db.update(backupFile).set({ adaDiServer: false }).where(eq(backupFile.id, r.id));
  }
}

/** Job harian: backup otomatis bila backup otomatis terakhir yang berhasil sudah ≥ interval hari. */
export async function backupTerjadwal(deps: BackupDeps, now = new Date()) {
  const { intervalHari } = await getBackupSetting(deps.db);
  const [akhir] = await deps.db
    .select({ dibuatAt: backupFile.dibuatAt })
    .from(backupFile)
    .where(and(eq(backupFile.jenis, "otomatis"), eq(backupFile.status, "berhasil")))
    .orderBy(desc(backupFile.dibuatAt))
    .limit(1);
  // Toleransi 2 jam agar jadwal harian yang bergeser sedikit tetap kena.
  if (
    akhir &&
    now.getTime() - akhir.dibuatAt.getTime() < intervalHari * 86_400_000 - 2 * 3_600_000
  ) {
    return null;
  }
  return eksklusif(() => jalankanBackup(deps, { jenis: "otomatis" }));
}

/**
 * Samakan tabel backup_file dengan isi disk: dipakai setelah restore (isi tabel ikut berganti,
 * termasuk baris backup yang saat dump dibuat masih "berjalan") dan saat aplikasi start.
 */
export async function sinkronDaftarBackup(deps: Pick<BackupDeps, "db" | "storage">) {
  const keys = new Set(await deps.storage.list("backups"));
  for (const key of keys) {
    if (!key.endsWith(".json")) continue;
    const { stream } = await deps.storage.get(key);
    let teks = "";
    for await (const c of stream) teks += String(c);
    const m = JSON.parse(teks) as Manifest;
    const ada = keys.has(dumpKey(m.nama));
    if (!ada) continue;
    await deps.db
      .insert(backupFile)
      .values({
        nama: m.nama,
        jenis: m.jenis,
        status: "berhasil",
        ukuran: m.ukuran,
        versiSkema: m.versiSkema,
        versiAplikasi: m.versiAplikasi,
        adaDiServer: true,
        dibuatAt: new Date(m.dibuatAt),
        selesaiAt: new Date(m.dibuatAt),
      })
      .onConflictDoUpdate({
        target: backupFile.nama,
        set: { status: "berhasil", ukuran: m.ukuran, adaDiServer: true, error: null },
      });
  }
  for (const r of await deps.db.select().from(backupFile)) {
    const ada = keys.has(dumpKey(r.nama)) && keys.has(manifestKey(r.nama));
    const terputus = r.status === "berjalan" && !ada;
    if (ada !== r.adaDiServer || terputus) {
      await deps.db
        .update(backupFile)
        .set({
          adaDiServer: ada,
          ...(terputus ? { status: "gagal" as const, error: "Terhenti sebelum selesai" } : {}),
        })
        .where(eq(backupFile.id, r.id));
    }
  }
}

// ------------------------------------------------------------------ berkas bertahap

/**
 * Salin ke B2 `tarbiyah/<path>` setiap berkas yang belum punya dibackup_at, sekali saja
 * (nama acak, tidak pernah ditimpa). Konkurensi 2, streaming.
 */
export async function sinkronBerkas(deps: BackupDeps, batas = 1000) {
  const b2 = await getB2(deps);
  if (!b2) return { disalin: 0, gagal: 0 };
  let disalin = 0;
  let gagal = 0;
  let after = "00000000-0000-0000-0000-000000000000";
  while (disalin + gagal < batas) {
    const rows = await deps.db
      .select({ id: berkas.id, path: berkas.path, tipe: berkas.tipe })
      .from(berkas)
      .where(and(isNull(berkas.dibackupAt), gt(berkas.id, after)))
      .orderBy(asc(berkas.id))
      .limit(20);
    if (!rows.length) break;
    after = rows[rows.length - 1]?.id ?? after;
    for (let i = 0; i < rows.length; i += 2) {
      await Promise.all(
        rows.slice(i, i + 2).map(async (r) => {
          try {
            const key = `${B2_PREFIX}${r.path}`;
            if (!(await b2.exists(key))) {
              await b2.put(key, (await deps.storage.get(r.path)).stream, r.tipe);
            }
            await deps.db.update(berkas).set({ dibackupAt: new Date() }).where(eq(berkas.id, r.id));
            disalin++;
          } catch (e) {
            gagal++;
            console.error(`[files.sync] ${r.path}: ${safeError(e)}`);
          }
        }),
      );
    }
  }
  if (gagal) {
    await notifyAdmin(
      deps,
      "Salin berkas ke B2 gagal",
      `${gagal} berkas gagal disalin ke B2.`,
    ).catch(() => {});
  }
  return { disalin, gagal };
}

/** Ringkasan untuk dashboard admin. */
export async function ringkasanBackup(db: Db) {
  const [akhir] = await db
    .select({ nama: backupFile.nama, dibuatAt: backupFile.dibuatAt, b2Key: backupFile.b2Key })
    .from(backupFile)
    .where(eq(backupFile.status, "berhasil"))
    .orderBy(desc(backupFile.dibuatAt))
    .limit(1);
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(berkas)
    .where(isNull(berkas.dibackupAt));
  const s = await getBackupSetting(db);
  return {
    terakhir: akhir ?? null,
    berkasBelumTersalin: n,
    b2Aktif: s.b2Aktif,
    intervalHari: s.intervalHari,
  };
}
