import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { Construction, WifiOff } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState } from "./components/Page";
import { errorMessage } from "./lib/api";
import { useMe } from "./lib/auth";
import type { AppPath } from "./lib/nav";
import { usePublicConfig } from "./lib/sekolah";
import { AkademikPage, PengaturanAkademikPage, TemplateRaporPage } from "./routes/akademik";
import { PerangkatPage, PersetujuanPage, ProfilPage, WajibGantiPasswordPage } from "./routes/akun";
import { BackupPage } from "./routes/backup";
import { BerandaPage } from "./routes/beranda";
import { CetakKeuanganPage, CetakPresensiPage, CetakRaporPage } from "./routes/cetak";
import { ImporPage } from "./routes/impor";
import { InformasiPage, KalenderPage } from "./routes/informasi";
import { KeuanganPage } from "./routes/keuangan";
import { LogPage } from "./routes/log";
import { LoginPage, LupaPasswordPage } from "./routes/login";
import { AktifkanNotifikasiPage, NotifikasiPage } from "./routes/notifikasi";
import { PengajaranPage } from "./routes/pengajaran";
import { PengaturanPage } from "./routes/pengaturan";
import { PenggunaPage } from "./routes/pengguna";
import { PengumumanPage } from "./routes/pengumuman";
import { PresensiPage } from "./routes/presensi";
import { RolePage } from "./routes/role";
import { SantriPage } from "./routes/santri";
import { KelasPage, MapelPage, SekolahPage, StrukturPage } from "./routes/sekolah";
import { SistemPage } from "./routes/sistem";
import { TahunBaruPage } from "./routes/tahun-baru";
import { WaliPage } from "./routes/wali";
import { Button } from "./ui/Button";

const rootRoute = createRootRoute({
  component: Outlet,
  notFoundComponent: () => (
    <div className="p-6">
      <EmptyState icon={Construction} title="Halaman tidak ditemukan">
        Periksa kembali alamat yang dibuka.
      </EmptyState>
    </div>
  ),
});

/** Semua halaman di dalam aplikasi butuh login; password sementara wajib diganti dulu. */
function AuthGate() {
  const me = useMe();
  // Tunggu pengaturan publik (zona waktu sekolah) agar semua tanggal tampil di zona yang benar.
  const config = usePublicConfig();
  if (me.isPending || config.isPending) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <span className="size-12 animate-pulse rounded-[18px] bg-soft" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="grid min-h-dvh place-items-center p-4">
        <EmptyState icon={WifiOff} title="Tidak bisa terhubung">
          {errorMessage(me.error)}
          <Button className="mt-4" onClick={() => me.refetch()}>
            Coba lagi
          </Button>
        </EmptyState>
      </div>
    );
  }
  if (!me.data) return <Navigate to="/login" />;
  if (me.data.user.wajibGantiPassword) return <WajibGantiPasswordPage />;
  if (me.data.perluPersetujuan) return <PersetujuanPage />;
  return <AppShell />;
}

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AuthGate });

const page = <P extends AppPath>(path: P, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => appRoute, path, component });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/cetak/presensi",
    component: CetakPresensiPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/cetak/rapor", component: CetakRaporPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/cetak/keuangan",
    component: CetakKeuanganPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/lupa-password",
    component: LupaPasswordPage,
  }),
  appRoute.addChildren([
    page("/", BerandaPage),
    page("/presensi", PresensiPage),
    page("/akademik", AkademikPage),
    page("/akademik/pengaturan", PengaturanAkademikPage),
    page("/akademik/template", TemplateRaporPage),
    page("/keuangan", KeuanganPage),
    page("/informasi", InformasiPage),
    page("/informasi/kalender", KalenderPage),
    page("/informasi/pengumuman", PengumumanPage),
    page("/notifikasi", NotifikasiPage),
    page("/notifikasi/aktifkan", AktifkanNotifikasiPage),
    page("/sekolah", SekolahPage),
    page("/sekolah/santri", SantriPage),
    page("/sekolah/wali", WaliPage),
    page("/sekolah/kelas", KelasPage),
    page("/sekolah/mapel", MapelPage),
    page("/sekolah/pengajaran", PengajaranPage),
    page("/sekolah/struktur", StrukturPage),
    page("/sekolah/impor", ImporPage),
    page("/sekolah/tahun-baru", TahunBaruPage),
    page("/sistem", SistemPage),
    page("/sistem/pengguna", PenggunaPage),
    page("/sistem/role", RolePage),
    page("/sistem/pengaturan", PengaturanPage),
    page("/sistem/backup", BackupPage),
    page("/sistem/log", LogPage),
    page("/profil", ProfilPage),
    page("/perangkat", PerangkatPage),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
