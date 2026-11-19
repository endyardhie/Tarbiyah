import { useEffect, useRef, useState } from "react";

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let script: Promise<void> | undefined;
function loadScript() {
  script ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      script = undefined;
      reject(new Error("Turnstile gagal dimuat"));
    };
    document.head.appendChild(s);
  });
  return script;
}

/** Widget Cloudflare Turnstile. Ganti `resetKey` untuk meminta token baru (token sekali pakai). */
export function Turnstile({
  siteKey,
  onToken,
  resetKey,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  resetKey: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    onTokenRef.current(null);
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        id = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          language: "id",
          // Layar sempit (320px) tidak muat widget normal 300px.
          size: ref.current.clientWidth < 300 ? "compact" : "flexible",
          theme: document.documentElement.dataset.theme === "dark" ? "dark" : "light",
          callback: (t: string) => onTokenRef.current(t),
          "expired-callback": () => onTokenRef.current(null),
          "error-callback": () => onTokenRef.current(null),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, resetKey]);

  if (failed) {
    return (
      <p className="text-sm text-danger">
        Verifikasi keamanan gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.
      </p>
    );
  }
  return <div ref={ref} className="min-h-[65px]" />;
}
