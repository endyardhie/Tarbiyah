import { createHmac, timingSafeEqual } from "node:crypto";
import type { PaymentProvider, PaymentState, PayStatus } from "./types";

/**
 * Adapter noken-pay (QRIS dinamis).
 * - POST /v1/payments  { amount, external_id, callback_url, ref?, expiry_s? } → 201 payment
 * - GET  /v1/payments/:id → payment (status pending | paid | expired | canceled)
 * - Webhook payment.paid: header X-Noken-Timestamp (detik) & X-Noken-Signature =
 *   hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`); tolak selisih waktu > 300 detik.
 */
export type NokenPayConfig = { url: string; apiKey: string; webhookSecret: string };

type NokenPayment = {
  id: string;
  external_id: string;
  status: "pending" | "paid" | "expired" | "canceled";
  base_amount: number;
  charged_amount: number;
  qris: string | null;
  expires_at: string | null;
  paid_at: string | null;
};

const STATUS: Record<NokenPayment["status"], PayStatus> = {
  pending: "menunggu",
  paid: "lunas",
  expired: "kedaluwarsa",
  canceled: "batal",
};

const MAX_SKEW_SEC = 300;

function toState(p: NokenPayment): PaymentState {
  const status = STATUS[p.status];
  if (!p.id || !status || !Number.isInteger(p.base_amount)) {
    throw new Error("Respons noken-pay tidak dikenal");
  }
  return {
    providerRef: p.id,
    externalId: p.external_id,
    status,
    jumlah: p.base_amount,
    jumlahBayar: p.charged_amount,
    qris: p.qris ?? null,
    kedaluwarsaAt: p.expires_at ? new Date(p.expires_at) : null,
    dibayarAt: p.paid_at ? new Date(p.paid_at) : null,
  };
}

export function nokenSignature(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function createNokenPay(
  cfg: NokenPayConfig,
  fetchImpl: typeof fetch = fetch,
): PaymentProvider {
  async function call(method: string, path: string, body?: unknown): Promise<NokenPayment> {
    const res = await fetchImpl(`${cfg.url}${path}`, {
      method,
      headers: { "x-api-key": cfg.apiKey, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as (NokenPayment & { error?: string }) | null;
    if (!res.ok || !json) {
      throw new Error(`noken-pay ${res.status}: ${String(json?.error ?? "gagal").slice(0, 200)}`);
    }
    return json;
  }

  return {
    name: "noken-pay",
    async createCharge(input) {
      return toState(
        await call("POST", "/v1/payments", {
          amount: input.amount,
          external_id: input.externalId,
          callback_url: input.callbackUrl,
          // ref: 1–25 karakter ASCII biasa (huruf khusus membuat QR tak bisa dibayar).
          ref: input.ref?.replace(/[^\x20-\x7e]/g, "").slice(0, 25) || undefined,
          expiry_s: input.expirySeconds,
        }),
      );
    },
    verifyWebhook(headers, rawBody, now = new Date()) {
      const ts = headers.get("x-noken-timestamp") ?? "";
      const sig = headers.get("x-noken-signature") ?? "";
      if (!cfg.webhookSecret || !/^\d+$/.test(ts) || !/^[0-9a-f]{64}$/i.test(sig)) return false;
      if (Math.abs(now.getTime() / 1000 - Number(ts)) > MAX_SKEW_SEC) return false;
      const expected = Buffer.from(nokenSignature(cfg.webhookSecret, ts, rawBody), "hex");
      return timingSafeEqual(expected, Buffer.from(sig, "hex"));
    },
    parseWebhook(rawBody) {
      const body = JSON.parse(rawBody) as { event?: string; payment?: NokenPayment };
      if (!body.event || !body.payment) throw new Error("Webhook noken-pay tidak dikenal");
      // Bisa terkirim lebih dari sekali: idempoten per event + id pembayaran.
      return { eventId: `${body.event}:${body.payment.id}`, state: toState(body.payment) };
    },
    async getStatus(providerRef) {
      return toState(await call("GET", `/v1/payments/${encodeURIComponent(providerRef)}`));
    },
  };
}
