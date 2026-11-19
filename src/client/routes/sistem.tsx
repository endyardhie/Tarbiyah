import { Link } from "@tanstack/react-router";
import { ChevronRight, DatabaseBackup, ShieldCheck, SlidersHorizontal, Users } from "lucide-react";
import { Card, PageHeader } from "../components/Page";
import { hasPermission, useMe } from "../lib/auth";

export function SistemPage() {
  const { data: me } = useMe();
  const kelolaPengguna = hasPermission(me, "pengguna.kelola");
  return (
    <>
      <PageHeader title="Sistem" subtitle="Pengguna, hak akses, pengaturan, dan backup." />
      <div className="grid gap-3 md:grid-cols-2">
        {kelolaPengguna && (
          <>
            <Link to="/sistem/pengguna" className="group">
              <Card className="flex items-center gap-4 transition-colors group-hover:border-primary">
                <span className="grid size-12 place-items-center rounded-full bg-soft text-on-soft">
                  <Users size={22} />
                </span>
                <div className="flex-1">
                  <p className="font-semibold">Pengguna</p>
                  <p className="text-sm text-text2">Buat akun, reset password, nonaktifkan</p>
                </div>
                <ChevronRight className="text-text2" />
              </Card>
            </Link>
            <Link to="/sistem/role" className="group">
              <Card className="flex items-center gap-4 transition-colors group-hover:border-primary">
                <span className="grid size-12 place-items-center rounded-full bg-soft text-on-soft">
                  <ShieldCheck size={22} />
                </span>
                <div className="flex-1">
                  <p className="font-semibold">Role & hak akses</p>
                  <p className="text-sm text-text2">Jabatan dan izinnya</p>
                </div>
                <ChevronRight className="text-text2" />
              </Card>
            </Link>
          </>
        )}
        {me?.isAdmin && (
          <Link to="/sistem/pengaturan" className="group">
            <Card className="flex items-center gap-4 transition-colors group-hover:border-primary">
              <span className="grid size-12 place-items-center rounded-full bg-soft text-on-soft">
                <SlidersHorizontal size={22} />
              </span>
              <div className="flex-1">
                <p className="font-semibold">Pengaturan</p>
                <p className="text-sm text-text2">Identitas lembaga, zona waktu, logo</p>
              </div>
              <ChevronRight className="text-text2" />
            </Card>
          </Link>
        )}
        {me?.isAdmin && (
          <Card className="flex items-center gap-4 opacity-70">
            <span className="grid size-12 place-items-center rounded-full bg-surface-muted text-text2">
              <DatabaseBackup size={22} />
            </span>
            <div className="flex-1">
              <p className="font-semibold">Backup & restore</p>
              <p className="text-sm text-text2">Segera hadir · backup ke B2 (M7)</p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
