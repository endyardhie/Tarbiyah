import { asc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { roleSchema } from "../../shared/schemas";
import { isUniqueViolation, type Tx } from "../db/client";
import { rolePermissions, roles, userRoles } from "../db/schema";
import { audit } from "../lib/audit";
import type { AuthUser } from "../lib/can";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { requirePermission, requireUser } from "../lib/guards";

/** Non-admin hanya boleh menyusun jabatan dari izin yang ia punya sendiri. */
function assertGrantable(actor: AuthUser, izin: string[]) {
  if (!actor.isAdmin && izin.some((p) => !actor.permissions.has(p))) {
    throw fail(403, "Anda hanya boleh memberi izin yang juga Anda miliki");
  }
}

async function getRole(tx: Tx, id: string) {
  const [role] = await tx.select().from(roles).where(eq(roles.id, id));
  if (!role) throw fail(404, "Jabatan tidak ditemukan");
  const izin = await tx
    .select({ izin: rolePermissions.izin })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, id));
  return { ...role, izin: izin.map((r) => r.izin).sort() };
}

export function roleRoutes({ db }: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser, requirePermission("pengguna.kelola"))
    .get("/", async (c) => {
      const list = await db
        .select({
          id: roles.id,
          nama: roles.nama,
          keterangan: roles.keterangan,
          admin: roles.admin,
          izin: sql<
            string[]
          >`coalesce((select array_agg(izin order by izin) from role_permissions rp where rp.role_id = "roles"."id"), '{}')`,
          jumlahPengguna: sql<number>`(select count(*)::int from ${userRoles} ur where ur.role_id = "roles"."id")`,
        })
        .from(roles)
        .orderBy(sql`${roles.admin} desc`, asc(roles.nama));
      return c.json(list);
    })
    .post("/", async (c) => {
      const input = await parseBody(c, roleSchema);
      assertGrantable(currentUser(c), input.izin);
      const id = await db
        .transaction(async (tx) => {
          const [row] = await tx
            .insert(roles)
            .values({ nama: input.nama, keterangan: input.keterangan })
            .returning({ id: roles.id });
          const roleId = row?.id as string;
          if (input.izin.length) {
            await tx.insert(rolePermissions).values(input.izin.map((izin) => ({ roleId, izin })));
          }
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "jabatan.buat",
            entitas: "roles",
            entitasId: roleId,
            sesudah: await getRole(tx, roleId),
            ip: c.get("ip"),
          });
          return roleId;
        })
        .catch((e) => {
          throw isUniqueViolation(e) ? fail(409, "Nama jabatan sudah dipakai") : e;
        });
      return c.json({ id }, 201);
    })
    .patch("/:id", async (c) => {
      const input = await parseBody(c, roleSchema);
      assertGrantable(currentUser(c), input.izin);
      const id = paramId(c);
      await db
        .transaction(async (tx) => {
          const before = await getRole(tx, id);
          if (before.admin) throw fail(400, "Jabatan Admin tidak bisa diubah");
          await tx
            .update(roles)
            .set({ nama: input.nama, keterangan: input.keterangan })
            .where(eq(roles.id, id));
          await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
          if (input.izin.length) {
            await tx
              .insert(rolePermissions)
              .values(input.izin.map((izin) => ({ roleId: id, izin })));
          }
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "jabatan.ubah",
            entitas: "roles",
            entitasId: id,
            sebelum: before,
            sesudah: await getRole(tx, id),
            ip: c.get("ip"),
          });
        })
        .catch((e) => {
          throw isUniqueViolation(e) ? fail(409, "Nama jabatan sudah dipakai") : e;
        });
      return c.json({ ok: true });
    })
    .delete("/:id", async (c) => {
      const id = paramId(c);
      await db.transaction(async (tx) => {
        const before = await getRole(tx, id);
        if (before.admin) throw fail(400, "Jabatan Admin tidak bisa dihapus");
        await tx.delete(roles).where(eq(roles.id, id));
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: "jabatan.hapus",
          entitas: "roles",
          entitasId: id,
          sebelum: before,
          ip: c.get("ip"),
        });
      });
      return c.json({ ok: true });
    });
}
