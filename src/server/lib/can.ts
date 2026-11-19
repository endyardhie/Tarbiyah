import {
  ADMIN_ONLY,
  type Permission,
  RELATION_PERMISSIONS,
  type RelationPermission,
} from "../../shared/permissions";

export type Relasi = {
  /** Kelas yang ia pegang sebagai wali kelas. */
  kelasWali: string[];
  /** Pengajaran (kelas + mapel) yang ia ajar, dan kelasnya. */
  pengajaran: string[];
  kelasAjar: string[];
  /** Santri yang ia walikan. */
  anak: string[];
};

export type AuthUser = {
  id: string;
  nama: string;
  wajibGantiPassword: boolean;
  isAdmin: boolean;
  roles: { id: string; nama: string; admin: boolean }[];
  permissions: Set<string>;
  relasi: Relasi;
};

/** Lingkup data untuk izin berbasis relasi. */
export type Scope = { kelasId?: string | null; pengajaranId?: string; santriId?: string };

/**
 * Satu-satunya pemeriksa hak akses di server.
 * Lapis 1: admin lolos semua; izin jabatan (termasuk izin "lihat semua" yang menyiratkan izin relasi).
 * Lapis 2: relasi ke data — wali kelas, pengajar, wali santri — sesuai `scope`.
 */
export async function can(user: AuthUser, permission: Permission, scope?: Scope): Promise<boolean> {
  if (user.isAdmin) return true;
  if ((ADMIN_ONLY as readonly string[]).includes(permission)) return false;
  if (user.permissions.has(permission)) return true;
  const implied: readonly string[] = RELATION_PERMISSIONS[permission as RelationPermission] ?? [];
  if (implied.some((p) => user.permissions.has(p))) return true;
  return scope ? relationAllows(user.relasi, permission, scope) : false;
}

function relationAllows(r: Relasi, permission: Permission, s: Scope): boolean {
  switch (permission) {
    case "santri.lihat":
      return (
        (!!s.santriId && r.anak.includes(s.santriId)) ||
        (!!s.kelasId && (r.kelasWali.includes(s.kelasId) || r.kelasAjar.includes(s.kelasId)))
      );
    case "presensi.isi":
      return !!s.kelasId && r.kelasWali.includes(s.kelasId);
    case "presensi.lihat":
      return (
        (!!s.santriId && r.anak.includes(s.santriId)) ||
        (!!s.kelasId && (r.kelasWali.includes(s.kelasId) || r.kelasAjar.includes(s.kelasId)))
      );
    default:
      return false;
  }
}
