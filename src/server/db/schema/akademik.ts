import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tz } from "./common";
import { users } from "./identitas";
import { pendaftaran, pengajaran, semester, units } from "./sekolah";

export const JENIS_PENILAIAN = ["PR", "tugas", "UH", "UTS", "UAS", "praktik"] as const;

/** Tugas/PR. Lampiran = baris berkas dengan rujukan_tipe "tugas" dan rujukan_id = id tugas. */
export const tugas = pgTable(
  "tugas",
  {
    id: id(),
    pengajaranId: uuid("pengajaran_id")
      .notNull()
      .references(() => pengajaran.id),
    judul: text("judul").notNull(),
    deskripsi: text("deskripsi"),
    tanggalDiberi: date("tanggal_diberi").notNull(),
    tenggat: date("tenggat"),
    dinotifikasiAt: tz("dinotifikasi_at"),
    dibuatOleh: uuid("dibuat_oleh").references(() => users.id),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [index("tugas_pengajaran_idx").on(t.pengajaranId)],
);

export const penilaian = pgTable(
  "penilaian",
  {
    id: id(),
    pengajaranId: uuid("pengajaran_id")
      .notNull()
      .references(() => pengajaran.id),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id),
    jenis: text("jenis", { enum: JENIS_PENILAIAN }).notNull(),
    judul: text("judul").notNull(),
    tanggal: date("tanggal").notNull(),
    dinotifikasiAt: tz("dinotifikasi_at"),
    dibuatOleh: uuid("dibuat_oleh").references(() => users.id),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [index("penilaian_pengajaran_idx").on(t.pengajaranId, t.semesterId)],
);

export const nilai = pgTable(
  "nilai",
  {
    id: id(),
    penilaianId: uuid("penilaian_id")
      .notNull()
      .references(() => penilaian.id),
    pendaftaranId: uuid("pendaftaran_id")
      .notNull()
      .references(() => pendaftaran.id),
    nilai: numeric("nilai", { precision: 5, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [
    unique("nilai_penilaian_pendaftaran").on(t.penilaianId, t.pendaftaranId),
    check("nilai_rentang", sql`${t.nilai} between 0 and 100`),
  ],
);

/** Bobot per jenis penilaian per unit (total 100). Kosong = bobot bawaan di kode. */
export const bobotNilai = pgTable(
  "bobot_nilai",
  {
    id: id(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    jenis: text("jenis", { enum: JENIS_PENILAIAN }).notNull(),
    bobot: smallint("bobot").notNull(),
  },
  (t) => [unique("bobot_unit_jenis").on(t.unitId, t.jenis)],
);

/** Skala predikat per unit: predikat berlaku untuk nilai >= min (urut dari min tertinggi). */
export const skalaPredikat = pgTable(
  "skala_predikat",
  {
    id: id(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    predikat: text("predikat").notNull(),
    min: numeric("min", { precision: 5, scale: 2, mode: "number" }).notNull(),
    deskripsi: text("deskripsi").notNull().default(""),
  },
  (t) => [unique("skala_unit_predikat").on(t.unitId, t.predikat)],
);

export const raporAspek = pgTable(
  "rapor_aspek",
  {
    id: id(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    kelompok: text("kelompok").notNull(),
    nama: text("nama").notNull(),
    tipe: text("tipe", { enum: ["predikat", "angka", "teks"] }).notNull(),
    urutan: smallint("urutan").notNull().default(0),
    aktif: boolean("aktif").notNull().default(true),
  },
  (t) => [index("rapor_aspek_unit_idx").on(t.unitId)],
);

/** Rapor satu santri satu semester: catatan, keputusan, rekap absen (dibekukan saat final). */
export const rapor = pgTable(
  "rapor",
  {
    id: id(),
    pendaftaranId: uuid("pendaftaran_id")
      .notNull()
      .references(() => pendaftaran.id),
    semesterId: uuid("semester_id")
      .notNull()
      .references(() => semester.id),
    catatanWali: text("catatan_wali"),
    keputusan: text("keputusan", { enum: ["naik", "tinggal"] }),
    sakit: smallint("sakit"),
    izin: smallint("izin"),
    alpa: smallint("alpa"),
    status: text("status", { enum: ["draft", "final"] })
      .notNull()
      .default("draft"),
    dikunciOleh: uuid("dikunci_oleh").references(() => users.id),
    dikunciAt: tz("dikunci_at"),
  },
  (t) => [unique("rapor_pendaftaran_semester").on(t.pendaftaranId, t.semesterId)],
);

export const raporNilai = pgTable(
  "rapor_nilai",
  {
    id: id(),
    raporId: uuid("rapor_id")
      .notNull()
      .references(() => rapor.id),
    pengajaranId: uuid("pengajaran_id")
      .notNull()
      .references(() => pengajaran.id),
    nilaiOtomatis: numeric("nilai_otomatis", { precision: 5, scale: 2, mode: "number" }),
    nilaiAkhir: numeric("nilai_akhir", { precision: 5, scale: 2, mode: "number" }),
    predikat: text("predikat"),
    deskripsi: text("deskripsi"),
    /** nilai_akhir diisi guru (bukan otomatis). Selama draft, baris non-manual dihitung ulang. */
    manual: boolean("manual").notNull().default(false),
    /** deskripsi ditulis guru; selain itu deskripsi otomatis dari predikat. */
    deskripsiManual: boolean("deskripsi_manual").notNull().default(false),
  },
  (t) => [unique("rapor_nilai_rapor_pengajaran").on(t.raporId, t.pengajaranId)],
);

export const raporAspekNilai = pgTable(
  "rapor_aspek_nilai",
  {
    id: id(),
    raporId: uuid("rapor_id")
      .notNull()
      .references(() => rapor.id),
    aspekId: uuid("aspek_id")
      .notNull()
      .references(() => raporAspek.id),
    nilai: text("nilai"),
  },
  (t) => [unique("rapor_aspek_nilai_unik").on(t.raporId, t.aspekId)],
);

export const raporTemplate = pgTable(
  "rapor_template",
  {
    id: id(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    nama: text("nama").notNull(),
    html: text("html").notNull(),
    css: text("css").notNull(),
    aktif: boolean("aktif").notNull().default(true),
    diubahAt: tz("diubah_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rapor_template_satu_aktif").on(t.unitId).where(sql`${t.aktif}`)],
);
