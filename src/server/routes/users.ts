import { Hono } from "hono";
import { userCreateSchema, userUpdateSchema } from "../../shared/schemas";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";
import { createUser, getUsers, resetPassword, updateUser } from "../services/users";

export function userRoutes({ db }: AppDeps) {
  return (
    new Hono<AppEnv>()
      .use(requireUser, requirePermission("pengguna.kelola"))
      // shortcut: semua pengguna sekaligus (±500 untuk satu lembaga), filter di browser; paginasi bila ribuan.
      .get("/", async (c) => c.json(await getUsers(db)))
      .get("/:id", async (c) => {
        const [user] = await getUsers(db, [paramId(c)]);
        if (!user) throw fail(404, "Pengguna tidak ditemukan");
        return c.json(user);
      })
      .post("/", async (c) => {
        const input = await parseBody(c, userCreateSchema);
        return c.json(await createUser(db, currentUser(c), input, c.get("ip")), 201);
      })
      .patch("/:id", async (c) => {
        const input = await parseBody(c, userUpdateSchema);
        await updateUser(db, currentUser(c), paramId(c), input, c.get("ip"));
        return c.json({ ok: true });
      })
      .post("/:id/reset-password", async (c) =>
        c.json(await resetPassword(db, currentUser(c), paramId(c), c.get("ip"))),
      )
  );
}
