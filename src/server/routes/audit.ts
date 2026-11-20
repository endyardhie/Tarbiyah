import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { auditLog, users } from "../db/schema";
import { type AppDeps, type AppEnv, fail, queryId } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";
import { schoolTimeZone } from "../services/pengaturan";

const PER_HALAMAN = 50;

/** Log aktivitas (audit_log): hanya admin. Halaman berikutnya lewat kursor waktu+id. */
export function auditRoutes({ db }: AppDeps) {
  const admin = [requireUser, requirePermission("pengaturan.kelola")] as const;
  return new Hono<AppEnv>()
    .get("/opsi", ...admin, async (c) => {
      const aksi = await db
        .selectDistinct({ aksi: auditLog.aksi })
        .from(auditLog)
        .orderBy(auditLog.aksi);
      const pelaku = await db
        .selectDistinct({ id: users.id, nama: users.nama })
        .from(auditLog)
        .innerJoin(users, eq(users.id, auditLog.userId))
        .orderBy(users.nama);
      return c.json({ aksi: aksi.map((a) => a.aksi), pelaku });
    })
    .get("/", ...admin, async (c) => {
      const tgl = z.iso.date();
      const where = [];
      const aksi = c.req.query("aksi");
      if (aksi) where.push(eq(auditLog.aksi, aksi.slice(0, 100)));
      const userId = queryId(c, "userId");
      if (userId) where.push(eq(auditLog.userId, userId));
      const tz = await schoolTimeZone(db);
      for (const [k, op] of [
        ["dari", gte],
        ["sampai", lte],
      ] as const) {
        const v = c.req.query(k);
        if (!v) continue;
        if (!tgl.safeParse(v).success) throw fail(400, `Parameter ${k} tidak valid`);
        where.push(op(sql`(${auditLog.dibuatAt} at time zone ${tz})::date`, v));
      }
      // Kursor = id baris terakhir (UUID v7 urut waktu, jadi tidak ada baris terlewat).
      const sebelum = queryId(c, "sebelum");
      if (sebelum) where.push(lt(auditLog.id, sebelum));
      const rows = await db
        .select({
          id: auditLog.id,
          dibuatAt: auditLog.dibuatAt,
          aksi: auditLog.aksi,
          entitas: auditLog.entitas,
          entitasId: auditLog.entitasId,
          sebelum: auditLog.sebelum,
          sesudah: auditLog.sesudah,
          ip: auditLog.ip,
          userNama: users.nama,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.userId))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(auditLog.id))
        .limit(PER_HALAMAN + 1);
      const ada = rows.length > PER_HALAMAN;
      const page = rows.slice(0, PER_HALAMAN);
      const akhir = page.at(-1);
      return c.json({
        rows: page,
        berikutnya: ada && akhir ? akhir.id : null,
      });
    });
}
