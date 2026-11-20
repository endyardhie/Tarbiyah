import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, tz } from "./common";

export const users = pgTable("users", {
  id: id(),
  nama: text("nama").notNull(),
  namaPanggilan: text("nama_panggilan"),
  alamat: text("alamat"),
  passwordHash: text("password_hash").notNull(),
  status: text("status", { enum: ["aktif", "nonaktif"] })
    .notNull()
    .default("aktif"),
  wajibGantiPassword: boolean("wajib_ganti_password").notNull().default(false),
  // Persetujuan pemrosesan data pribadi (wali santri, saat login pertama; UU PDP).
  persetujuanAt: tz("persetujuan_at"),
  loginTerakhir: tz("login_terakhir"),
  dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  diubahAt: tz("diubah_at").notNull().defaultNow(),
});

export const userPhones = pgTable(
  "user_phones",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    nomor: text("nomor").notNull().unique(),
    label: text("label"),
    punyaWa: boolean("punya_wa").notNull().default(true),
    untukLogin: boolean("untuk_login").notNull().default(true),
  },
  (t) => [index("user_phones_user_idx").on(t.userId)],
);

export const roles = pgTable(
  "roles",
  {
    id: id(),
    nama: text("nama").notNull().unique(),
    keterangan: text("keterangan"),
    // Jabatan admin: lolos semua izin. Hanya boleh ada satu.
    admin: boolean("admin").notNull().default(false),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("roles_satu_admin").on(t.admin).where(sql`${t.admin}`)],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    izin: text("izin").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.izin] })],
);

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    perangkat: text("perangkat"),
    ip: text("ip"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
    terakhirAktif: tz("terakhir_aktif").notNull().defaultNow(),
    kedaluwarsa: tz("kedaluwarsa").notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  jumlah: integer("jumlah").notNull(),
  resetAt: tz("reset_at").notNull(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    aksi: text("aksi").notNull(),
    entitas: text("entitas").notNull(),
    entitasId: text("entitas_id"),
    sebelum: jsonb("sebelum"),
    sesudah: jsonb("sesudah"),
    ip: text("ip"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_waktu_idx").on(t.dibuatAt),
    index("audit_log_entitas_idx").on(t.entitas, t.entitasId),
  ],
);
