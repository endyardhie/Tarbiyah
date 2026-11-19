import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tz } from "./common";
import { users } from "./identitas";

export const lokasi = pgTable("lokasi", {
  id: id(),
  nama: text("nama").notNull().unique(),
  alamat: text("alamat"),
  aktif: boolean("aktif").notNull().default(true),
  dibuatAt: tz("dibuat_at").notNull().defaultNow(),
});

export const units = pgTable("units", {
  id: id(),
  kode: text("kode").notNull().unique(),
  nama: text("nama").notNull(),
  urutan: integer("urutan").notNull().default(0),
  aktif: boolean("aktif").notNull().default(true),
  dibuatAt: tz("dibuat_at").notNull().defaultNow(),
});

export const tahunAjaran = pgTable(
  "tahun_ajaran",
  {
    id: id(),
    nama: text("nama").notNull().unique(),
    mulai: date("mulai").notNull(),
    selesai: date("selesai").notNull(),
    aktif: boolean("aktif").notNull().default(false),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tahun_ajaran_satu_aktif").on(t.aktif).where(sql`${t.aktif}`)],
);

export const semester = pgTable(
  "semester",
  {
    id: id(),
    tahunAjaranId: uuid("tahun_ajaran_id")
      .notNull()
      .references(() => tahunAjaran.id),
    nomor: smallint("nomor").notNull(),
    mulai: date("mulai").notNull(),
    selesai: date("selesai").notNull(),
    aktif: boolean("aktif").notNull().default(false),
  },
  (t) => [
    unique("semester_ta_nomor").on(t.tahunAjaranId, t.nomor),
    uniqueIndex("semester_satu_aktif").on(t.aktif).where(sql`${t.aktif}`),
  ],
);

export const kelas = pgTable(
  "kelas",
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
    nama: text("nama").notNull(),
    tingkat: smallint("tingkat").notNull(),
    kelompok: text("kelompok", { enum: ["banin", "banat", "campur"] })
      .notNull()
      .default("campur"),
    waliKelasId: uuid("wali_kelas_id").references(() => users.id),
    aktif: boolean("aktif").notNull().default(true),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [
    unique("kelas_nama_unik").on(t.tahunAjaranId, t.unitId, t.lokasiId, t.nama),
    // Sasaran FK komposit dari pendaftaran: kelas harus milik tahun ajaran yang sama.
    unique("kelas_id_ta").on(t.id, t.tahunAjaranId),
    index("kelas_wali_idx").on(t.waliKelasId),
  ],
);

export const mapel = pgTable("mapel", {
  id: id(),
  nama: text("nama").notNull(),
  namaArab: text("nama_arab"),
  kode: text("kode").unique(),
  unitId: uuid("unit_id").references(() => units.id),
  aktif: boolean("aktif").notNull().default(true),
  dibuatAt: tz("dibuat_at").notNull().defaultNow(),
});

export const pengajaran = pgTable(
  "pengajaran",
  {
    id: id(),
    kelasId: uuid("kelas_id")
      .notNull()
      .references(() => kelas.id),
    mapelId: uuid("mapel_id")
      .notNull()
      .references(() => mapel.id),
    guruId: uuid("guru_id")
      .notNull()
      .references(() => users.id),
    kkm: smallint("kkm"),
  },
  (t) => [
    unique("pengajaran_kelas_mapel").on(t.kelasId, t.mapelId),
    index("pengajaran_guru_idx").on(t.guruId),
  ],
);

export const jadwal = pgTable(
  "jadwal",
  {
    id: id(),
    pengajaranId: uuid("pengajaran_id")
      .notNull()
      .references(() => pengajaran.id, { onDelete: "cascade" }),
    hari: smallint("hari").notNull(), // 1 = Senin … 7 = Ahad (ISO)
    jamMulai: time("jam_mulai").notNull(),
    jamSelesai: time("jam_selesai").notNull(),
  },
  (t) => [index("jadwal_pengajaran_idx").on(t.pengajaranId)],
);

export const liburMingguan = pgTable("libur_mingguan", {
  id: id(),
  hari: smallint("hari").notNull(), // 1 = Senin … 7 = Ahad
  unitId: uuid("unit_id").references(() => units.id), // kosong = semua unit
  lokasiId: uuid("lokasi_id").references(() => lokasi.id), // kosong = semua lokasi
});

export const santri = pgTable("santri", {
  id: id(),
  nis: text("nis").notNull().unique(),
  nama: text("nama").notNull(),
  namaPanggilan: text("nama_panggilan"),
  jenisKelamin: text("jenis_kelamin", { enum: ["L", "P"] }),
  tempatLahir: text("tempat_lahir"),
  tanggalLahir: date("tanggal_lahir"),
  alamat: text("alamat"),
  status: text("status", { enum: ["aktif", "lulus", "pindah", "keluar"] })
    .notNull()
    .default("aktif"),
  dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  diubahAt: tz("diubah_at").notNull().defaultNow(),
});

export const santriWali = pgTable(
  "santri_wali",
  {
    santriId: uuid("santri_id")
      .notNull()
      .references(() => santri.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    hubungan: text("hubungan", { enum: ["ayah", "ibu", "wali"] })
      .notNull()
      .default("wali"),
    penerimaTagihan: boolean("penerima_tagihan").notNull().default(true),
  },
  (t) => [
    unique("santri_wali_pk").on(t.santriId, t.userId),
    index("santri_wali_user_idx").on(t.userId),
  ],
);

export const pendaftaran = pgTable(
  "pendaftaran",
  {
    id: id(),
    santriId: uuid("santri_id")
      .notNull()
      .references(() => santri.id),
    tahunAjaranId: uuid("tahun_ajaran_id")
      .notNull()
      .references(() => tahunAjaran.id),
    kelasId: uuid("kelas_id").notNull(),
    status: text("status", { enum: ["aktif", "naik", "tinggal", "lompat", "pindah", "lulus"] })
      .notNull()
      .default("aktif"),
    noAbsen: smallint("no_absen"),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [
    // Satu santri satu kelas (dan satu unit) per tahun ajaran.
    unique("pendaftaran_santri_ta").on(t.santriId, t.tahunAjaranId),
    foreignKey({
      name: "pendaftaran_kelas_ta_fk",
      columns: [t.kelasId, t.tahunAjaranId],
      foreignColumns: [kelas.id, kelas.tahunAjaranId],
    }),
    index("pendaftaran_kelas_idx").on(t.kelasId),
  ],
);
