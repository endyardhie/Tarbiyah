import { z } from "zod";

export const JENIS = ["PR", "tugas", "UH", "UTS", "UAS", "praktik"] as const;
export type Jenis = (typeof JENIS)[number];
export const JENIS_LABEL: Record<Jenis, string> = {
  PR: "PR",
  tugas: "Tugas",
  UH: "Ulangan harian",
  UTS: "UTS",
  UAS: "UAS",
  praktik: "Praktik",
};

/** Bawaan rancangan: harian 40% (PR 10 + tugas 10 + UH 20), UTS 25%, UAS 35%. */
export const DEFAULT_BOBOT: Record<Jenis, number> = {
  PR: 10,
  tugas: 10,
  UH: 20,
  praktik: 0,
  UTS: 25,
  UAS: 35,
};
export const DEFAULT_SKALA = [
  { predikat: "A", min: 90, deskripsi: "Sangat baik dalam menguasai materi {mapel}." },
  { predikat: "B", min: 80, deskripsi: "Baik dalam menguasai materi {mapel}." },
  { predikat: "C", min: 70, deskripsi: "Cukup dalam menguasai materi {mapel}." },
  { predikat: "D", min: 0, deskripsi: "Perlu bimbingan dalam materi {mapel}." },
];

const round = (n: number) => Math.round(n);

/**
 * Nilai rapor otomatis = rata-rata tiap jenis × bobotnya, dibagi total bobot jenis yang sudah ada nilainya
 * (mis. sebelum UAS, bobot UAS tidak dihitung). Dibulatkan ke bilangan bulat.
 */
export function nilaiBerbobot(
  perJenis: Partial<Record<Jenis, number[]>>,
  bobot: Record<Jenis, number>,
) {
  let sum = 0;
  let total = 0;
  for (const j of JENIS) {
    const list = perJenis[j];
    const w = bobot[j] ?? 0;
    if (!list?.length || !w) continue;
    sum += (list.reduce((a, b) => a + b, 0) / list.length) * w;
    total += w;
  }
  return total ? round(sum / total) : null;
}

export type Skala = { predikat: string; min: number; deskripsi: string };

/** Predikat untuk nilai: baris dengan min tertinggi yang ≤ nilai. */
export function predikatDari(nilai: number | null, skala: Skala[], mapel = "") {
  if (nilai == null) return null;
  const s = [...skala].sort((a, b) => b.min - a.min).find((x) => nilai >= x.min);
  return s ? { predikat: s.predikat, deskripsi: s.deskripsi.replaceAll("{mapel}", mapel) } : null;
}

const tanggal = z.iso.date("Tanggal tidak valid");
const teks = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const tugasSchema = z.object({
  pengajaranId: z.uuid(),
  judul: z.string().trim().min(1, "Judul wajib diisi").max(150),
  deskripsi: teks(5000),
  tanggalDiberi: tanggal,
  tenggat: z
    .union([tanggal, z.literal(""), z.null()])
    .optional()
    .transform((v) => v || null),
});

export const penilaianSchema = z.object({
  pengajaranId: z.uuid(),
  semesterId: z.uuid().optional(),
  jenis: z.enum(JENIS),
  judul: z.string().trim().min(1, "Judul wajib diisi").max(100),
  tanggal,
});

const angka = z.number().min(0, "Nilai 0–100").max(100, "Nilai 0–100");
export const nilaiSchema = z.object({
  items: z.array(z.object({ pendaftaranId: z.uuid(), nilai: angka.nullable() })).max(200),
});

export const pengaturanUnitSchema = z.object({
  bobot: z
    .record(z.enum(JENIS), z.number().int().min(0).max(100))
    .refine((b) => Object.values(b).reduce((a, x) => a + x, 0) === 100, "Total bobot harus 100%"),
  skala: z
    .array(
      z.object({
        predikat: z.string().trim().min(1).max(5),
        min: angka,
        deskripsi: z.string().trim().max(300).default(""),
      }),
    )
    .min(1, "Minimal satu predikat")
    .max(10)
    .refine((s) => s.some((x) => x.min === 0), "Harus ada predikat dengan nilai minimal 0")
    .refine((s) => new Set(s.map((x) => x.predikat)).size === s.length, "Predikat ganda"),
  aspek: z
    .array(
      z.object({
        id: z.uuid().optional(),
        kelompok: z.string().trim().min(1).max(60),
        nama: z.string().trim().min(1).max(80),
        tipe: z.enum(["predikat", "angka", "teks"]),
        aktif: z.boolean().default(true),
      }),
    )
    .max(40),
});

export const raporMapelSchema = z.object({
  pengajaranId: z.uuid(),
  semesterId: z.uuid(),
  items: z
    .array(
      z.object({
        pendaftaranId: z.uuid(),
        /** null = pakai nilai otomatis */
        nilaiAkhir: angka.nullable(),
        deskripsi: teks(500),
      }),
    )
    .max(200),
});

export const raporKelasSchema = z.object({
  semesterId: z.uuid(),
  aspek: z.array(z.object({ aspekId: z.uuid(), nilai: teks(300) })).max(40),
  catatanWali: teks(1000),
  keputusan: z
    .enum(["naik", "tinggal"])
    .nullish()
    .transform((v) => v ?? null),
});

export const kunciSchema = z.object({
  kelasId: z.uuid(),
  semesterId: z.uuid(),
  pendaftaranIds: z.array(z.uuid()).max(200).optional(),
});

export const templateSchema = z.object({
  nama: z.string().trim().min(1).max(80),
  html: z.string().max(100_000),
  css: z.string().max(50_000),
});
