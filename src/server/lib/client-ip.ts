import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

/**
 * IP klien: CF-Connecting-IP hanya bila trafik pasti lewat Cloudflare, selain itu alamat socket.
 * X-Forwarded-For sengaja tidak dipakai karena bisa dipalsukan.
 */
export function clientIp(c: Context, trustCloudflare: boolean): string {
  if (trustCloudflare) {
    const cf = c.req.header("cf-connecting-ip");
    if (cf) return cf;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
