import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}) {
  const hasBody = opts.body !== undefined;
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (hasBody ? "POST" : "GET"),
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  }).catch(() => {
    throw new ApiError(0, "Tidak bisa terhubung ke server. Periksa koneksi internet.");
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Jawaban bukan JSON aplikasi: biasanya ditolak proxy/firewall (mis. WAF Cloudflare).
    throw new ApiError(
      res.status,
      data?.error ?? `Permintaan ditolak sebelum sampai ke aplikasi (HTTP ${res.status}).`,
    );
  }
  return data as T;
}

/** Sesi habis di tengah jalan → kembali ke halaman login. */
function onError(err: unknown) {
  if (err instanceof ApiError && err.status === 401) queryClient.setQueryData(["me"], null);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : "Terjadi kesalahan, coba lagi";
