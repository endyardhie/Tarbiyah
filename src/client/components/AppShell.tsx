import * as Dialog from "@radix-ui/react-dialog";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, ChevronRight, LayoutGrid, LogOut, X } from "lucide-react";
import { useState } from "react";
import type { Me } from "../../shared/types";
import { useLogout, useMe } from "../lib/auth";
import { mobileNav, type NavItem, visibleNav } from "../lib/nav";
import { useJumlahNotif } from "../lib/push";
import { usePublicConfig } from "../lib/sekolah";
import { ThemeToggle } from "./ThemeToggle";

function Brand({ compact = false }: { compact?: boolean }) {
  const config = usePublicConfig();
  const logo = config.data?.logoUrl;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {logo ? (
        <img
          src={logo}
          alt=""
          className="size-10 shrink-0 rounded-2xl bg-white object-contain p-0.5"
        />
      ) : (
        // Logo bawaan TARBIYAH selama lembaga belum mengunggah logo sendiri.
        <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-[11px]" />
      )}
      {!compact && (
        <span className="truncate text-lg font-extrabold tracking-tight">
          {config.data?.namaSingkat ?? "TARBIYAH"}
        </span>
      )}
    </div>
  );
}

/** Penanda jumlah belum dibaca (disembunyikan dari pembaca layar; label tautan sudah menyebutkannya). */
function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span
      aria-hidden
      className="absolute -top-1.5 -right-2 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] leading-none font-bold text-on-danger"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      title={item.label}
      className="flex min-h-11 items-center gap-3 rounded-full px-3 font-semibold text-text2 transition-colors hover:bg-surface-muted hover:text-text data-[status=active]:bg-soft data-[status=active]:text-on-soft md:justify-center lg:justify-start lg:px-4"
    >
      <Icon size={20} className="shrink-0" />
      <span className="md:sr-only lg:not-sr-only">{item.label}</span>
    </Link>
  );
}

function Sidebar() {
  const { data: me } = useMe();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-20 flex-col gap-6 border-r border-border bg-surface px-3 py-6 md:flex lg:w-64 lg:px-4">
      <div className="flex justify-center lg:justify-start lg:px-2">
        <span className="lg:hidden">
          <Brand compact />
        </span>
        <span className="hidden lg:block">
          <Brand />
        </span>
      </div>
      <nav aria-label="Navigasi utama" className="flex flex-col gap-1">
        {visibleNav(me).map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>
    </aside>
  );
}

function peranLabel(me: Me | null | undefined) {
  if (!me) return "";
  if (me.isAdmin) return "Admin";
  const r = me.relasi;
  const peran = [
    ...me.user.roles.map((x) => x.nama),
    ...(r.kelasWali.length ? ["Wali kelas"] : []),
    ...(r.pengajaran.length ? ["Pengajar"] : []),
    ...(r.anak.length ? ["Wali santri"] : []),
  ];
  return peran.join(" · ") || "Lihat profil";
}

function MenuSheet({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
  const { data: me } = useMe();
  const logout = useLogout();
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
      <Dialog.Content
        className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-50 max-h-[80dvh] overflow-y-auto rounded-[28px] border border-border bg-surface-raised p-5 shadow-soft"
        aria-describedby={undefined}
      >
        <div className="mb-4 flex items-center justify-between">
          <Dialog.Title className="text-lg font-bold">Menu</Dialog.Title>
          <Dialog.Close
            aria-label="Tutup menu"
            className="grid size-11 place-items-center rounded-full hover:bg-surface-muted"
          >
            <X size={22} />
          </Dialog.Close>
        </div>
        <Link
          to="/profil"
          onClick={() => onOpenChange(false)}
          className="mb-4 flex min-h-16 items-center gap-3 rounded-[22px] bg-surface p-3 shadow-soft"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-lg font-bold text-on-primary">
            {(me?.user.namaPanggilan || me?.user.nama || "?").charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold">{me?.user.nama}</span>
            <span className="block truncate text-sm text-text2">{peranLabel(me)}</span>
          </span>
          <ChevronRight size={20} className="shrink-0 text-text2" />
        </Link>
        <nav
          aria-label="Semua menu"
          className="grid grid-cols-4 gap-x-1 gap-y-3 max-[359px]:grid-cols-3"
        >
          {visibleNav(me).map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              onClick={() => onOpenChange(false)}
              className="group flex min-h-[84px] flex-col items-center gap-1.5 rounded-2xl px-0.5 py-1 text-center text-xs font-semibold leading-tight"
            >
              <span className="grid size-13 place-items-center rounded-[18px] bg-soft text-on-soft transition-colors group-data-[status=active]:bg-primary group-data-[status=active]:text-on-primary">
                <Icon size={22} strokeWidth={1.8} />
              </span>
              <span className="line-clamp-2">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60"
          >
            <LogOut size={20} /> {logout.isPending ? "Keluar…" : "Keluar"}
          </button>
          <ThemeToggle withLabel />
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

const navItemClass =
  "flex min-h-[62px] min-w-0 flex-col items-center justify-center gap-1 rounded-[19px] px-0.5 pt-[7px] pb-1.5 text-text2 transition-colors";
const activeClass = "bg-soft text-on-soft";

function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useMe();
  const items = mobileNav(me);
  const belum = useJumlahNotif().data?.belum ?? 0;
  const inMenu = !items.some((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to)));

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-[max(12px,env(safe-area-inset-left))] bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 grid grid-cols-5 gap-[3px] max-[359px]:gap-px rounded-[26px] border border-border bg-surface-raised/95 p-1.5 shadow-soft backdrop-blur-lg md:hidden"
      >
        {items.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={navItemClass}
            activeProps={{ className: activeClass }}
          >
            <span className="relative">
              <Icon size={22} strokeWidth={1.8} />
              {to === "/notifikasi" && <Badge n={belum} />}
            </span>
            <span className="w-full truncate text-center text-[11px] leading-tight font-semibold max-[359px]:text-[10px]">
              {label}
            </span>
          </Link>
        ))}
        <Dialog.Trigger className={`${navItemClass} ${inMenu || open ? activeClass : ""}`}>
          <LayoutGrid size={22} strokeWidth={1.8} />
          <span className="w-full truncate text-center text-[11px] leading-tight font-semibold max-[359px]:text-[10px]">
            Menu
          </span>
        </Dialog.Trigger>
      </nav>
      <MenuSheet onOpenChange={setOpen} />
    </Dialog.Root>
  );
}

function TopActions() {
  const { data: me } = useMe();
  const belum = useJumlahNotif().data?.belum ?? 0;
  const initial = (me?.user.namaPanggilan || me?.user.nama || "?").charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <Link
        to="/notifikasi"
        aria-label={belum ? `Notifikasi, ${belum} belum dibaca` : "Notifikasi"}
        title="Notifikasi"
        className="relative grid size-11 place-items-center rounded-full border border-border bg-surface-raised text-text transition-colors hover:bg-surface-muted"
      >
        <Bell size={20} />
        <Badge n={belum} />
      </Link>
      <Link
        to="/profil"
        aria-label={`Profil ${me?.user.nama ?? ""}`}
        title="Profil"
        className="hidden min-h-11 items-center gap-2 rounded-full border border-border bg-surface-raised py-1 pr-4 pl-1 font-semibold hover:bg-surface-muted md:inline-flex"
      >
        <span className="grid size-9 place-items-center rounded-full bg-primary text-on-primary">
          {initial}
        </span>
        <span className="max-w-40 truncate">{me?.user.namaPanggilan || me?.user.nama}</span>
      </Link>
    </div>
  );
}

export function AppShell() {
  return (
    <div className="min-h-dvh overflow-x-clip">
      <Sidebar />
      <div className="md:pl-20 lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-bg/90 px-4 py-3 backdrop-blur md:border-0 md:bg-transparent md:px-8 md:py-5 md:backdrop-blur-none">
          <span className="md:invisible">
            <Brand />
          </span>
          <TopActions />
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 pt-4 pb-[calc(112px+env(safe-area-inset-bottom))] md:px-8 md:pb-10">
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
