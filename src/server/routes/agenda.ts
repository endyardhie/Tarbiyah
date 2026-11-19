import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { agendaSchema } from "../../shared/presensi";
import type { Tx } from "../db/client";
import { agenda, sasaran } from "../db/schema";
import { audit } from "../lib/audit";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";

const tanggal = z.iso.date();

async function withSasaran(tx: Tx | AppDeps["db"], rows: (typeof agenda.$inferSelect)[]) {
  const ids = rows.map((r) => r.id);
  const s = ids.length ? await tx.select().from(sasaran).where(inArray(sasaran.agendaId, ids)) : [];
  return rows.map((r) => ({
    ...r,
    sasaran: s
      .filter((x) => x.agendaId === r.id)
      .map(({ unitId, lokasiId, kelasId }) => ({ unitId, lokasiId, kelasId })),
  }));
}

/** Kalender/agenda: semua yang login bisa melihat, kelola dengan izin kalender.kelola. */
export function agendaRoutes({ db }: AppDeps) {
  const guard = [requireUser, requirePermission("kalender.kelola")] as const;
  return new Hono<AppEnv>()
    .get("/", requireUser, async (c) => {
      const dari = c.req.query("dari");
      const sampai = c.req.query("sampai");
      if (
        !dari ||
        !sampai ||
        !tanggal.safeParse(dari).success ||
        !tanggal.safeParse(sampai).success
      ) {
        throw fail(400, "Parameter dari/sampai tidak valid");
      }
      // Agenda yang beririsan dengan rentang.
      const rows = await db
        .select()
        .from(agenda)
        .where(and(lte(agenda.mulai, sampai), gte(agenda.selesai, dari)))
        .orderBy(asc(agenda.mulai), asc(agenda.judul));
      return c.json(await withSasaran(db, rows));
    })
    .post("/", ...guard, async (c) => {
      const { sasaran: targets, ...data } = await parseBody(c, agendaSchema);
      const row = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(agenda)
          .values({ ...data, dibuatOleh: currentUser(c).id })
          .returning();
        if (!row) throw fail(400, "Gagal menyimpan");
        await tx.insert(sasaran).values(targets.map((t) => ({ ...t, agendaId: row.id })));
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: "agenda.buat",
          entitas: "agenda",
          entitasId: row.id,
          sesudah: { ...data, sasaran: targets },
          ip: c.get("ip"),
        });
        return row;
      });
      return c.json(row, 201);
    })
    .patch("/:id", ...guard, async (c) => {
      const id = paramId(c);
      const { sasaran: targets, ...data } = await parseBody(c, agendaSchema);
      await db.transaction(async (tx) => {
        const [before] = await withSasaran(
          tx,
          await tx.select().from(agenda).where(eq(agenda.id, id)),
        );
        if (!before) throw fail(404, "Agenda tidak ditemukan");
        await tx.update(agenda).set(data).where(eq(agenda.id, id));
        await tx.delete(sasaran).where(eq(sasaran.agendaId, id));
        await tx.insert(sasaran).values(targets.map((t) => ({ ...t, agendaId: id })));
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: "agenda.ubah",
          entitas: "agenda",
          entitasId: id,
          sebelum: before,
          sesudah: { ...data, sasaran: targets },
          ip: c.get("ip"),
        });
      });
      return c.json({ ok: true });
    })
    .delete("/:id", ...guard, async (c) => {
      const id = paramId(c);
      await db.transaction(async (tx) => {
        const [before] = await withSasaran(
          tx,
          await tx.select().from(agenda).where(eq(agenda.id, id)),
        );
        if (!before) throw fail(404, "Agenda tidak ditemukan");
        await tx.delete(agenda).where(eq(agenda.id, id));
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: "agenda.hapus",
          entitas: "agenda",
          entitasId: id,
          sebelum: before,
          ip: c.get("ip"),
        });
      });
      return c.json({ ok: true });
    });
}
