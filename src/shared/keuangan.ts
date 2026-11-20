import { z } from "zod";

export const BULAN = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
] as const;

export const periodeSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Periode tidak valid");

/** "2026-11" → "November 2026" */
export function labelPeriode(periode: string) {
  const [y, m] = periode.split("-").map(Number) as [number, number];
  return `${BULAN[m - 1]} ${y}`;
}

/** 150000 → "Rp 150.000" */
export function formatRupiah(n: number) {
  return `Rp ${new Intl.NumberFormat("id-ID").format(n)}`;
}

/** Nominal setelah potongan (tidak pernah negatif). Persen dibulatkan ke rupiah terdekat. */
export function hitungPotongan(
  nominal: number,
  p: { jenis: "nominal" | "persen"; nilai: number } | null | undefined,
) {
  if (!p) return 0;
  const pot = p.jenis === "persen" ? Math.round((nominal * p.nilai) / 100) : p.nilai;
  return Math.min(nominal, Math.max(0, pot));
}

/** Isi template pesan WA: {{nama_santri}} dst. Teks biasa (bukan HTML), placeholder asing dibiarkan. */
export function isiTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}

export const TEMPLATE_BUKTI_PLACEHOLDER = [
  "nama_santri",
  "bulan",
  "jumlah",
  "metode",
  "tanggal",
  "nama_lembaga",
] as const;

export const DEFAULT_TEMPLATE_BUKTI = `Assalamu'alaikum. Terima kasih, pembayaran SPP telah kami terima.

Nama: {{nama_santri}}
Bulan: {{bulan}}
Jumlah: {{jumlah}}
Metode: {{metode}}
Tanggal: {{tanggal}}

{{nama_lembaga}}`;

export const METODE_LABEL = { tunai: "Tunai", transfer: "Transfer", gateway: "QRIS" } as const;

export const pengaturanKeuanganSchema = z.object({
  bulanDitagih: z
    .array(z.number().int().min(1).max(12))
    .max(12)
    .transform((a) => [...new Set(a)].sort((x, y) => x - y)),
  tanggalJatuhTempo: z.number().int().min(1).max(28),
  templateBukti: z.string().trim().min(1, "Template pesan wajib diisi").max(1000),
});
export type PengaturanKeuangan = z.output<typeof pengaturanKeuanganSchema>;

export const DEFAULT_KEUANGAN: PengaturanKeuangan = {
  bulanDitagih: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  tanggalJatuhTempo: 10,
  templateBukti: DEFAULT_TEMPLATE_BUKTI,
};

const secretInput = z
  .string()
  .max(500)
  .optional()
  .transform((v) => v || undefined); // kosong = tidak diubah

const internalUrl = z
  .string()
  .trim()
  .max(300)
  .refine(
    (v) => v === "" || /^https?:\/\/[^\s]+$/.test(v),
    "URL harus diawali http:// atau https://",
  )
  .transform((v) => v.replace(/\/+$/, ""));

export const pengaturanWaSchema = z.object({
  aktif: z.boolean(),
  url: internalUrl,
  user: z.string().trim().max(200),
  password: secretInput,
  deviceId: z.string().trim().max(100),
  jedaDetik: z.number().int().min(1).max(120),
});
export type PengaturanWaInput = z.input<typeof pengaturanWaSchema>;

export const PAYMENT_PROVIDERS = ["noken-pay"] as const;
export const pengaturanPembayaranSchema = z.object({
  aktif: z.boolean(),
  provider: z.enum(PAYMENT_PROVIDERS),
  url: internalUrl,
  apiKey: secretInput,
  webhookSecret: secretInput,
  // Alamat webhook yang dipanggil provider; kosong = APP_URL/api/webhooks/<provider>.
  urlWebhook: internalUrl,
  kedaluwarsaMenit: z.number().int().min(5).max(120),
});

/** Bentuk yang dikirim ke browser: secret hanya { terisi }. */
export type SecretFlag = { terisi: boolean };
export type PengaturanWaView = Omit<z.output<typeof pengaturanWaSchema>, "password"> & {
  password: SecretFlag;
};
export type PengaturanPembayaranView = Omit<
  z.output<typeof pengaturanPembayaranSchema>,
  "apiKey" | "webhookSecret"
> & { apiKey: SecretFlag; webhookSecret: SecretFlag };

export const tarifSchema = z.object({
  unitId: z.uuid(),
  lokasiId: z.uuid(),
  nominal: z.number().int().min(0).max(100_000_000),
});

export const potonganSchema = z
  .object({
    santriId: z.uuid(),
    jenis: z.enum(["nominal", "persen"]),
    nilai: z.number().int().min(0).max(100_000_000),
    alasan: z.string().trim().min(1, "Alasan wajib diisi").max(200),
  })
  .refine((p) => p.jenis !== "persen" || p.nilai <= 100, "Persen maksimal 100");

export const bayarManualSchema = z.object({
  metode: z.enum(["tunai", "transfer"]),
  catatan: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((v) => v || null),
});

export const batalSchema = z.object({
  alasan: z.string().trim().min(3, "Alasan pembatalan wajib diisi").max(200),
});

export const bayarOnlineSchema = z.object({
  tagihanIds: z.array(z.uuid()).min(1, "Pilih minimal satu tagihan").max(12),
});

export type TagihanRow = {
  id: string;
  santriId: string;
  santriNama: string;
  nis: string;
  kelasNama: string;
  unitKode: string;
  lokasiNama: string;
  periode: string;
  nominal: number;
  potongan: number;
  total: number;
  jatuhTempo: string;
  status: "belum" | "lunas" | "batal";
  alasanBatal: string | null;
  lunasAt: string | null;
  pembayaran: {
    id: string;
    metode: keyof typeof METODE_LABEL;
    dibayarAt: string;
    buktiWaDikirimAt: string | null;
  } | null;
};
