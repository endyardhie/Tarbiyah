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
import { EmptyState, PageHeader } from "./components/Page";
import { errorMessage } from "./lib/api";
import { useMe } from "./lib/auth";
import { type AppPath, NAV_ITEMS } from "./lib/nav";
import { PerangkatPage, ProfilPage, WajibGantiPasswordPage } from "./routes/akun";
import { BerandaPage } from "./routes/beranda";
import { LoginPage, LupaPasswordPage } from "./routes/login";
import { PenggunaPage } from "./routes/pengguna";
import { RolePage } from "./routes/role";
import { SistemPage } from "./routes/sistem";
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
  if (me.isPending) {
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
  return <AppShell />;
}

const appRoute = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AuthGate });

// Halaman modul yang belum dibangun: judul + keterangan.
const PLACEHOLDERS: Partial<Record<AppPath, string>> = {
  "/presensi": "Isi presensi harian dan laporan kehadiran.",
  "/akademik": "Tugas/PR, penilaian, nilai, dan rapor.",
  "/keuangan": "Tagihan SPP, pembayaran, dan laporan keuangan.",
  "/informasi": "Notifikasi, pengumuman, dan kalender.",
  "/sekolah": "Lokasi, unit, kelas, mapel, santri, dan wali.",
};

function Placeholder({ path }: { path: AppPath }) {
  const item = NAV_ITEMS.find((i) => i.to === path);
  if (!item) return null;
  return (
    <>
      <PageHeader title={item.label} subtitle={PLACEHOLDERS[path]} />
      <EmptyState icon={item.icon} title="Segera hadir">
        Modul {item.label} sedang dibangun.
      </EmptyState>
    </>
  );
}

const page = <P extends AppPath>(path: P, component: () => ReactNode) =>
  createRoute({ getParentRoute: () => appRoute, path, component });
const placeholder = <P extends AppPath>(path: P) => page(path, () => <Placeholder path={path} />);

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/lupa-password",
    component: LupaPasswordPage,
  }),
  appRoute.addChildren([
    page("/", BerandaPage),
    placeholder("/presensi"),
    placeholder("/akademik"),
    placeholder("/keuangan"),
    placeholder("/informasi"),
    placeholder("/sekolah"),
    page("/sistem", SistemPage),
    page("/sistem/pengguna", PenggunaPage),
    page("/sistem/role", RolePage),
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
