import { Hono } from "hono";
import { tahunBaruSchema } from "../../shared/tahun-baru";
import { type AppDeps, type AppEnv, currentUser, parseBody } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";
import { jalankanTahunBaru, usulanTahunBaru } from "../services/tahun-baru";

/** Wizard tahun ajaran baru (naik kelas massal): hanya admin. */
export function tahunBaruRoutes({ db }: AppDeps) {
  const admin = [requireUser, requirePermission("pengaturan.kelola")] as const;
  return new Hono<AppEnv>()
    .get("/", ...admin, async (c) => c.json(await usulanTahunBaru(db)))
    .post("/", ...admin, async (c) => {
      const input = await parseBody(c, tahunBaruSchema);
      return c.json(await jalankanTahunBaru(db, input, { id: currentUser(c).id, ip: c.get("ip") }));
    });
}
