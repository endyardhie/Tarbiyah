import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  DatabaseBackup,
  History,
  type LucideIcon,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { Card, PageHeader } from "../components/Page";
import { hasPermission, useMe } from "../lib/auth";
import type { AppPath } from "../lib/nav";

function HubLink({
  to,
  icon: Icon,
  judul,
  ket,
}: {
  to: AppPath;
  icon: LucideIcon;
  judul: string;
  ket: string;
}) {
  return (
    <Link to={to} className="group">
      <Card className="flex items-center gap-4 transition-colors group-hover:border-primary">
        <span className="grid size-12 place-items-center rounded-full bg-soft text-on-soft">
          <Icon size={22} />
        </span>
        <div className="flex-1">
          <p className="font-semibold">{judul}</p>
          <p className="text-sm text-text2">{ket}</p>
        </div>
        <ChevronRight className="text-text2" />
      </Card>
    </Link>
  );
}

export function SistemPage() {
  const { data: me } = useMe();
  const kelolaPengguna = hasPermission(me, "pengguna.kelola");
  return (
    <>
      <PageHeader title="Sistem" subtitle="Pengguna, hak akses, pengaturan, dan backup." />
      <div className="grid gap-3 md:grid-cols-2">
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
