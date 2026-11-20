import type { z } from "zod";
import type {
  PAYMENT_PROVIDERS,
  PengaturanPembayaranView,
  pengaturanPembayaranSchema,
} from "../../shared/keuangan";
import type { Db, Tx } from "../db/client";
import { decryptSecret, type Encrypted, encryptSecret } from "../lib/crypto";
import { readSetting, writeSetting } from "../services/pengaturan";
import { createNokenPay } from "./noken-pay";
import type { PaymentProvider } from "./types";

type ProviderName = (typeof PAYMENT_PROVIDERS)[number];
type Stored = {
  aktif: boolean;
  provider: ProviderName;
  url: string;
  apiKey: Encrypted | null;
  webhookSecret: Encrypted | null;
  urlWebhook: string;
  kedaluwarsaMenit: number;
};
const DEFAULT: Stored = {
  aktif: false,
  provider: "noken-pay",
  url: "",
  apiKey: null,
  webhookSecret: null,
  urlWebhook: "",
  kedaluwarsaMenit: 15,
};

type Secrets = { url: string; apiKey: string; webhookSecret: string };
const ADAPTERS: Record<ProviderName, (s: Secrets, f: typeof fetch) => PaymentProvider> = {
  "noken-pay": (s, f) => createNokenPay(s, f),
};

export async function getPembayaranView(db: Db): Promise<PengaturanPembayaranView> {
  const { apiKey, webhookSecret, ...rest } = await readSetting(db, "pembayaran", DEFAULT);
  return { ...rest, apiKey: { terisi: !!apiKey }, webhookSecret: { terisi: !!webhookSecret } };
}

export async function savePembayaran(
  tx: Db | Tx,
  input: z.output<typeof pengaturanPembayaranSchema>,
  encryptionKey: string,
) {
  const before = await readSetting(tx, "pembayaran", DEFAULT);
  const { apiKey, webhookSecret, ...rest } = input;
  const value: Stored = {
    ...rest,
    apiKey: apiKey ? encryptSecret(apiKey, encryptionKey) : before.apiKey,
    webhookSecret: webhookSecret
      ? encryptSecret(webhookSecret, encryptionKey)
      : before.webhookSecret,
  };
  await writeSetting(tx, "pembayaran", value, true);
}

export type ActiveProvider = {
  provider: PaymentProvider;
  aktif: boolean;
  urlWebhook: string;
  kedaluwarsaMenit: number;
};

/**
 * Adapter sesuai pengaturan. `name` diisi untuk webhook: adapter tetap dibuat walau pembayaran
 * dinonaktifkan, agar pembayaran yang sudah terlanjur masuk tetap tercatat.
 */
export async function getProvider(
  db: Db,
  cfg: { encryptionKey: string; appUrl: string },
  opts: { name?: string; fetch?: typeof fetch } = {},
): Promise<ActiveProvider | null> {
  const s = await readSetting(db, "pembayaran", DEFAULT);
  if (opts.name && opts.name !== s.provider) return null;
  if (!s.url) return null;
  const open = (e: Encrypted | null) => (e ? decryptSecret(e, cfg.encryptionKey) : "");
  const provider = ADAPTERS[s.provider](
    { url: s.url, apiKey: open(s.apiKey), webhookSecret: open(s.webhookSecret) },
    opts.fetch ?? fetch,
  );
  return {
    provider,
    aktif: s.aktif,
    urlWebhook: s.urlWebhook || `${cfg.appUrl}/api/webhooks/${s.provider}`,
    kedaluwarsaMenit: s.kedaluwarsaMenit,
  };
}
