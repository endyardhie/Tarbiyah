import type { Readable } from "node:stream";
import { asc, eq, gt } from "drizzle-orm";
import { runMigrations } from "../db/client";
import { backupFile, berkas } from "../db/schema";
import { B2_PREFIX } from "../lib/b2";
import { fail } from "../lib/context";
import { safeError } from "../lib/log";
import { pemeliharaan } from "../lib/pemeliharaan";
import { schoolNow } from "../lib/tanggal";
import {
  type BackupDeps,
  dumpKey,
  eksklusif,
  getB2,
  jalankanBackup,
  pgRestore,
  sinkronDaftarBackup,
  versiSkemaAplikasi,
  versiSkemaDump,
} from "./backup";
import { lupakanCacheIdentitas, schoolTimeZone } from "./pengaturan";
import { lupakanCacheVapid } from "./push";

export type CekRestore = {
  id: string;
  nama: string;
  versiDump: number | null;
  versiAplikasi: number;
  boleh: boolean;
  pesan: string;
};

/** Periksa isi dump (bukan hanya manifest) sebelum restore. */
export async function cekRestore(deps: BackupDeps, id: string): Promise<CekRestore> {
  const [row] = await deps.db.select().from(backupFile).where(eq(backupFile.id, id));
  if (!row || row.status !== "berhasil" || !row.adaDiServer) {
    throw fail(404, "Backup tidak ditemukan di server");
  }
  const versiDump = await versiSkemaDump(deps.storage, dumpKey(row.nama)).catch(() => null);
  const versiAplikasi = versiSkemaAplikasi();
  const pesan =
    versiDump === null
      ? "Berkas ini bukan backup TARBIYAH yang valid."
      : versiDump > versiAplikasi
        ? "Backup dibuat oleh versi aplikasi yang lebih baru. Perbarui aplikasi dulu."
        : versiDump < versiAplikasi
          ? "Backup dari versi lebih lama: migrasi akan dijalankan setelah restore."
          : "Versi skema cocok.";
  return {
    id: row.id,
    nama: row.nama,
    versiDump,
    versiAplikasi,
    boleh: versiDump !== null && versiDump <= versiAplikasi,
    pesan,
  };
}

/** Skema aplikasi dikosongkan agar tabel dari versi lebih baru tidak tertinggal (pgboss tetap). */
async function kosongkanSkema(deps: BackupDeps) {
  await deps.pool.query(
    "drop schema if exists public cascade; create schema public; drop schema if exists drizzle cascade",
  );
}

/** Unduh dari B2 berkas yang tercatat di tabel berkas tetapi tidak ada di disk. */
async function pulihkanBerkas(deps: BackupDeps) {
  const b2 = await getB2(deps);
  let dipulihkan = 0;
  let hilang = 0;
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const rows = await deps.db
      .select({ id: berkas.id, path: berkas.path })
      .from(berkas)
      .where(gt(berkas.id, after))
      .orderBy(asc(berkas.id))
      .limit(200);
    if (!rows.length) break;
    after = rows[rows.length - 1]?.id ?? after;
    for (const r of rows) {
      if (await deps.storage.exists(r.path)) continue;
      try {
        if (!b2) throw new Error("B2 nonaktif");
        await deps.storage.put(r.path, await b2.get(`${B2_PREFIX}${r.path}`));
        dipulihkan++;
      } catch (e) {
        hilang++;
        console.error(`[restore] berkas ${r.path}: ${safeError(e)}`);
      }
    }
  }
  return { dipulihkan, hilang };
}

/**
 * Restore: cek versi → backup kondisi sekarang → mode pemeliharaan → kosongkan skema →
 * pg_restore (satu transaksi) → migrasi → berkas hilang dari B2 → mode normal.
 * pg_restore gagal → kondisi sebelum restore dipulihkan dari backup otomatis tadi.
 */
export async function pulihkan(
  deps: BackupDeps & { setelahRestore?: () => Promise<void> },
  id: string,
) {
  return eksklusif(async () => {
    const cek = await cekRestore(deps, id);
    if (!cek.boleh) throw fail(409, cek.pesan);
    pemeliharaan.mulai("Membuat backup kondisi sekarang");
    try {
      const pra = await jalankanBackup(deps, { jenis: "pra_restore" });
      pemeliharaan.tahap("Memulihkan database");
      // Beri waktu request & job yang sedang berjalan untuk selesai.
      await new Promise((r) => setTimeout(r, 1500));
      await kosongkanSkema(deps);
      try {
        await pgRestore(deps.storage, dumpKey(cek.nama), deps.databaseUrl);
      } catch (e) {
        pemeliharaan.tahap("Restore gagal, mengembalikan kondisi sebelumnya");
        await kosongkanSkema(deps);
        await pgRestore(deps.storage, dumpKey(pra.nama), deps.databaseUrl);
        throw e;
      }
      pemeliharaan.tahap("Menjalankan migrasi");
      await runMigrations(deps.db);
      lupakanCacheIdentitas(deps.db);
      lupakanCacheVapid(deps.db);
      await sinkronDaftarBackup(deps);
      await deps.setelahRestore?.();
      pemeliharaan.tahap("Mengunduh berkas yang hilang dari B2");
      const b = await pulihkanBerkas(deps);
      const info = b.hilang
        ? ` ${b.hilang} berkas tidak ditemukan di B2.`
        : b.dipulihkan
          ? ` ${b.dipulihkan} berkas diunduh dari B2.`
          : "";
      pemeliharaan.selesai(false, `Pemulihan dari ${cek.nama} selesai.${info}`);
    } catch (e) {
      console.error(`[restore] ${safeError(e)}`);
      pemeliharaan.selesai(true, `Pemulihan gagal: ${safeError(e).slice(0, 300)}`);
      throw e;
    }
  });
}

async function namaUnik(deps: BackupDeps, dasar: string) {
  for (let i = 0; ; i++) {
    const nama = i ? `${dasar}-${i + 1}` : dasar;
    const [ada] = await deps.db
      .select({ id: backupFile.id })
      .from(backupFile)
      .where(eq(backupFile.nama, nama));
    if (!ada && !(await deps.storage.exists(dumpKey(nama)))) return nama;
  }
}

/** Simpan dump yang diunggah/diambil sebagai baris backup_file setelah isinya dicek. */
async function simpanDump(
  deps: BackupDeps,
  body: Readable,
  nama: string,
  jenis: "unggahan" | "dari_b2",
  userId: string | null,
) {
  const { size } = await deps.storage.put(dumpKey(nama), body);
  const versi = await versiSkemaDump(deps.storage, dumpKey(nama)).catch(() => null);
  if (versi === null) {
    await deps.storage.delete(dumpKey(nama));
    throw fail(400, "Berkas ini bukan backup TARBIYAH (format pg_dump custom).");
  }
  const [row] = await deps.db
    .insert(backupFile)
    .values({
      nama,
      jenis,
      status: "berhasil",
      ukuran: size,
      versiSkema: versi,
      adaDiServer: true,
      dibuatOleh: userId,
      selesaiAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("backup_file gagal dicatat");
  await deps.storage.put(
    `backups/${nama}.json`,
    Buffer.from(
      JSON.stringify({
        nama,
        jenis,
        versiSkema: versi,
        versiAplikasi: null,
        ukuran: size,
        dibuatAt: row.dibuatAt.toISOString(),
      }),
    ),
  );
  return row;
}

export async function unggahDump(deps: BackupDeps, body: Readable, userId: string) {
  const t = schoolNow(await schoolTimeZone(deps.db));
  const nama = await namaUnik(
    deps,
    `unggahan-${t.slice(0, 10).replaceAll("-", "")}-${t.slice(11, 16).replace(":", "")}`,
  );
  return simpanDump(deps, body, nama, "unggahan", userId);
}

/** Daftar dump di B2 `tarbiyah/db/` (untuk pemulihan saat server baru / dump lokal sudah dihapus). */
export async function daftarB2(deps: BackupDeps) {
  const b2 = await getB2(deps);
  if (!b2) return [];
  return (await b2.list(`${B2_PREFIX}db/`))
    .filter((o) => o.key.endsWith(".dump"))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export async function ambilDariB2(deps: BackupDeps, key: string, userId: string) {
  if (!/^tarbiyah\/db\/[\w.-]+\.dump$/.test(key)) throw fail(400, "Kunci B2 tidak valid");
  const b2 = await getB2(deps);
  if (!b2) throw fail(409, "B2 belum aktif");
  const asal = key.slice(`${B2_PREFIX}db/`.length, -".dump".length);
  const nama = await namaUnik(deps, asal);
  return simpanDump(deps, await b2.get(key), nama, "dari_b2", userId);
}
