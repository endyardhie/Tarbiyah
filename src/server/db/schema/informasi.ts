import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { id, tz } from "./common";
import { users } from "./identitas";

export const pengumuman = pgTable(
  "pengumuman",
  {
    id: id(),
    judul: text("judul").notNull(),
    isi: text("isi").notNull(),
    pengirimId: uuid("pengirim_id")
      .notNull()
      .references(() => users.id),
    kirimNotifikasi: boolean("kirim_notifikasi").notNull().default(true),
    dikirimAt: tz("dikirim_at").notNull().defaultNow(),
  },
  (t) => [index("pengumuman_waktu_idx").on(t.dikirimAt)],
);

/** Kotak masuk per pengguna. pengirim kosong = "Sistem". */
export const notifikasi = pgTable(
  "notifikasi",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    jenis: text("jenis").notNull(),
    judul: text("judul").notNull(),
    isi: text("isi").notNull(),
    url: text("url"),
    pengirimId: uuid("pengirim_id").references(() => users.id),
    dibacaAt: tz("dibaca_at"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifikasi_user_waktu_idx").on(t.userId, t.dibuatAt),
    index("notifikasi_belum_dibaca_idx").on(t.userId).where(sql`${t.dibacaAt} is null`),
  ],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    perangkat: text("perangkat"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);
