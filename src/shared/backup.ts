import { z } from "zod";
import { internalUrl, type SecretFlag, secretInput } from "./keuangan";

export const pengaturanBackupSchema = z.object({
  intervalHari: z.number().int().min(1).max(30),
  simpanDiServer: z.number().int().min(1).max(50),
  b2Aktif: z.boolean(),
  endpoint: internalUrl,
  region: z.string().trim().max(50),
  bucket: z.string().trim().max(100),
  keyId: z.string().trim().max(100),
  appKey: secretInput,
});
export type PengaturanBackupView = Omit<z.output<typeof pengaturanBackupSchema>, "appKey"> & {
  appKey: SecretFlag;
};

export type BackupRow = {
  id: string;
  nama: string;
  jenis: "otomatis" | "manual" | "pra_restore" | "unggahan" | "dari_b2";
  status: "berjalan" | "berhasil" | "gagal";
  ukuran: number | null;
  versiSkema: number | null;
  versiAplikasi: string | null;
  adaDiServer: boolean;
  b2Key: string | null;
  b2At: string | null;
  error: string | null;
  dibuatAt: string;
  selesaiAt: string | null;
};

export type StatusPemeliharaan = {
  aktif: boolean;
  tahap: string | null;
  mulaiAt: string | null;
  selesaiAt: string | null;
  gagal: boolean;
  pesan: string | null;
};
