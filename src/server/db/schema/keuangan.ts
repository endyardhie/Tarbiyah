import { sql } from "drizzle-orm";
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tz } from "./common";
import { users } from "./identitas";
import { lokasi, pendaftaran, santri, tahunAjaran, units } from "./sekolah";

const rupiah = (name: string) => bigint(name, { mode: "number" });

export const tarifSpp = pgTable(
  "tarif_spp",
  {
    id: id(),
    tahunAjaranId: uuid("tahun_ajaran_id")
      .notNull()
      .references(() => tahunAjaran.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    lokasiId: uuid("lokasi_id")
      .notNull()
      .references(() => lokasi.id),
    nominal: rupiah("nominal").notNull(),
  },
  (t) => [unique("tarif_spp_unik").on(t.tahunAjaranId, t.unitId, t.lokasiId)],
);

/** Potongan/beasiswa SPP per santri per tahun ajaran: nominal rupiah atau persen (0–100). */
export const potongan = pgTable(
  "potongan",
  {
    id: id(),
    santriId: uuid("santri_id")
      .notNull()
      .references(() => santri.id),
    tahunAjaranId: uuid("tahun_ajaran_id")
      .notNull()
      .references(() => tahunAjaran.id),
    jenis: text("jenis", { enum: ["nominal", "persen"] }).notNull(),
    nilai: rupiah("nilai").notNull(),
    alasan: text("alasan").notNull(),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [unique("potongan_unik").on(t.santriId, t.tahunAjaranId)],
);

export const tagihan = pgTable(
  "tagihan",
  {
    id: id(),
    santriId: uuid("santri_id")
      .notNull()
      .references(() => santri.id),
    pendaftaranId: uuid("pendaftaran_id")
      .notNull()
      .references(() => pendaftaran.id),
    // Disiapkan untuk tagihan non-SPP nanti; MVP hanya "spp".
    jenis: text("jenis").notNull().default("spp"),
    periode: text("periode").notNull(), // "2026-11"
    nominal: rupiah("nominal").notNull(),
    potongan: rupiah("potongan").notNull().default(0),
    total: rupiah("total").notNull(),
    jatuhTempo: date("jatuh_tempo").notNull(),
    status: text("status", { enum: ["belum", "lunas", "batal"] })
      .notNull()
      .default("belum"),
    alasanBatal: text("alasan_batal"),
    dibatalkanOleh: uuid("dibatalkan_oleh").references(() => users.id),
    lunasAt: tz("lunas_at"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [
    unique("tagihan_unik").on(t.santriId, t.jenis, t.periode),
    index("tagihan_periode_idx").on(t.periode, t.status),
  ],
);

export const paymentIntent = pgTable(
  "payment_intent",
  {
    id: id(),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref").unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    total: rupiah("total").notNull(),
    // Nominal yang harus dibayar di QRIS (bisa + kode unik kecil dari provider).
    jumlahBayar: rupiah("jumlah_bayar"),
    status: text("status", { enum: ["menunggu", "lunas", "kedaluwarsa", "batal", "selisih"] })
      .notNull()
      .default("menunggu"),
    qris: text("qris"),
    kedaluwarsaAt: tz("kedaluwarsa_at"),
    lunasAt: tz("lunas_at"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [index("payment_intent_status_idx").on(t.status)],
);

export const paymentIntentItem = pgTable(
  "payment_intent_item",
  {
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntent.id),
    tagihanId: uuid("tagihan_id")
      .notNull()
      .references(() => tagihan.id),
    nominal: rupiah("nominal").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.intentId, t.tagihanId] }),
    index("payment_intent_item_tagihan_idx").on(t.tagihanId),
  ],
);

export const pembayaran = pgTable(
  "pembayaran",
  {
    id: id(),
    tagihanId: uuid("tagihan_id")
      .notNull()
      .references(() => tagihan.id),
    jumlah: rupiah("jumlah").notNull(),
    metode: text("metode", { enum: ["tunai", "transfer", "gateway"] }).notNull(),
    // Gateway: "<id transaksi provider>/<id tagihan>" (satu QRIS bisa melunasi beberapa bulan).
    providerRef: text("provider_ref").unique(),
    intentId: uuid("intent_id").references(() => paymentIntent.id),
    catatan: text("catatan"),
    dicatatOleh: uuid("dicatat_oleh").references(() => users.id),
    dibayarAt: tz("dibayar_at").notNull().defaultNow(),
    buktiWaDikirimAt: tz("bukti_wa_dikirim_at"),
  },
  // Tanpa cicilan: satu tagihan satu pembayaran (penjaga terakhir dari bayar dobel).
  (t) => [
    uniqueIndex("pembayaran_satu_per_tagihan").on(t.tagihanId),
    index("pembayaran_waktu_idx").on(t.dibayarAt),
  ],
);

export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["diterima", "diproses", "diabaikan", "gagal"] })
      .notNull()
      .default("diterima"),
    error: text("error"),
    diterimaAt: tz("diterima_at").notNull().defaultNow(),
    diprosesAt: tz("diproses_at"),
  },
  (t) => [unique("webhook_event_unik").on(t.provider, t.eventId)],
);

export const waOutbox = pgTable(
  "wa_outbox",
  {
    id: id(),
    nomor: text("nomor").notNull(),
    pesan: text("pesan").notNull(),
    status: text("status", { enum: ["antri", "terkirim", "gagal", "dilewati"] })
      .notNull()
      .default("antri"),
    percobaan: integer("percobaan").notNull().default(0),
    error: text("error"),
    rujukanTipe: text("rujukan_tipe"), // "pembayaran", "otp"
    rujukanId: text("rujukan_id"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
    terkirimAt: tz("terkirim_at"),
  },
  (t) => [
    index("wa_outbox_status_idx").on(t.status, t.dibuatAt),
    index("wa_outbox_rujukan_idx").on(t.rujukanTipe, t.rujukanId),
  ],
);

export const otpCodes = pgTable(
  "otp_codes",
  {
    id: id(),
    nomor: text("nomor").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kodeHash: text("kode_hash").notNull(),
    percobaan: integer("percobaan").notNull().default(0),
    kedaluwarsa: tz("kedaluwarsa").notNull(),
    dipakaiAt: tz("dipakai_at"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [index("otp_codes_nomor_idx").on(t.nomor).where(sql`${t.dipakaiAt} is null`)],
);
