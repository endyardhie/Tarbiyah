import { z } from "zod";
import { phoneEntry } from "./schemas";

const text = (label: string, max = 120) =>
  z.string().trim().min(1, `${label} wajib diisi`).max(max);
const optional = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const tanggal = z.iso.date("Tanggal tidak valid (format YYYY-MM-DD)");
const ref = z.uuid("Pilihan tidak valid");
const optionalRef = z
  .union([z.uuid(), z.literal(""), z.null()])
  .optional()
  .transform((v) => v || null);

export const lokasiSchema = z.object({
  nama: text("Nama lokasi", 60),
  alamat: optional(),
  aktif: z.boolean().default(true),
});

export const unitSchema = z.object({
  kode: text("Kode unit", 12).transform((v) => v.toUpperCase()),
  nama: text("Nama unit"),
  urutan: z.coerce.number().int().min(0).max(99).default(0),
  aktif: z.boolean().default(true),
});

export const tahunAjaranSchema = z
  .object({
    nama: z
      .string()
      .trim()
      .regex(/^\d{4}\/\d{4}$/, "Nama tahun ajaran seperti 2026/2027"),
    mulai: tanggal,
    selesai: tanggal,
  })
  .refine((v) => v.selesai > v.mulai, { message: "Tanggal selesai harus setelah mulai" });

export const semesterSchema = z
  .object({
    tahunAjaranId: ref,
    nomor: z.coerce.number().int().min(1).max(2),
    mulai: tanggal,
    selesai: tanggal,
  })
  .refine((v) => v.selesai > v.mulai, { message: "Tanggal selesai harus setelah mulai" });

export const KELOMPOK = ["banin", "banat", "campur"] as const;
export const kelasSchema = z.object({
  tahunAjaranId: ref,
  unitId: ref,
  lokasiId: ref,
  nama: text("Nama kelas", 60),
  tingkat: z.coerce.number().int().min(0, "Tingkat 0–20").max(20, "Tingkat 0–20"),
  kelompok: z.enum(KELOMPOK).default("campur"),
  waliKelasId: optionalRef,
  aktif: z.boolean().default(true),
});

export const mapelSchema = z.object({
  nama: text("Nama mapel", 80),
  namaArab: optional(80),
  kode: optional(20),
  unitId: optionalRef,
  aktif: z.boolean().default(true),
});

export const pengajaranSchema = z.object({
  kelasId: ref,
  mapelId: ref,
  guruId: ref,
  kkm: z
    .union([z.coerce.number().int().min(0).max(100), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

const jam = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Jam seperti 07:30");
export const jadwalSchema = z
  .object({
    pengajaranId: ref,
    hari: z.coerce.number().int().min(1).max(7),
    jamMulai: jam,
    jamSelesai: jam,
  })
  .refine((v) => v.jamSelesai > v.jamMulai, { message: "Jam selesai harus setelah jam mulai" });

export const STATUS_SANTRI = ["aktif", "lulus", "pindah", "keluar"] as const;
export const santriSchema = z.object({
  nis: text("NIS", 30),
  nama: text("Nama santri"),
  namaPanggilan: optional(40),
  jenisKelamin: z
    .union([z.enum(["L", "P"]), z.literal(""), z.null()])
    .optional()
    .transform((v) => v || null),
  tempatLahir: optional(60),
  tanggalLahir: z
    .union([tanggal, z.literal(""), z.null()])
    .optional()
    .transform((v) => v || null),
  alamat: optional(),
  status: z.enum(STATUS_SANTRI).default("aktif"),
  /** Kelas tahun ajaran mana pun; pendaftaran dibuat/diubah untuk tahun ajaran kelas itu. */
  kelasId: optionalRef,
});

export const HUBUNGAN = ["ayah", "ibu", "wali"] as const;
export const santriWaliSchema = z.object({
  santriId: ref,
  userId: ref,
  hubungan: z.enum(HUBUNGAN).default("wali"),
  penerimaTagihan: z.boolean().default(true),
});

export const waliSchema = z.object({
  nama: text("Nama wali"),
  alamat: optional(),
  phones: z
    .array(phoneEntry)
    .min(1, "Minimal satu nomor HP")
    .max(5)
    .refine((l) => l.some((p) => p.untukLogin), "Minimal satu nomor untuk login"),
});

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("id-ID", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};
export const ZONA_WAKTU = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const;
export const identitasSchema = z.object({
  nama: text("Nama lembaga"),
  namaSingkat: text("Nama singkat", 12),
  alamat: optional(),
  zonaWaktu: z.string().refine(isTimeZone, "Zona waktu tidak dikenal"),
});

export type Identitas = z.output<typeof identitasSchema> & {
  logoId: string | null;
  ikon192Id: string | null;
  ikon512Id: string | null;
  ikonMaskableId: string | null;
};

/** Kolom template CSV impor santri + wali. */
export const KOLOM_IMPOR = [
  "nis",
  "nama",
  "nama_panggilan",
  "jenis_kelamin",
  "tempat_lahir",
  "tanggal_lahir",
  "alamat",
  "unit",
  "lokasi",
  "kelas",
  "wali1_nama",
  "wali1_hubungan",
  "wali1_hp",
  "wali2_nama",
  "wali2_hubungan",
  "wali2_hp",
] as const;
export type BarisImpor = Partial<Record<(typeof KOLOM_IMPOR)[number], string>>;

export const imporSchema = z.object({
  tahunAjaranId: ref,
  rows: z
    .array(z.record(z.string(), z.string().max(500)))
    .min(1, "File CSV kosong")
    .max(2000, "Maksimal 2000 baris per impor"),
});
