import { z } from "zod";
import { GRANTABLE } from "./permissions";
import { normalizePhone } from "./phone";

export const phoneNumber = z.string().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) ctx.addIssue({ code: "custom", message: `Nomor HP tidak valid: ${v}` });
  return n ?? "";
});

export const password = z.string().min(8, "Password minimal 8 karakter").max(200);

export const loginSchema = z.object({
  nomor: z.string().min(1, "Nomor HP wajib diisi"),
  password: z.string().min(1, "Password wajib diisi").max(200),
  turnstileToken: z.string().min(1, "Selesaikan verifikasi keamanan"),
});

export const phoneEntry = z.object({
  nomor: phoneNumber,
  label: z.string().trim().max(30).nullish(),
  punyaWa: z.boolean().default(true),
  untukLogin: z.boolean().default(true),
});

const phones = z
  .array(phoneEntry)
  .min(1, "Minimal satu nomor HP")
  .max(5)
  .refine((list) => list.some((p) => p.untukLogin), "Minimal satu nomor untuk login")
  .refine((list) => new Set(list.map((p) => p.nomor)).size === list.length, "Nomor HP ganda");

const optionalText = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => v || null);

export const profileSchema = z.object({
  nama: z.string().trim().min(1, "Nama wajib diisi").max(120),
  namaPanggilan: optionalText,
  alamat: optionalText,
  phones,
});

export const changePasswordSchema = z.object({
  passwordLama: z.string().min(1, "Password lama wajib diisi"),
  passwordBaru: password,
});

export const userCreateSchema = profileSchema.extend({
  roleIds: z.array(z.uuid()).default([]),
});

export const userUpdateSchema = userCreateSchema.extend({
  status: z.enum(["aktif", "nonaktif"]),
});

export const roleSchema = z.object({
  nama: z.string().trim().min(1, "Nama jabatan wajib diisi").max(60),
  keterangan: optionalText,
  izin: z.array(z.enum(GRANTABLE)).default([]),
});

export type ProfileInput = z.input<typeof profileSchema>;
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserUpdateInput = z.input<typeof userUpdateSchema>;
export type RoleInput = z.input<typeof roleSchema>;

export const otpMintaSchema = z.object({
  nomor: z.string().min(1, "Nomor HP wajib diisi"),
  turnstileToken: z.string().min(1, "Selesaikan verifikasi keamanan"),
});

export const otpResetSchema = z.object({
  nomor: z.string().min(1, "Nomor HP wajib diisi"),
  kode: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "Kode terdiri dari 6 angka"),
  passwordBaru: password,
});
