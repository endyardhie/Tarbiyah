import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

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
