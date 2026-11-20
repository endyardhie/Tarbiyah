import { Readable } from "node:stream";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { pengaturanBackupSchema } from "../../shared/backup";
import { backupFile } from "../db/schema";
import { QUEUES } from "../jobs/queues";
import { audit } from "../lib/audit";
import { can } from "../lib/can";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";
import { safeError } from "../lib/log";
import { pemeliharaan } from "../lib/pemeliharaan";
import {
  type BackupDeps,
  dumpKey,
  getBackupView,
  ringkasanBackup,
  saveBackupSetting,
  sedangSibuk,
  tesKoneksiB2,
} from "../services/backup";
import { getIdentitas } from "../services/pengaturan";
import { ambilDariB2, cekRestore, daftarB2, pulihkan, unggahDump } from "../services/restore";

export const backupDepsDari = (deps: AppDeps): BackupDeps => ({
  db: deps.db,
  pool: deps.pool,
  boss: deps.boss,
  storage: deps.storage,
  databaseUrl: deps.config.databaseUrl,
  encryptionKey: deps.config.encryptionKey,
  version: deps.config.version,
  makeB2: deps.makeB2,
});

/** Backup & restore: hanya admin (izin backup.kelola melekat pada admin). */
export function backupRoutes(deps: AppDeps) {
  const { db, storage } = deps;
  const bd = backupDepsDari(deps);
  const admin = [requireUser, requirePermission("backup.kelola")] as const;

  return (
    new Hono<AppEnv>()
      /** Status mode pemeliharaan (dibuka tanpa login: sesi bisa hilang di tengah restore). */
      /** Tanpa login: hanya status umum. Rincian teknis kegagalan hanya untuk admin. */
      .get("/status", async (c) => {
        const s = pemeliharaan.status();
        const user = c.get("user");
        const admin = !!user && (await can(user, "backup.kelola"));
        return c.json({ ...s, sibuk: sedangSibuk(), detail: admin ? pemeliharaan.detail() : null });
      })
      .get("/pengaturan", ...admin, async (c) => c.json(await getBackupView(db)))
      .put("/pengaturan", ...admin, async (c) => {
        const input = await parseBody(c, pengaturanBackupSchema);
        const before = await getBackupView(db);
        await db.transaction(async (tx) => {
          await saveBackupSetting(tx, input, deps.config.encryptionKey);
          const { appKey, ...rest } = input;
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "pengaturan.backup",
            entitas: "settings",
            entitasId: "backup",
            sebelum: before,
            sesudah: { ...rest, appKeyDiganti: !!appKey },
            ip: c.get("ip"),
          });
        });
        return c.json(await getBackupView(db));
      })
      .post("/tes-b2", ...admin, async (c) => {
        try {
          await tesKoneksiB2(bd);
          return c.json({
            ok: true,
            pesan: "Berhasil menulis, membaca, dan mendaftar objek uji di B2.",
          });
        } catch (e) {
          return c.json({ ok: false, pesan: `Gagal: ${safeError(e).slice(0, 300)}` });
        }
      })
      .get("/", ...admin, async (c) =>
        c.json(await db.select().from(backupFile).orderBy(desc(backupFile.dibuatAt)).limit(100)),
      )
      .get("/ringkasan", ...admin, async (c) => c.json(await ringkasanBackup(db)))
      .post("/", ...admin, async (c) => {
        if (sedangSibuk()) throw fail(409, "Backup atau restore lain sedang berjalan");
        await deps.boss.send(QUEUES.backupRun, { userId: currentUser(c).id });
        await audit(db, {
          userId: currentUser(c).id,
          aksi: "backup.manual",
          entitas: "backup_file",
          ip: c.get("ip"),
        });
        return c.json({ ok: true }, 202);
      })
      .get("/:id/unduh", ...admin, async (c) => {
        const [row] = await db
          .select()
          .from(backupFile)
          .where(eq(backupFile.id, paramId(c)));
        if (!row?.adaDiServer) throw fail(404, "Backup tidak ada di server");
        const { stream, size } = await storage.get(dumpKey(row.nama));
        await audit(db, {
          userId: currentUser(c).id,
          aksi: "backup.unduh",
          entitas: "backup_file",
          entitasId: row.id,
          ip: c.get("ip"),
        });
        return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename="${row.nama}.dump"`,
          "Cache-Control": "no-store",
        });
      })
      .get("/b2", ...admin, async (c) => {
        try {
          return c.json(await daftarB2(bd));
        } catch (e) {
          throw fail(409, `Daftar B2 gagal dibaca: ${safeError(e).slice(0, 200)}`);
        }
      })
      .post("/b2/ambil", ...admin, async (c) => {
        const { key } = await parseBody(c, z.object({ key: z.string().max(300) }));
        return c.json(await ambilDariB2(bd, key, currentUser(c).id));
      })
      /** Unggah dump (.dump) sebagai body mentah — di-stream ke disk, tidak dimuat ke memori. */
      .post("/unggah", ...admin, async (c) => {
        const body = c.req.raw.body;
        if (!body) throw fail(400, "Pilih berkas backup terlebih dahulu");
        return c.json(await unggahDump(bd, Readable.fromWeb(body as never), currentUser(c).id));
      })
      .get("/:id/cek", ...admin, async (c) => c.json(await cekRestore(bd, paramId(c))))
      .post("/:id/pulihkan", ...admin, async (c) => {
        const id = paramId(c);
        const { konfirmasi } = await parseBody(c, z.object({ konfirmasi: z.string() }));
        const ident = await getIdentitas(db);
        if (konfirmasi.trim() !== ident.nama.trim()) {
          throw fail(400, "Nama lembaga yang diketik tidak sama");
        }
        const cek = await cekRestore(bd, id);
        if (!cek.boleh) throw fail(409, cek.pesan);
        if (sedangSibuk()) throw fail(409, "Backup atau restore lain sedang berjalan");
        // Audit ditulis sebelum restore (sesudahnya tabel audit berganti dari backup).
        await audit(db, {
          userId: currentUser(c).id,
          aksi: "backup.restore",
          entitas: "backup_file",
          entitasId: id,
          sesudah: { nama: cek.nama },
          ip: c.get("ip"),
        });
        // Berjalan di latar; kemajuan dibaca dari /api/backup/status.
        const userId = currentUser(c).id;
        const ip = c.get("ip");
        void pulihkan({ ...bd, setelahRestore: deps.setelahRestore, jobs: deps.jobs }, id)
          .then(() =>
            // Catat lagi di audit hasil restore; pengguna bisa saja belum ada di backup itu.
            audit(db, {
              userId: null,
              aksi: "backup.restore_selesai",
              entitas: "backup_file",
              sesudah: { nama: cek.nama, olehUserId: userId },
              ip,
            }),
          )
          .catch(() => {});
        return c.json({ ok: true }, 202);
      })
  );
}
