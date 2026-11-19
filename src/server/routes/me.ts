import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { changePasswordSchema, profileSchema } from "../../shared/schemas";
import type { Db } from "../db/client";
import { sessions } from "../db/schema";
import type { AuthUser } from "../lib/can";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { requireUser } from "../lib/guards";
import { changePassword, getUsers, updateProfile } from "../services/users";

export async function meResponse(db: Db, auth: AuthUser) {
  const [user] = await getUsers(db, [auth.id]);
  if (!user) throw fail(401, "Silakan masuk terlebih dahulu");
  return {
    user,
    isAdmin: auth.isAdmin,
    permissions: [...auth.permissions].sort(),
    relasi: auth.relasi,
  };
}

export function meRoutes({ db }: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser)
    .get("/", async (c) => c.json(await meResponse(db, currentUser(c))))
    .patch("/", async (c) => {
      const input = await parseBody(c, profileSchema);
      const user = currentUser(c);
      await updateProfile(db, user.id, input, c.get("ip"));
      return c.json(await meResponse(db, user));
    })
    .post("/password", async (c) => {
      const { passwordLama, passwordBaru } = await parseBody(c, changePasswordSchema);
      await changePassword(
        db,
        currentUser(c).id,
        c.get("sessionId") as string,
        passwordLama,
        passwordBaru,
        c.get("ip"),
      );
      return c.json({ ok: true });
    })
    .get("/sessions", async (c) => {
      const rows = await db
        .select({
          id: sessions.id,
          perangkat: sessions.perangkat,
          ip: sessions.ip,
          dibuatAt: sessions.dibuatAt,
          terakhirAktif: sessions.terakhirAktif,
        })
        .from(sessions)
        .where(eq(sessions.userId, currentUser(c).id))
        .orderBy(desc(sessions.terakhirAktif));
      const current = c.get("sessionId");
      return c.json(rows.map((r) => ({ ...r, ini: r.id === current })));
    })
    .delete("/sessions/:id", async (c) => {
      const id = paramId(c);
      if (id === c.get("sessionId")) throw fail(400, "Gunakan tombol Keluar untuk perangkat ini");
      await db
        .delete(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, currentUser(c).id)));
      return c.json({ ok: true });
    });
}
