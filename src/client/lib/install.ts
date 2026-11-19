import { useSyncExternalStore } from "react";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

// Didaftarkan sekali saat aplikasi dimuat (bukan hanya di halaman login), karena event bisa
// datang sebelum halaman login tampil.
let deferred: InstallEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallEvent;
  emit();
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  installed = true;
  emit();
});
const standaloneQuery = window.matchMedia("(display-mode: standalone)");
standaloneQuery.addEventListener?.("change", emit);

const isStandalone = () =>
  standaloneQuery.matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () =>
  /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

let snapshot = { canPrompt: false, standalone: false, installed: false };
function getSnapshot() {
  const next = { canPrompt: !!deferred, standalone: isStandalone(), installed };
  if (
    next.canPrompt !== snapshot.canPrompt ||
    next.standalone !== snapshot.standalone ||
    next.installed !== snapshot.installed
  ) {
    snapshot = next;
  }
  return snapshot;
}

export function useInstall() {
  const state = useSyncExternalStore((cb) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }, getSnapshot);

  /** Menampilkan dialog install asli browser; hanya dipanggil dari klik pengguna. */
  async function prompt(): Promise<"accepted" | "dismissed" | "unavailable"> {
    const event = deferred;
    if (!event) return "unavailable";
    deferred = null; // event hanya bisa dipakai sekali
    emit();
    await event.prompt();
    return (await event.userChoice).outcome;
  }
  return { ...state, prompt };
}
