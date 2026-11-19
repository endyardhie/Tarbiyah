import { Hono } from "hono";
import { imporSchema } from "../../shared/sekolah";
import { type AppDeps, type AppEnv, currentUser, parseBody } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";
import { planImport, runImport } from "../services/impor";

/** Impor CSV santri + wali: pratinjau dulu, lalu simpan (ditolak bila masih ada baris error). */
export function imporRoutes({ db }: AppDeps) {
  const guard = [
    requireUser,
    requirePermission("santri.kelola"),
    requirePermission("wali.kelola"),
  ] as const;
  return new Hono<AppEnv>()
    .post("/santri/pratinjau", ...guard, async (c) => {
      const { tahunAjaranId, rows } = await parseBody(c, imporSchema);
      const { _parsed, ...preview } = await planImport(db, tahunAjaranId, rows);
      return c.json(preview);
    })
    .post("/santri", ...guard, async (c) => {
      const { tahunAjaranId, rows } = await parseBody(c, imporSchema);
      const plan = await planImport(db, tahunAjaranId, rows);
      if (plan.ringkasan.barisError > 0) {
        const { _parsed, ...preview } = plan;
        return c.json(
          { error: "Masih ada baris yang salah. Perbaiki CSV lalu coba lagi.", ...preview },
          400,
        );
      }
      return c.json(await runImport(db, currentUser(c).id, c.get("ip"), tahunAjaranId, plan));
    });
}
