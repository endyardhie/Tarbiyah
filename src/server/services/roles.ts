import type { GrantablePermission } from "../../shared/permissions";
import type { Db } from "../db/client";
import { rolePermissions, roles } from "../db/schema";

const DEFAULT_ROLES: {
  nama: string;
  keterangan: string;
  admin?: boolean;
  izin: GrantablePermission[];
}[] = [
  { nama: "Admin", keterangan: "Akses penuh, termasuk pengaturan & backup", admin: true, izin: [] },
  {
    nama: "Kepala Sekolah",
    keterangan: "Melihat semua unit & lokasi",
    izin: [
      "presensi.lihat_semua",
      "akademik.lihat_semua",
      "rapor.kunci",
      "pengumuman.semua",
      "kalender.kelola",
      "keuangan.lihat",
    ],
  },
  {
    nama: "Bendahara",
    keterangan: "Tagihan & pembayaran",
    izin: ["keuangan.lihat", "keuangan.kelola", "keuangan.catat_manual"],
  },
];

/** Jabatan bawaan dibuat sekali saat tabel roles masih kosong (instalasi baru). */
export async function ensureDefaultRoles(db: Db) {
  await db.transaction(async (tx) => {
    const existing = await tx.select({ id: roles.id }).from(roles).limit(1);
    if (existing.length) return;
    for (const r of DEFAULT_ROLES) {
      const [row] = await tx
        .insert(roles)
        .values({ nama: r.nama, keterangan: r.keterangan, admin: r.admin ?? false })
        .returning({ id: roles.id });
      if (row && r.izin.length) {
        await tx.insert(rolePermissions).values(r.izin.map((izin) => ({ roleId: row.id, izin })));
      }
    }
  });
}
