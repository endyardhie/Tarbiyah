import { Link } from "@tanstack/react-router";
import { ChevronRight, type LucideIcon, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { AppPath } from "../lib/nav";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
      {subtitle && <p className="mt-1 text-text2">{subtitle}</p>}
    </header>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-card border border-border bg-surface p-5 shadow-soft md:p-6 ${className}`}
    >
      {children}
    </section>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-full bg-soft text-on-soft">
        <Icon size={26} />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-text2">{children}</p>
    </Card>
  );
}

/**
 * Tab berbentuk pil. ≤3 tab: kontrol segmen selebar layar.
 * Lebih dari itu: satu baris pil yang bisa digeser di HP (label tidak pernah terlipat).
 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: T[];
  value: T;
  onChange: (t: T) => void;
  label: (t: T) => string;
}) {
  const segmen = tabs.length <= 3;
  return (
    <div
      role="tablist"
      className={
        segmen
          ? "mb-4 grid auto-cols-fr grid-flow-col gap-1 rounded-[24px] border border-border bg-surface p-1 md:inline-grid md:min-w-96"
          : "-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0"
      }
    >
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={value === t}
          onClick={(e) => {
            onChange(t);
            // Tab yang terpotong di tepi layar digeser masuk agar terlihat penuh.
            e.currentTarget.scrollIntoView({ inline: "nearest", block: "nearest" });
          }}
          className={
            segmen
              ? "min-h-11 rounded-[20px] px-2 text-sm leading-tight font-semibold text-text2 transition-colors aria-selected:bg-primary aria-selected:text-on-primary"
              : "min-h-11 shrink-0 rounded-full border border-border px-4 font-semibold whitespace-nowrap text-text2 aria-selected:border-transparent aria-selected:bg-primary aria-selected:text-on-primary"
          }
        >
          {label(t)}
        </button>
      ))}
    </div>
  );
}

export const inisial = (nama: string) =>
  nama
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

/** Baris daftar ringkas (±64px): inisial, nama, keterangan satu baris, lencana opsional. */
export function ListRow({
  nama,
  ket,
  sub,
  badge,
  onClick,
}: {
  nama: string;
  ket: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-16 w-full items-center gap-3 rounded-[20px] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-soft text-sm font-bold text-on-soft">
        {inisial(nama)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{nama}</span>
        <span className="block truncate text-sm text-text2">{ket}</span>
        {sub && <span className="block truncate text-xs text-text2">{sub}</span>}
      </span>
      {badge}
      <ChevronRight size={18} className="shrink-0 text-text2" />
    </button>
  );
}

/**
 * Filter versi HP (<640px): kolom cari + tombol Filter yang membuka lembar bawah.
 * Di layar lebar halaman menampilkan filternya sendiri secara berderet.
 */
export function SaringHp({
  cari,
  filter,
  aktif,
  ringkas,
  hasil,
  onReset,
}: {
  cari: ReactNode;
  filter: ReactNode;
  aktif: number;
  ringkas?: string;
  hasil?: number;
  onReset: () => void;
}) {
  const [buka, setBuka] = useState(false);
  return (
    <div className="sm:hidden">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">{cari}</div>
        <button
          type="button"
          onClick={() => setBuka(true)}
          className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full border border-border bg-surface-raised px-4 font-semibold"
        >
          <SlidersHorizontal size={18} /> Filter
          {aktif > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-primary text-xs text-on-primary">
              {aktif}
            </span>
          )}
        </button>
      </div>
      {ringkas && <p className="mt-2 text-sm text-text2">{ringkas}</p>}
      <Modal open={buka} onOpenChange={setBuka} title="Filter">
        <div className="grid gap-2">{filter}</div>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onReset}>
            Reset
          </Button>
          <Button className="flex-1" onClick={() => setBuka(false)}>
            Tampilkan{hasil !== undefined ? ` ${hasil}` : ""}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** Kartu menu di halaman hub (Informasi, Data Sekolah, Sistem). */
export function HubLink({
  to,
  icon: Icon,
  judul,
  ket,
  cls = "bg-soft text-on-soft",
  badge = 0,
}: {
  to: AppPath;
  icon: LucideIcon;
  judul: string;
  ket: string;
  cls?: string;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-20 items-center gap-4 rounded-[24px] border border-border bg-surface p-4 shadow-soft transition-colors hover:border-primary"
    >
      <span className={`grid size-12 shrink-0 place-items-center rounded-[18px] ${cls}`}>
        <Icon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{judul}</span>
        <span className="line-clamp-2 text-sm text-text2">{ket}</span>
      </span>
      {badge > 0 && (
        <span className="grid min-w-6 place-items-center rounded-full bg-danger px-1.5 text-xs font-bold text-on-danger">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      <ChevronRight size={20} className="shrink-0 text-text2" />
    </Link>
  );
}
