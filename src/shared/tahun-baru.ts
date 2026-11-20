import { z } from "zod";
import { tahunAjaranSchema } from "./sekolah";

export const KEPUTUSAN = ["naik", "tinggal", "lompat", "pindah", "lulus"] as const;
export type Keputusan = (typeof KEPUTUSAN)[number];
export const KEPUTUSAN_LABEL: Record<Keputusan, string> = {
  naik: "Naik",
  tinggal: "Tinggal kelas",
  lompat: "Lompat kelas",
  pindah: "Pindah sekolah",
  lulus: "Lulus",
};
/** Keputusan yang tetap belajar di tahun baru (butuh kelas tujuan). */
export const LANJUT: readonly Keputusan[] = ["naik", "tinggal", "lompat"];

const tanggal = z.iso.date();

export const tahunBaruSchema = z
  .object({
    tahunAjaran: tahunAjaranSchema,
    semester: z
      .array(z.object({ nomor: z.number().int().min(1).max(2), mulai: tanggal, selesai: tanggal }))
      .min(1)
      .max(2),
    keputusan: z
      .array(
        z.object({
          santriId: z.uuid(),
          status: z.enum(KEPUTUSAN),
          /** Kelas tahun lama yang strukturnya disalin; santri ditempatkan di salinannya. */
          kelasId: z.uuid().nullish(),
        }),
      )
      .max(5000),
  })
  .refine((v) => v.semester.every((s) => s.selesai > s.mulai), "Tanggal semester tidak valid")
  .refine(
    (v) =>
      v.semester.every((s) => s.mulai >= v.tahunAjaran.mulai && s.selesai <= v.tahunAjaran.selesai),
    "Semester harus berada di dalam tahun ajaran",
  )
  .refine(
    (v) => v.keputusan.every((k) => !LANJUT.includes(k.status) || !!k.kelasId),
    "Pilih kelas tujuan untuk santri yang naik/tinggal/lompat",
  );

export type UsulanTahunBaru = {
  taLama: { id: string; nama: string; mulai: string; selesai: string };
  usulan: {
    tahunAjaran: { nama: string; mulai: string; selesai: string };
    semester: { nomor: number; mulai: string; selesai: string }[];
  };
  /** Jumlah potongan/beasiswa tahun ini (disalin untuk santri yang tetap belajar). */
  potongan: number;
  kelas: {
    id: string;
    nama: string;
    tingkat: number;
    kelompok: string;
    unitKode: string;
    lokasiNama: string;
  }[];
  santri: {
    santriId: string;
    nama: string;
    nis: string;
    kelasId: string;
    status: Keputusan;
    kelasTujuanId: string | null;
  }[];
};
