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
