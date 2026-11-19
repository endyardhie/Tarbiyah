import { z } from "zod";

export const STATUS_PRESENSI = ["H", "S", "I", "A"] as const;
export type StatusPresensi = (typeof STATUS_PRESENSI)[number];

const tanggal = z.iso.date("Tanggal tidak valid");

export const simpanPresensiSchema = z.object({
  kelasId: z.uuid(),
  tanggal,
  items: z
    .array(
      z.object({
        pendaftaranId: z.uuid(),
        status: z.enum(STATUS_PRESENSI),
        keterangan: z.string().trim().max(200).nullish(),
      }),
    )
    .min(1, "Daftar santri kosong")
    .max(200),
});

export const sasaranSchema = z.object({
  unitId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  lokasiId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
  kelasId: z
    .uuid()
    .nullish()
    .transform((v) => v ?? null),
});

export const agendaSchema = z
  .object({
    judul: z.string().trim().min(1, "Judul wajib diisi").max(120),
    deskripsi: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((v) => v || null),
    mulai: tanggal,
    selesai: tanggal,
    libur: z.boolean().default(false),
    sasaran: z.array(sasaranSchema).min(1, "Pilih minimal satu sasaran").max(30),
  })
  .refine((v) => v.selesai >= v.mulai, { message: "Tanggal selesai tidak boleh sebelum mulai" });

export const pengumumanSchema = z.object({
  judul: z.string().trim().min(1, "Judul wajib diisi").max(120),
  isi: z.string().trim().min(1, "Isi wajib diisi").max(5000),
  sasaran: z.array(sasaranSchema).min(1, "Pilih minimal satu sasaran").max(30),
  kirimNotifikasi: z.boolean().default(true),
});

export const langgananSchema = z.object({
  endpoint: z.url().refine((u) => u.startsWith("https://"), "Endpoint push harus https"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});
