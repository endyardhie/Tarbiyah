/** Status pembayaran di sisi TARBIYAH, apa pun istilah provider-nya. */
export type PayStatus = "menunggu" | "lunas" | "kedaluwarsa" | "batal";

/** Keadaan satu transaksi di provider (dari createCharge, webhook, atau getStatus). */
export type PaymentState = {
  providerRef: string;
  /** Id intent TARBIYAH yang dikirim saat createCharge. */
  externalId: string;
  status: PayStatus;
  /** Nominal tagihan yang diminta (tanpa kode unik); dibandingkan dengan total intent. */
  jumlah: number;
  /** Nominal yang dibayar/harus dibayar di QRIS. */
  jumlahBayar: number;
  qris: string | null;
  kedaluwarsaAt: Date | null;
  dibayarAt: Date | null;
};

export type ChargeInput = {
  externalId: string;
  amount: number;
  callbackUrl: string;
  /** Teks pendek yang tampil di aplikasi pembayar. */
  ref?: string;
  expirySeconds?: number;
};

export type WebhookEvent = { eventId: string; state: PaymentState };

export interface PaymentProvider {
  readonly name: string;
  createCharge(input: ChargeInput): Promise<PaymentState>;
  /** Tanda tangan dari body mentah (sebelum di-parse). */
  verifyWebhook(headers: Headers, rawBody: string, now?: Date): boolean;
  parseWebhook(rawBody: string): WebhookEvent;
  getStatus(providerRef: string): Promise<PaymentState>;
}
