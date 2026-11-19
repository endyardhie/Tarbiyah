import * as Dialog from "@radix-ui/react-dialog";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Bell, LayoutGrid, X } from "lucide-react";
import { useState } from "react";
import { MOBILE_NAV, NAV_ITEMS, type NavItem } from "../lib/nav";
import { ThemeToggle } from "./ThemeToggle";

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-extrabold text-on-primary">
        T
      </span>
      {!compact && <span className="text-lg font-extrabold tracking-tight">TARBIYAH</span>}
    </div>
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
        {NAV_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} />
        ))}
      </nav>
    </aside>
  );
}

function MenuSheet({ onOpenChange }: { onOpenChange: (o: boolean) => void }) {
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
        <nav aria-label="Semua menu" className="grid grid-cols-2 gap-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              onClick={() => onOpenChange(false)}
              className="flex min-h-14 items-center gap-3 rounded-2xl border border-border bg-surface px-3 font-semibold data-[status=active]:border-transparent data-[status=active]:bg-soft data-[status=active]:text-on-soft"
            >
              <Icon size={20} className="shrink-0" />
              <span className="min-w-0 leading-tight">{label}</span>
            </Link>
          ))}
        </nav>
        <div className="mt-4 flex justify-end">
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
  const inMenu = !MOBILE_NAV.some((i) =>
    i.to === "/" ? pathname === "/" : pathname.startsWith(i.to),
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <nav
        aria-label="Navigasi utama"
        className="fixed inset-x-[max(12px,env(safe-area-inset-left))] bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 grid grid-cols-5 gap-[3px] max-[359px]:gap-px rounded-[26px] border border-border bg-surface-raised/95 p-1.5 shadow-soft backdrop-blur-lg md:hidden"
      >
        {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/" }}
            className={navItemClass}
            activeProps={{ className: activeClass }}
          >
            <Icon size={22} strokeWidth={1.8} />
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
  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <Link
        to="/informasi"
        aria-label="Notifikasi"
        title="Notifikasi"
        className="grid size-11 place-items-center rounded-full border border-border bg-surface-raised text-text transition-colors hover:bg-surface-muted"
      >
        <Bell size={20} />
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
