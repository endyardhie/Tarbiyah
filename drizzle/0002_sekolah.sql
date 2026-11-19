CREATE TABLE "jadwal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pengajaran_id" uuid NOT NULL,
	"hari" smallint NOT NULL,
	"jam_mulai" time NOT NULL,
	"jam_selesai" time NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kelas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tahun_ajaran_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lokasi_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"tingkat" smallint NOT NULL,
	"kelompok" text DEFAULT 'campur' NOT NULL,
	"wali_kelas_id" uuid,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kelas_nama_unik" UNIQUE("tahun_ajaran_id","unit_id","lokasi_id","nama"),
	CONSTRAINT "kelas_id_ta" UNIQUE("id","tahun_ajaran_id")
);
--> statement-breakpoint
CREATE TABLE "libur_mingguan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hari" smallint NOT NULL,
	"unit_id" uuid,
	"lokasi_id" uuid
);
--> statement-breakpoint
CREATE TABLE "lokasi" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"alamat" text,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lokasi_nama_unique" UNIQUE("nama")
);
--> statement-breakpoint
CREATE TABLE "mapel" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"nama_arab" text,
	"kode" text,
	"unit_id" uuid,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapel_kode_unique" UNIQUE("kode")
);
--> statement-breakpoint
CREATE TABLE "pendaftaran" (
	"id" uuid PRIMARY KEY NOT NULL,
	"santri_id" uuid NOT NULL,
	"tahun_ajaran_id" uuid NOT NULL,
	"kelas_id" uuid NOT NULL,
	"status" text DEFAULT 'aktif' NOT NULL,
	"no_absen" smallint,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pendaftaran_santri_ta" UNIQUE("santri_id","tahun_ajaran_id")
);
--> statement-breakpoint
CREATE TABLE "pengajaran" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kelas_id" uuid NOT NULL,
	"mapel_id" uuid NOT NULL,
	"guru_id" uuid NOT NULL,
	"kkm" smallint,
	CONSTRAINT "pengajaran_kelas_mapel" UNIQUE("kelas_id","mapel_id")
);
--> statement-breakpoint
CREATE TABLE "santri" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nis" text NOT NULL,
	"nama" text NOT NULL,
	"nama_panggilan" text,
	"jenis_kelamin" text,
	"tempat_lahir" text,
	"tanggal_lahir" date,
	"alamat" text,
	"status" text DEFAULT 'aktif' NOT NULL,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diubah_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "santri_nis_unique" UNIQUE("nis")
);
--> statement-breakpoint
CREATE TABLE "santri_wali" (
	"santri_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"hubungan" text DEFAULT 'wali' NOT NULL,
	"penerima_tagihan" boolean DEFAULT true NOT NULL,
	CONSTRAINT "santri_wali_pk" UNIQUE("santri_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "semester" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tahun_ajaran_id" uuid NOT NULL,
	"nomor" smallint NOT NULL,
	"mulai" date NOT NULL,
	"selesai" date NOT NULL,
	"aktif" boolean DEFAULT false NOT NULL,
	CONSTRAINT "semester_ta_nomor" UNIQUE("tahun_ajaran_id","nomor")
);
--> statement-breakpoint
CREATE TABLE "tahun_ajaran" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"mulai" date NOT NULL,
	"selesai" date NOT NULL,
	"aktif" boolean DEFAULT false NOT NULL,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tahun_ajaran_nama_unique" UNIQUE("nama")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kode" text NOT NULL,
	"nama" text NOT NULL,
	"urutan" integer DEFAULT 0 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_kode_unique" UNIQUE("kode")
);
--> statement-breakpoint
CREATE TABLE "berkas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nama_asli" text NOT NULL,
	"path" text NOT NULL,
	"ukuran" bigint NOT NULL,
	"tipe" text NOT NULL,
	"rujukan_tipe" text,
	"rujukan_id" text,
	"publik" boolean DEFAULT false NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dibackup_at" timestamp with time zone,
	CONSTRAINT "berkas_path_unique" UNIQUE("path")
);
--> statement-breakpoint
ALTER TABLE "jadwal" ADD CONSTRAINT "jadwal_pengajaran_id_pengajaran_id_fk" FOREIGN KEY ("pengajaran_id") REFERENCES "public"."pengajaran"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kelas" ADD CONSTRAINT "kelas_tahun_ajaran_id_tahun_ajaran_id_fk" FOREIGN KEY ("tahun_ajaran_id") REFERENCES "public"."tahun_ajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kelas" ADD CONSTRAINT "kelas_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kelas" ADD CONSTRAINT "kelas_lokasi_id_lokasi_id_fk" FOREIGN KEY ("lokasi_id") REFERENCES "public"."lokasi"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kelas" ADD CONSTRAINT "kelas_wali_kelas_id_users_id_fk" FOREIGN KEY ("wali_kelas_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libur_mingguan" ADD CONSTRAINT "libur_mingguan_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "libur_mingguan" ADD CONSTRAINT "libur_mingguan_lokasi_id_lokasi_id_fk" FOREIGN KEY ("lokasi_id") REFERENCES "public"."lokasi"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mapel" ADD CONSTRAINT "mapel_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendaftaran" ADD CONSTRAINT "pendaftaran_santri_id_santri_id_fk" FOREIGN KEY ("santri_id") REFERENCES "public"."santri"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendaftaran" ADD CONSTRAINT "pendaftaran_tahun_ajaran_id_tahun_ajaran_id_fk" FOREIGN KEY ("tahun_ajaran_id") REFERENCES "public"."tahun_ajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pendaftaran" ADD CONSTRAINT "pendaftaran_kelas_ta_fk" FOREIGN KEY ("kelas_id","tahun_ajaran_id") REFERENCES "public"."kelas"("id","tahun_ajaran_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengajaran" ADD CONSTRAINT "pengajaran_kelas_id_kelas_id_fk" FOREIGN KEY ("kelas_id") REFERENCES "public"."kelas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengajaran" ADD CONSTRAINT "pengajaran_mapel_id_mapel_id_fk" FOREIGN KEY ("mapel_id") REFERENCES "public"."mapel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengajaran" ADD CONSTRAINT "pengajaran_guru_id_users_id_fk" FOREIGN KEY ("guru_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "santri_wali" ADD CONSTRAINT "santri_wali_santri_id_santri_id_fk" FOREIGN KEY ("santri_id") REFERENCES "public"."santri"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "santri_wali" ADD CONSTRAINT "santri_wali_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semester" ADD CONSTRAINT "semester_tahun_ajaran_id_tahun_ajaran_id_fk" FOREIGN KEY ("tahun_ajaran_id") REFERENCES "public"."tahun_ajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "berkas" ADD CONSTRAINT "berkas_dibuat_oleh_users_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jadwal_pengajaran_idx" ON "jadwal" USING btree ("pengajaran_id");--> statement-breakpoint
CREATE INDEX "kelas_wali_idx" ON "kelas" USING btree ("wali_kelas_id");--> statement-breakpoint
CREATE INDEX "pendaftaran_kelas_idx" ON "pendaftaran" USING btree ("kelas_id");--> statement-breakpoint
CREATE INDEX "pengajaran_guru_idx" ON "pengajaran" USING btree ("guru_id");--> statement-breakpoint
CREATE INDEX "santri_wali_user_idx" ON "santri_wali" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "semester_satu_aktif" ON "semester" USING btree ("aktif") WHERE "semester"."aktif";--> statement-breakpoint
CREATE UNIQUE INDEX "tahun_ajaran_satu_aktif" ON "tahun_ajaran" USING btree ("aktif") WHERE "tahun_ajaran"."aktif";--> statement-breakpoint
CREATE INDEX "berkas_rujukan_idx" ON "berkas" USING btree ("rujukan_tipe","rujukan_id");--> statement-breakpoint
-- Libur mingguan bawaan: Sabtu & Ahad untuk semua unit/lokasi (bisa diubah admin).
INSERT INTO "libur_mingguan" ("id", "hari") VALUES ('019a0000-0000-7000-8000-000000000006', 6), ('019a0000-0000-7000-8000-000000000007', 7);
