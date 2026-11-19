import { and, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { santriSchema, santriWaliSchema, waliSchema } from "../../shared/sekolah";
import { santriWali } from "../db/schema";
import { audit } from "../lib/audit";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";
import { assertPureWali, getSantri, listSantri, listWali, saveSantri } from "../services/santri";
import { resolveTahunAjaran } from "../services/sekolah";
import { createUser, resetPassword, updateUser } from "../services/users";

export function santriRoutes({ db }: AppDeps) {
  async function save(c: Context<AppEnv>, id: string | null) {
    const input = await parseBody(c, santriSchema);
    const result = await db.transaction(async (tx) => {
      const r = await saveSantri(tx, input, id);
      await audit(tx, {
        userId: currentUser(c).id,
        aksi: id ? "santri.ubah" : "santri.buat",
        entitas: "santri",
        entitasId: r.id,
        sesudah: input,
        ip: c.get("ip"),
      });
      return r;
    });
    return c.json(result, id ? 200 : 201);
  }

  return new Hono<AppEnv>()
    .get("/", requireUser, async (c) =>
      c.json(
        await listSantri(db, currentUser(c), {
          tahunAjaranId: await resolveTahunAjaran(db, c.req.query("tahunAjaranId")),
          kelasId: c.req.query("kelasId") || undefined,
        }),
      ),
    )
    .get("/:id", requireUser, async (c) => c.json(await getSantri(db, currentUser(c), paramId(c))))
    .post("/", requireUser, requirePermission("santri.kelola"), (c) => save(c, null))
    .patch("/:id", requireUser, requirePermission("santri.kelola"), (c) => save(c, paramId(c)));
}

export function waliRoutes({ db }: AppDeps) {
  const guard = [requireUser, requirePermission("wali.kelola")] as const;
  return new Hono<AppEnv>()
    .get("/", ...guard, async (c) => c.json(await listWali(db)))
    .post("/", ...guard, async (c) => {
      const input = await parseBody(c, waliSchema);
      return c.json(
        await createUser(
          db,
          currentUser(c),
          { ...input, namaPanggilan: null, roleIds: [] },
          c.get("ip"),
        ),
        201,
      );
    })
    .patch("/:id", ...guard, async (c) => {
      const id = paramId(c);
      const input = await parseBody(
        c,
        waliSchema.extend({ status: z.enum(["aktif", "nonaktif"]) }),
      );
      await assertPureWali(db, id);
      await updateUser(
        db,
        currentUser(c),
        id,
        { ...input, namaPanggilan: null, roleIds: [] },
        c.get("ip"),
      );
      return c.json({ ok: true });
    })
    .post("/:id/reset-password", ...guard, async (c) => {
      const id = paramId(c);
      await assertPureWali(db, id);
      return c.json(await resetPassword(db, currentUser(c), id, c.get("ip")));
    });
}

/** Penghubungan santri ↔ wali, dipakai dari halaman santri maupun halaman wali. */
export function santriWaliRoutes({ db }: AppDeps) {
  const guard = [requireUser, requirePermission("wali.kelola")] as const;
  return new Hono<AppEnv>()
    .put("/", ...guard, async (c) => {
      const input = await parseBody(c, santriWaliSchema);
      await db.transaction(async (tx) => {
        await tx
          .insert(santriWali)
          .values(input)
          .onConflictDoUpdate({
            target: [santriWali.santriId, santriWali.userId],
            set: { hubungan: input.hubungan, penerimaTagihan: input.penerimaTagihan },
          });
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: "santri_wali.hubungkan",
          entitas: "santri_wali",
          entitasId: input.santriId,
          sesudah: input,
          ip: c.get("ip"),
        });
      });
      return c.json({ ok: true });
    })
    .delete("/:santriId/:userId", ...guard, async (c) => {
      const santriId = paramId(c, "santriId");
      const userId = paramId(c, "userId");
      await db.transaction(async (tx) => {
        const [row] = await tx
          .delete(santriWali)
          .where(and(eq(santriWali.santriId, santriId), eq(santriWali.userId, userId)))
          .returning();
        if (!row) throw fail(404, "Hubungan tidak ditemukan");
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: "santri_wali.lepas",
          entitas: "santri_wali",
          entitasId: santriId,
          sebelum: row,
          ip: c.get("ip"),
        });
      });
      return c.json({ ok: true });
    });
}
