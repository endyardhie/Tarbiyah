import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Construction } from "lucide-react";
import type { ReactNode } from "react";
import { AppShell } from "./components/AppShell";
import { EmptyState, PageHeader } from "./components/Page";
import { type AppPath, NAV_ITEMS } from "./lib/nav";
import { BerandaPage } from "./routes/beranda";

const rootRoute = createRootRoute({
  component: AppShell,
  notFoundComponent: () => (
    <EmptyState icon={Construction} title="Halaman tidak ditemukan">
      Periksa kembali alamat yang dibuka.
    </EmptyState>
  ),
});

// Halaman modul yang belum dibangun: judul + keterangan milestone.
const PLACEHOLDERS: Partial<Record<AppPath, string>> = {
  "/presensi": "Isi presensi harian dan laporan kehadiran.",
  "/akademik": "Tugas/PR, penilaian, nilai, dan rapor.",
  "/keuangan": "Tagihan SPP, pembayaran, dan laporan keuangan.",
  "/informasi": "Notifikasi, pengumuman, dan kalender.",
  "/sekolah": "Lokasi, unit, kelas, mapel, santri, dan wali.",
  "/sistem": "Pengguna, role & hak akses, pengaturan, dan backup.",
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
  createRoute({ getParentRoute: () => rootRoute, path, component });
const placeholder = <P extends AppPath>(path: P) => page(path, () => <Placeholder path={path} />);

const routeTree = rootRoute.addChildren([
  page("/", BerandaPage),
  placeholder("/presensi"),
  placeholder("/akademik"),
  placeholder("/keuangan"),
  placeholder("/informasi"),
  placeholder("/sekolah"),
  placeholder("/sistem"),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
