import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import type { profileSchema, userCreateSchema, userUpdateSchema } from "../../shared/schemas";
import { type Db, isUniqueViolation, type Tx } from "../db/client";
import { rolePermissions, roles, sessions, userPhones, userRoles, users } from "../db/schema";
import { audit } from "../lib/audit";
import type { AuthUser } from "../lib/can";
import { fail } from "../lib/context";
import { hashPassword, tempPassword, verifyPassword } from "../lib/password";

type Profile = z.output<typeof profileSchema>;
type UserCreate = z.output<typeof userCreateSchema>;
type UserUpdate = z.output<typeof userUpdateSchema>;

/** Pengguna lengkap dengan nomor HP & jabatan, urut nama. Tanpa ids = semua. */
export async function getUsers(db: Db | Tx, ids?: string[]) {
  const where = ids ? inArray(users.id, ids) : undefined;
  const list = await db
    .select({
      id: users.id,
      nama: users.nama,
      namaPanggilan: users.namaPanggilan,
      alamat: users.alamat,
      status: users.status,
      wajibGantiPassword: users.wajibGantiPassword,
      loginTerakhir: users.loginTerakhir,
    })
    .from(users)
    .where(where)
    .orderBy(asc(users.nama));
  const userIds = list.map((u) => u.id);
  if (userIds.length === 0) return [];
  const [phones, roleRows] = await Promise.all([
    db
      .select({
        userId: userPhones.userId,
        nomor: userPhones.nomor,
        label: userPhones.label,
        punyaWa: userPhones.punyaWa,
        untukLogin: userPhones.untukLogin,
      })
      .from(userPhones)
      .where(inArray(userPhones.userId, userIds))
      .orderBy(asc(userPhones.nomor)),
    db
      .select({ userId: userRoles.userId, id: roles.id, nama: roles.nama, admin: roles.admin })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(inArray(userRoles.userId, userIds))
      .orderBy(asc(roles.nama)),
  ]);
  return list.map((u) => ({
    ...u,
    phones: phones.filter((p) => p.userId === u.id).map(({ userId: _, ...p }) => p),
    roles: roleRows.filter((r) => r.userId === u.id).map(({ userId: _, ...r }) => r),
  }));
}

export type UserDetail = Awaited<ReturnType<typeof getUsers>>[number];

async function getUserOr404(db: Db | Tx, id: string) {
  const [user] = await getUsers(db, [id]);
  if (!user) throw fail(404, "Pengguna tidak ditemukan");
  return user;
}

async function replacePhones(tx: Tx, userId: string, phones: Profile["phones"]) {
  await tx.delete(userPhones).where(eq(userPhones.userId, userId));
  try {
    await tx.insert(userPhones).values(phones.map((p) => ({ ...p, userId })));
  } catch (e) {
    if (isUniqueViolation(e)) throw fail(409, "Nomor HP sudah dipakai pengguna lain");
    throw e;
  }
}

/** Baris jabatan admin; `lock` menyerialkan semua perubahan yang menyentuh admin. */
async function adminRole(tx: Tx, lock = false) {
  const q = tx.select({ id: roles.id }).from(roles).where(eq(roles.admin, true));
  const [row] = lock ? await q.for("update") : await q;
  return row?.id ?? null;
}

/**
 * Aturan memberi jabatan: hanya admin yang memberi Admin, dan non-admin hanya boleh memberi
 * jabatan yang seluruh izinnya ia punya sendiri (mencegah menaikkan hak sendiri/orang lain).
 * `added` = jabatan yang baru ditambahkan (jabatan lama yang dipertahankan tidak diperiksa).
 */
async function assertRoleGrant(
  tx: Tx,
  actor: AuthUser,
  roleIds: string[],
  adminId: string | null,
  added: string[] = roleIds,
) {
  if (!actor.isAdmin && adminId && added.includes(adminId)) {
    throw fail(403, "Hanya admin yang boleh memberi jabatan Admin");
  }
  if (roleIds.length === 0) return;
  const found = await tx.select({ id: roles.id }).from(roles).where(inArray(roles.id, roleIds));
  if (found.length !== new Set(roleIds).size) throw fail(400, "Jabatan tidak ditemukan");
  if (actor.isAdmin || added.length === 0) return;
  const izin = await tx
    .select({ izin: rolePermissions.izin })
    .from(rolePermissions)
    .where(inArray(rolePermissions.roleId, added));
  if (izin.some((r) => !actor.permissions.has(r.izin))) {
    throw fail(403, "Anda hanya boleh memberi jabatan yang izinnya juga Anda miliki");
  }
}

const summary = (u: Pick<UserDetail, "nama" | "status" | "phones" | "roles">) => ({
  nama: u.nama,
  status: u.status,
  nomor: u.phones.map((p) => p.nomor),
  jabatan: u.roles.map((r) => r.nama),
});

export async function createUser(db: Db, actor: AuthUser, input: UserCreate, ip: string) {
  const passwordSementara = tempPassword();
  const passwordHash = await hashPassword(passwordSementara);
  const id = await db.transaction(async (tx) => {
    await assertRoleGrant(tx, actor, input.roleIds, await adminRole(tx));
    const [row] = await tx
      .insert(users)
      .values({
        nama: input.nama,
        namaPanggilan: input.namaPanggilan,
        alamat: input.alamat,
        passwordHash,
        wajibGantiPassword: true,
      })
      .returning({ id: users.id });
    const userId = row?.id as string;
    await replacePhones(tx, userId, input.phones);
    if (input.roleIds.length) {
      await tx.insert(userRoles).values(input.roleIds.map((roleId) => ({ userId, roleId })));
    }
    const created = await getUserOr404(tx, userId);
    await audit(tx, {
      userId: actor.id,
      aksi: "pengguna.buat",
      entitas: "users",
      entitasId: userId,
      sesudah: summary(created),
      ip,
    });
    return userId;
  });
  return { id, passwordSementara };
}

export async function updateUser(
  db: Db,
  actor: AuthUser,
  id: string,
  input: UserUpdate,
  ip: string,
) {
  await db.transaction(async (tx) => {
    const adminId = await adminRole(tx, true);
    const before = await getUserOr404(tx, id);
    const targetIsAdmin = before.roles.some((r) => r.admin);
    if (targetIsAdmin && !actor.isAdmin)
      throw fail(403, "Hanya admin yang boleh mengubah akun admin");
    const beforeIds = before.roles.map((r) => r.id);
    const added = input.roleIds.filter((r) => !beforeIds.includes(r));
    const changed = added.length > 0 || beforeIds.some((r) => !input.roleIds.includes(r));
    if (id === actor.id && !actor.isAdmin && changed) {
      throw fail(403, "Jabatan sendiri hanya bisa diubah oleh admin");
    }
    await assertRoleGrant(tx, actor, input.roleIds, adminId, added);

    const staysActiveAdmin =
      input.status === "aktif" && !!adminId && input.roleIds.includes(adminId);
    if (targetIsAdmin && before.status === "aktif" && !staysActiveAdmin) {
      const [{ n } = { n: 0 }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(userRoles)
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(
          and(eq(userRoles.roleId, adminId as string), eq(users.status, "aktif"), ne(users.id, id)),
        );
      if (n === 0) {
        throw fail(409, "Admin aktif terakhir tidak boleh dinonaktifkan atau diturunkan");
      }
    }

    await tx
      .update(users)
      .set({
        nama: input.nama,
        namaPanggilan: input.namaPanggilan,
        alamat: input.alamat,
        status: input.status,
        diubahAt: new Date(),
      })
      .where(eq(users.id, id));
    await replacePhones(tx, id, input.phones);
    await tx.delete(userRoles).where(eq(userRoles.userId, id));
    if (input.roleIds.length) {
      await tx.insert(userRoles).values(input.roleIds.map((roleId) => ({ userId: id, roleId })));
    }
    if (input.status === "nonaktif") await tx.delete(sessions).where(eq(sessions.userId, id));

    const after = await getUserOr404(tx, id);
    await audit(tx, {
      userId: actor.id,
      aksi: "pengguna.ubah",
      entitas: "users",
      entitasId: id,
      sebelum: summary(before),
      sesudah: summary(after),
      ip,
    });
  });
}

export async function resetPassword(db: Db, actor: AuthUser, id: string, ip: string) {
  const passwordSementara = tempPassword();
  const passwordHash = await hashPassword(passwordSementara);
  await db.transaction(async (tx) => {
    const target = await getUserOr404(tx, id);
    if (target.roles.some((r) => r.admin) && !actor.isAdmin) {
      throw fail(403, "Hanya admin yang boleh mengubah akun admin");
    }
    await tx
      .update(users)
      .set({ passwordHash, wajibGantiPassword: true, diubahAt: new Date() })
      .where(eq(users.id, id));
    await tx.delete(sessions).where(eq(sessions.userId, id));
    await audit(tx, {
      userId: actor.id,
      aksi: "pengguna.reset_password",
      entitas: "users",
      entitasId: id,
      ip,
    });
  });
  return { passwordSementara };
}

export async function updateProfile(db: Db, userId: string, input: Profile, ip: string) {
  await db.transaction(async (tx) => {
    const before = await getUserOr404(tx, userId);
    await tx
      .update(users)
      .set({
        nama: input.nama,
        namaPanggilan: input.namaPanggilan,
        alamat: input.alamat,
        diubahAt: new Date(),
      })
      .where(eq(users.id, userId));
    await replacePhones(tx, userId, input.phones);
    await audit(tx, {
      userId,
      aksi: "profil.ubah",
      entitas: "users",
      entitasId: userId,
      sebelum: summary(before),
      sesudah: summary(await getUserOr404(tx, userId)),
      ip,
    });
  });
}

/** Ganti password sendiri; sesi lain dikeluarkan, sesi ini tetap. */
export async function changePassword(
  db: Db,
  userId: string,
  sessionId: string,
  passwordLama: string,
  passwordBaru: string,
  ip: string,
) {
  const [row] = await db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  if (!row || !(await verifyPassword(row.hash, passwordLama))) {
    throw fail(400, "Password lama salah");
  }
  if (passwordLama === passwordBaru) throw fail(400, "Password baru harus berbeda");
  const passwordHash = await hashPassword(passwordBaru);
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, wajibGantiPassword: false, diubahAt: new Date() })
      .where(eq(users.id, userId));
    await tx.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.id, sessionId)));
    await audit(tx, { userId, aksi: "password.ganti", entitas: "users", entitasId: userId, ip });
  });
}

/** User aktif pemilik nomor login ini. */
export async function findLoginUser(db: Db, nomor: string) {
  const [row] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(userPhones)
    .innerJoin(users, eq(users.id, userPhones.userId))
    .where(
      and(eq(userPhones.nomor, nomor), eq(userPhones.untukLogin, true), eq(users.status, "aktif")),
    );
  return row ?? null;
}

/**
 * Admin pertama untuk instalasi baru (dipakai seed dan perintah admin-awal).
 * Ditolak bila sudah ada admin aktif: admin berikutnya dibuat lewat halaman Pengguna.
 */
export async function createFirstAdmin(db: Db, nomor: string, password: string) {
  const passwordHash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const adminId = await adminRole(tx, true);
    if (!adminId) throw new Error("Jabatan Admin tidak ditemukan");
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.roleId, adminId), eq(users.status, "aktif")));
    if (n > 0) throw fail(409, "Sudah ada admin aktif; tambah admin lewat halaman Pengguna");
    const [row] = await tx
      .insert(users)
      .values({ nama: "Administrator", passwordHash, wajibGantiPassword: true })
      .returning({ id: users.id });
    const userId = row?.id as string;
    await replacePhones(tx, userId, [{ nomor, label: "Pribadi", punyaWa: true, untukLogin: true }]);
    await tx.insert(userRoles).values({ userId, roleId: adminId });
    await audit(tx, { userId: null, aksi: "admin.pertama", entitas: "users", entitasId: userId });
    return userId;
  });
}
