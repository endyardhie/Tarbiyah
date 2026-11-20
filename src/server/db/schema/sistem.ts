import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tz } from "./common";
import { users } from "./identitas";

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  // Secret disimpan sebagai { iv, tag, data } hasil AES-256-GCM; terenkripsi + versi_kunci menandainya.
  value: jsonb("value").notNull(),
  terenkripsi: boolean("terenkripsi").notNull().default(false),
  versiKunci: integer("versi_kunci"),
  diubahAt: timestamp("diubah_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Semua berkas di DATA_DIR tercatat di sini. Path acak, tidak pernah ditimpa. */
export const berkas = pgTable(
  "berkas",
  {
    id: id(),
    namaAsli: text("nama_asli").notNull(),
    path: text("path").notNull().unique(),
    ukuran: bigint("ukuran", { mode: "number" }).notNull(),
    tipe: text("tipe").notNull(),
    rujukanTipe: text("rujukan_tipe"), // mis. "logo", "tugas"
    rujukanId: text("rujukan_id"),
    publik: boolean("publik").notNull().default(false),
    dibuatOleh: uuid("dibuat_oleh").references(() => users.id),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
    dibackupAt: tz("dibackup_at"),
  },
  (t) => [index("berkas_rujukan_idx").on(t.rujukanTipe, t.rujukanId)],
);

/** Riwayat backup database (lapis 1). Isinya juga ditulis ke manifest JSON di samping dump. */
export const backupFile = pgTable(
  "backup_file",
  {
    id: id(),
    nama: text("nama").notNull().unique(), // "tarbiyah-20261120-0200"
    jenis: text("jenis", {
      enum: ["otomatis", "manual", "pra_restore", "unggahan", "dari_b2"],
    }).notNull(),
    status: text("status", { enum: ["berjalan", "berhasil", "gagal"] })
      .notNull()
      .default("berjalan"),
    ukuran: bigint("ukuran", { mode: "number" }),
    versiSkema: integer("versi_skema"),
    versiAplikasi: text("versi_aplikasi"),
    adaDiServer: boolean("ada_di_server").notNull().default(false),
    b2Key: text("b2_key"),
    b2At: tz("b2_at"),
    error: text("error"),
    dibuatOleh: uuid("dibuat_oleh").references(() => users.id, { onDelete: "set null" }),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
    selesaiAt: tz("selesai_at"),
  },
  (t) => [index("backup_file_waktu_idx").on(t.dibuatAt)],
);
