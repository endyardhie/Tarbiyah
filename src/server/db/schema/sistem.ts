import { boolean, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  // Secret disimpan sebagai { iv, tag, data } hasil AES-256-GCM; terenkripsi + versi_kunci menandainya.
  value: jsonb("value").notNull(),
  terenkripsi: boolean("terenkripsi").notNull().default(false),
  versiKunci: integer("versi_kunci"),
  diubahAt: timestamp("diubah_at", { withTimezone: true }).notNull().defaultNow(),
});
