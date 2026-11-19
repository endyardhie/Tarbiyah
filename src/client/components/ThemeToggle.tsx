import { Moon, Sun } from "lucide-react";
import { useTheme } from "../lib/theme";

export function ThemeToggle({ withLabel = false }: { withLabel?: boolean }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  const label = dark ? "Mode terang" : "Mode gelap";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-border bg-surface-raised px-3 text-sm font-semibold text-text transition-colors hover:bg-surface-muted"
    >
      {dark ? <Sun size={20} /> : <Moon size={20} />}
      {withLabel && <span>{label}</span>}
    </button>
  );
}
