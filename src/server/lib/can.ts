import { ADMIN_ONLY, type Permission } from "../../shared/permissions";

export type AuthUser = {
  id: string;
  nama: string;
  wajibGantiPassword: boolean;
  isAdmin: boolean;
  roles: { id: string; nama: string; admin: boolean }[];
  permissions: Set<string>;
};

/** Lingkup data untuk izin berbasis relasi (wali kelas, pengajar, wali santri). */
export type Scope = { kelasId?: string; pengajaranId?: string; santriId?: string };

/**
 * Satu-satunya pemeriksa hak akses di server.
 * Lapis 1: admin lolos semua; izin jabatan. Lapis 2: relasi ke kelas/mapel/santri (diisi di M2).
 */
export async function can(user: AuthUser, permission: Permission, scope?: Scope): Promise<boolean> {
  if (user.isAdmin) return true;
  if ((ADMIN_ONLY as readonly string[]).includes(permission)) return false;
  if (user.permissions.has(permission)) return true;
  return scope ? relationAllows(user, permission, scope) : false;
}

async function relationAllows(_user: AuthUser, _permission: Permission, _scope: Scope) {
  return false; // M2: cek kelas.wali_kelas, pengajaran.guru, santri_wali
}
