// Service worker: cache aset aplikasi (bisa dibuka saat sinyal lemah). Data API & berkas
// TIDAK pernah di-cache agar data santri tidak tertinggal di perangkat.
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

type SW = {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[];
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  addEventListener: (
    type: string,
    cb: (e: { waitUntil: (p: Promise<unknown>) => void }) => void,
  ) => void;
};
declare const self: SW;
const sw = self;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/manifest\.webmanifest$/, /^\/apple-touch-icon/],
  }),
);

sw.addEventListener("install", () => void sw.skipWaiting());
sw.addEventListener("activate", (e) => e.waitUntil(sw.clients.claim()));

// Web Push: tampilkan notifikasi dari server (judul, isi, ikon lembaga, tautan).
sw.addEventListener("push", (e) => {
  let d: Record<string, string> = {};
  try {
    d = e.data?.json() ?? {};
  } catch {
    // payload bukan JSON: tampilkan notifikasi umum
  }
  e.waitUntil(
    sw.registration.showNotification(d.judul || "Pemberitahuan baru", {
      body: d.isi,
      icon: d.icon,
      badge: d.icon,
      tag: d.tag,
      data: { url: d.url },
    }),
  );
});

// Klik notifikasi: buka halaman terkait (hanya path di aplikasi ini), pakai jendela yang sudah ada.
sw.addEventListener("notificationclick", (e) => {
  e.notification?.close();
  const path = e.notification?.data?.url;
  const url = new URL(path?.startsWith("/") ? path : "/notifikasi", sw.location.origin).href;
  e.waitUntil(
    sw.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const win = list.find((w) => w.url.startsWith(sw.location.origin));
      // navigate() gagal bila jendela belum dikendalikan service worker → buka jendela baru.
      if (win)
        return win
          .navigate(url)
          .then(() => win.focus())
          .catch(() => sw.clients.openWindow(url));
      return sw.clients.openWindow(url);
    }),
  );
});
