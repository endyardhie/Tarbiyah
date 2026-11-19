/** Izin jabatan yang bisa dicentang admin (docs/RANCANGAN.md › Peran & hak akses). */
export const PERMISSIONS = {
  "santri.kelola": "Kelola data santri",
  "wali.kelola": "Kelola akun wali santri",
  "guru.kelola": "Kelola data guru",
  "kelas.kelola": "Kelola kelas",
  "mapel.kelola": "Kelola mata pelajaran",
  "jadwal.kelola": "Kelola jadwal",
  "presensi.koreksi": "Koreksi presensi tanggal lampau",
  "presensi.lihat_semua": "Lihat presensi semua kelas",
  "akademik.lihat_semua": "Lihat tugas & nilai semua kelas",
  "rapor.kunci": "Kunci rapor",
  "pengumuman.semua": "Kirim pengumuman ke semua sasaran",
  "kalender.kelola": "Kelola kalender & libur",
  "keuangan.lihat": "Lihat laporan keuangan",
  "keuangan.kelola": "Kelola tagihan & pembayaran",
  "keuangan.catat_manual": "Catat pembayaran manual",
  "pengguna.kelola": "Kelola pengguna & jabatan",
} as const;

export type GrantablePermission = keyof typeof PERMISSIONS;
export const GRANTABLE = Object.keys(PERMISSIONS) as [
  GrantablePermission,
  ...GrantablePermission[],
];

/** Melekat pada admin, tidak bisa diberikan ke jabatan lain. */
export const ADMIN_ONLY = ["pengaturan.kelola", "backup.kelola"] as const;
export type AdminOnlyPermission = (typeof ADMIN_ONLY)[number];

/**
 * Izin berbasis relasi: tidak dicentang di jabatan, tetapi tersirat dari izin jabatan tertentu
 * (lihat semua) atau dari relasi ke data (wali kelas, pengajar, wali santri).
 */
export const RELATION_PERMISSIONS = {
  "santri.lihat": ["santri.kelola", "wali.kelola", "presensi.lihat_semua", "akademik.lihat_semua"],
} as const satisfies Record<string, readonly GrantablePermission[]>;
export type RelationPermission = keyof typeof RELATION_PERMISSIONS;

export type Permission = GrantablePermission | AdminOnlyPermission | RelationPermission;
