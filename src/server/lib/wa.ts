/**
 * Klien GOWA (go-whatsapp-web-multidevice, OpenAPI v9.7):
 * POST {url}/send/message, HTTP Basic auth, body { phone: "628…@s.whatsapp.net", message },
 * header X-Device-Id bila GOWA memegang lebih dari satu perangkat.
 * Sukses: 200 { code: "SUCCESS", results: { message_id } }.
 */
export type GowaConfig = { url: string; user: string; password: string; deviceId: string };

export async function gowaSend(
  cfg: GowaConfig,
  nomor: string,
  pesan: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ messageId: string | null }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
  };
  if (cfg.deviceId) headers["x-device-id"] = cfg.deviceId;
  const res = await fetchImpl(`${cfg.url}/send/message`, {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: `${nomor}@s.whatsapp.net`, message: pesan }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => null)) as {
    code?: string;
    message?: string;
    results?: { message_id?: string } | null;
  } | null;
  if (!res.ok || body?.code !== "SUCCESS") {
    // Pesan error GOWA pendek (mis. "you are not loggin"); dibatasi agar log tetap ringkas.
    throw new Error(
      `GOWA ${res.status}: ${String(body?.message ?? "respons tidak dikenal").slice(0, 200)}`,
    );
  }
  return { messageId: body.results?.message_id ?? null };
}
