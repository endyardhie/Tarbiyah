import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { isIos, isStandalone } from "./install";

export type PushState = "tidak-didukung" | "perlu-install" | "ditolak" | "aktif" | "nonaktif";

const supported = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** iPhone/iPad hanya bisa menerima push bila aplikasi sudah di-install (iOS 16.4+). */
export async function pushState(): Promise<PushState> {
  if (isIos() && !isStandalone()) return "perlu-install";
  if (!supported()) return "tidak-didukung";
  if (Notification.permission === "denied") return "ditolak";
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ? "aktif" : "nonaktif";
}

export const usePushState = () =>
  useQuery({ queryKey: ["push-state"], queryFn: pushState, staleTime: 0 });

function keyBytes(base64url: string) {
  const b64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
}

async function readyRegistration() {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error("Service worker belum aktif. Muat ulang halaman lalu coba lagi.")),
      10_000,
    ),
  );
  return Promise.race([navigator.serviceWorker.ready, timeout]);
}

export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Izin notifikasi tidak diberikan.");
  const reg = await readyRegistration();
  const { publicKey } = await api<{ publicKey: string }>("/push/kunci");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  await api("/push/langganan", { method: "PUT", body: sub.toJSON() });
}

/** Matikan push di perangkat ini (juga dipanggil saat keluar agar orang berikutnya tidak menerima). */
export async function disablePush() {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api("/push/langganan", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(
    () => {},
  );
  await sub.unsubscribe().catch(() => {});
}

/** Jumlah notifikasi belum dibaca (badge), diperbarui tiap menit dan saat aplikasi dibuka lagi. */
export const useJumlahNotif = (enabled = true) =>
  useQuery({
    queryKey: ["notifikasi", "jumlah"],
    queryFn: () => api<{ belum: number }>("/notifikasi/jumlah"),
    refetchInterval: 60_000,
    enabled,
  });
