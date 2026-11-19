import { sql } from "drizzle-orm";
import { boolean, check, date, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { id, tz } from "./common";
import { users } from "./identitas";
import { pengumuman } from "./informasi";
import { kelas, lokasi, pendaftaran, units } from "./sekolah";

/** Penanda "kelas ini sudah diabsen pada tanggal ini" (dibedakan dari "semua hadir"). */
export const presensiSesi = pgTable(
  "presensi_sesi",
  {
    id: id(),
    kelasId: uuid("kelas_id")
      .notNull()
      .references(() => kelas.id),
    tanggal: date("tanggal").notNull(),
    disimpanOleh: uuid("disimpan_oleh").references(() => users.id),
    disimpanAt: tz("disimpan_at").notNull().defaultNow(),
  },
  (t) => [unique("presensi_sesi_kelas_tanggal").on(t.kelasId, t.tanggal)],
);

export const presensi = pgTable(
  "presensi",
  {
    id: id(),
    pendaftaranId: uuid("pendaftaran_id")
      .notNull()
      .references(() => pendaftaran.id),
    tanggal: date("tanggal").notNull(),
    status: text("status", { enum: ["H", "S", "I", "A"] }).notNull(),
    keterangan: text("keterangan"),
  },
  (t) => [
    unique("presensi_pendaftaran_tanggal").on(t.pendaftaranId, t.tanggal),
    index("presensi_tanggal_idx").on(t.tanggal),
    check("presensi_status_valid", sql`${t.status} in ('H','S','I','A')`),
  ],
);

export const agenda = pgTable(
  "agenda",
  {
    id: id(),
    judul: text("judul").notNull(),
    deskripsi: text("deskripsi"),
    mulai: date("mulai").notNull(),
    selesai: date("selesai").notNull(),
    libur: boolean("libur").notNull().default(false),
    dibuatOleh: uuid("dibuat_oleh").references(() => users.id),
    dibuatAt: tz("dibuat_at").notNull().defaultNow(),
  },
  (t) => [
    index("agenda_tanggal_idx").on(t.mulai, t.selesai),
    check("agenda_rentang_valid", sql`${t.selesai} >= ${t.mulai}`),
  ],
);

/**
 * Sasaran agenda (dan pengumuman di M4). Satu baris = satu sasaran; kolom kosong = tidak dibatasi.
 * Semua kosong = seluruh sekolah; unit+lokasi = irisan keduanya.
 */
export const sasaran = pgTable(
  "sasaran",
  {
    id: id(),
    agendaId: uuid("agenda_id").references(() => agenda.id, { onDelete: "cascade" }),
    pengumumanId: uuid("pengumuman_id").references(() => pengumuman.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id").references(() => units.id),
    lokasiId: uuid("lokasi_id").references(() => lokasi.id),
    kelasId: uuid("kelas_id").references(() => kelas.id),
  },
  (t) => [
    index("sasaran_agenda_idx").on(t.agendaId),
    index("sasaran_pengumuman_idx").on(t.pengumumanId),
    check("sasaran_satu_induk", sql`num_nonnulls(${t.agendaId}, ${t.pengumumanId}) = 1`),
  ],
);
