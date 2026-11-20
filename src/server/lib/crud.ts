import { eq } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import type { Permission } from "../../shared/permissions";
import type { Db, Tx } from "../db/client";
import { audit } from "./audit";
import { type AppEnv, currentUser, fail, paramId, parseBody } from "./context";
import { requirePermission, requireUser } from "./guards";

type TableWithId = PgTable & { id: PgColumn };

/**
 * Route CRUD sederhana untuk data master: GET daftar (cukup login), POST/PATCH/DELETE dengan izin,
 * setiap perubahan ditulis ke audit_log. Duplikat/rujukan dipetakan ke 409 oleh onError global.
 */
export function crudRoutes<S extends z.ZodType>(
  db: Db,
  opts: {
    table: TableWithId;
    schema: S;
    permission: Permission;
    entitas: string;
    list?: (c: Context<AppEnv>) => Promise<unknown>;
    /** Validasi tambahan di dalam transaksi sebelum menulis. */
    /** `before` = baris lama (ubah), agar aturan seperti "arsip baca-saja" juga melihat data lama. */
    check?: (
      tx: Tx,
      data: z.output<S>,
      id: string | null,
      before?: Record<string, unknown>,
    ) => Promise<void>;
    /** Validasi sebelum hapus (baris lama). */
    checkDelete?: (tx: Tx, before: Record<string, unknown>) => Promise<void>;
    canDelete?: boolean;
  },
) {
  const { table, schema, permission, entitas } = opts;
  // Middleware dipasang per route: `use()` di sub-app ikut berlaku untuk route lain di prefix yang sama.
  const read = requireUser;
  const guard = requirePermission(permission);
  const app = new Hono<AppEnv>();
  if (opts.list) {
    const list = opts.list;
    app.get("/", read, async (c) => c.json(await list(c)));
  }
  app
    .post("/", read, guard, async (c) => {
      const data = await parseBody(c, schema);
      const row = await db.transaction(async (tx) => {
        await opts.check?.(tx, data, null);
        const [row] = await tx
          .insert(table)
          .values(data as never)
          .returning();
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: `${entitas}.buat`,
          entitas,
          entitasId: (row as { id: string }).id,
          sesudah: row,
          ip: c.get("ip"),
        });
        return row;
      });
      return c.json(row, 201);
    })
    .patch("/:id", read, guard, async (c) => {
      const id = paramId(c);
      const data = await parseBody(c, schema);
      const row = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(table as PgTable)
          .where(eq(table.id, id));
        if (!before) throw fail(404, "Data tidak ditemukan");
        await opts.check?.(tx, data, id, before as Record<string, unknown>);
        const [row] = await tx
          .update(table)
          .set(data as never)
          .where(eq(table.id, id))
          .returning();
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: `${entitas}.ubah`,
          entitas,
          entitasId: id,
          sebelum: before,
          sesudah: row,
          ip: c.get("ip"),
        });
        return row;
      });
      return c.json(row);
    });
  if (opts.canDelete) {
    app.delete("/:id", read, guard, async (c) => {
      const id = paramId(c);
      await db.transaction(async (tx) => {
        const [lama] = await tx
          .select()
          .from(table as PgTable)
          .where(eq(table.id, id));
        if (!lama) throw fail(404, "Data tidak ditemukan");
        await opts.checkDelete?.(tx, lama as Record<string, unknown>);
        const [before] = await tx.delete(table).where(eq(table.id, id)).returning();
        if (!before) throw fail(404, "Data tidak ditemukan");
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: `${entitas}.hapus`,
          entitas,
          entitasId: id,
          sebelum: before,
          ip: c.get("ip"),
        });
      });
      return c.json({ ok: true });
    });
  }
  return app;
}
