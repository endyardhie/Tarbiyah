import { DatabaseBackup, History, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import { HubLink, PageHeader } from "../components/Page";
import { hasPermission, useMe } from "../lib/auth";

export function SistemPage() {
  const { data: me } = useMe();
  const kelolaPengguna = hasPermission(me, "pengguna.kelola");
  return (
    <>
      <PageHeader title="Sistem" subtitle="Pengguna, hak akses, pengaturan, dan backup." />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {kelolaPengguna && (
          <>
            <HubLink
              to="/sistem/pengguna"
              icon={Users}
              judul="Pengguna"
              ket="Buat akun, reset password, nonaktifkan"
            />
            <HubLink
              to="/sistem/role"
              icon={ShieldCheck}
              judul="Role & hak akses"
              ket="Jabatan dan izinnya"
            />
          </>
        )}
        {me?.isAdmin && (
          <>
            <HubLink
              to="/sistem/pengaturan"
              icon={SlidersHorizontal}
              judul="Pengaturan"
              ket="Identitas, logo, tagihan, WA, pembayaran, persetujuan"
            />
            <HubLink
              to="/sistem/backup"
              icon={DatabaseBackup}
              judul="Backup & restore"
              ket="Backup database & berkas ke B2, pulihkan"
            />
            <HubLink
              to="/sistem/log"
              icon={History}
              judul="Log aktivitas"
              ket="Siapa mengubah apa dan kapan"
            />
          </>
        )}
      </div>
    </>
  );
}
