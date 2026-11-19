import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

// Satu sumber kebenaran (atribut data-theme), semua tombol tema ikut berubah bersamaan.
const listeners = new Set<() => void>();
const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

function toggle() {
  const next: Theme = read() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("tema", next);
  } catch {
    // mode privat: tema tetap berlaku untuk sesi ini
  }
  for (const l of listeners) l();
}

export function useTheme() {
  return { theme: useSyncExternalStore(subscribe, read), toggle };
}
