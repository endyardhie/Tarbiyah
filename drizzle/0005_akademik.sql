CREATE TABLE "bobot_nilai" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"jenis" text NOT NULL,
	"bobot" smallint NOT NULL,
	CONSTRAINT "bobot_unit_jenis" UNIQUE("unit_id","jenis")
);
--> statement-breakpoint
CREATE TABLE "nilai" (
	"id" uuid PRIMARY KEY NOT NULL,
	"penilaian_id" uuid NOT NULL,
	"pendaftaran_id" uuid NOT NULL,
	"nilai" numeric(5, 2) NOT NULL,
	CONSTRAINT "nilai_penilaian_pendaftaran" UNIQUE("penilaian_id","pendaftaran_id"),
	CONSTRAINT "nilai_rentang" CHECK ("nilai"."nilai" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "penilaian" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pengajaran_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"jenis" text NOT NULL,
	"judul" text NOT NULL,
	"tanggal" date NOT NULL,
	"dinotifikasi_at" timestamp with time zone,
	"dibuat_oleh" uuid,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rapor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pendaftaran_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"catatan_wali" text,
	"keputusan" text,
	"sakit" smallint,
	"izin" smallint,
	"alpa" smallint,
	"status" text DEFAULT 'draft' NOT NULL,
	"dikunci_oleh" uuid,
	"dikunci_at" timestamp with time zone,
	CONSTRAINT "rapor_pendaftaran_semester" UNIQUE("pendaftaran_id","semester_id")
);
--> statement-breakpoint
CREATE TABLE "rapor_aspek" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"kelompok" text NOT NULL,
	"nama" text NOT NULL,
	"tipe" text NOT NULL,
	"urutan" smallint DEFAULT 0 NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rapor_aspek_nilai" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rapor_id" uuid NOT NULL,
	"aspek_id" uuid NOT NULL,
	"nilai" text,
	CONSTRAINT "rapor_aspek_nilai_unik" UNIQUE("rapor_id","aspek_id")
);
--> statement-breakpoint
CREATE TABLE "rapor_nilai" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rapor_id" uuid NOT NULL,
	"pengajaran_id" uuid NOT NULL,
	"nilai_otomatis" numeric(5, 2),
	"nilai_akhir" numeric(5, 2),
	"predikat" text,
	"deskripsi" text,
	"manual" boolean DEFAULT false NOT NULL,
	CONSTRAINT "rapor_nilai_rapor_pengajaran" UNIQUE("rapor_id","pengajaran_id")
);
--> statement-breakpoint
CREATE TABLE "rapor_template" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"nama" text NOT NULL,
	"html" text NOT NULL,
	"css" text NOT NULL,
	"aktif" boolean DEFAULT true NOT NULL,
	"diubah_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skala_predikat" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"predikat" text NOT NULL,
	"min" numeric(5, 2) NOT NULL,
	"deskripsi" text DEFAULT '' NOT NULL,
	CONSTRAINT "skala_unit_predikat" UNIQUE("unit_id","predikat")
);
--> statement-breakpoint
CREATE TABLE "tugas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pengajaran_id" uuid NOT NULL,
	"judul" text NOT NULL,
	"deskripsi" text,
	"tanggal_diberi" date NOT NULL,
	"tenggat" date,
	"dinotifikasi_at" timestamp with time zone,
	"dibuat_oleh" uuid,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bobot_nilai" ADD CONSTRAINT "bobot_nilai_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nilai" ADD CONSTRAINT "nilai_penilaian_id_penilaian_id_fk" FOREIGN KEY ("penilaian_id") REFERENCES "public"."penilaian"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nilai" ADD CONSTRAINT "nilai_pendaftaran_id_pendaftaran_id_fk" FOREIGN KEY ("pendaftaran_id") REFERENCES "public"."pendaftaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penilaian" ADD CONSTRAINT "penilaian_pengajaran_id_pengajaran_id_fk" FOREIGN KEY ("pengajaran_id") REFERENCES "public"."pengajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penilaian" ADD CONSTRAINT "penilaian_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semester"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penilaian" ADD CONSTRAINT "penilaian_dibuat_oleh_users_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor" ADD CONSTRAINT "rapor_pendaftaran_id_pendaftaran_id_fk" FOREIGN KEY ("pendaftaran_id") REFERENCES "public"."pendaftaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor" ADD CONSTRAINT "rapor_semester_id_semester_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semester"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor" ADD CONSTRAINT "rapor_dikunci_oleh_users_id_fk" FOREIGN KEY ("dikunci_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor_aspek" ADD CONSTRAINT "rapor_aspek_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor_aspek_nilai" ADD CONSTRAINT "rapor_aspek_nilai_rapor_id_rapor_id_fk" FOREIGN KEY ("rapor_id") REFERENCES "public"."rapor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor_aspek_nilai" ADD CONSTRAINT "rapor_aspek_nilai_aspek_id_rapor_aspek_id_fk" FOREIGN KEY ("aspek_id") REFERENCES "public"."rapor_aspek"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor_nilai" ADD CONSTRAINT "rapor_nilai_rapor_id_rapor_id_fk" FOREIGN KEY ("rapor_id") REFERENCES "public"."rapor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor_nilai" ADD CONSTRAINT "rapor_nilai_pengajaran_id_pengajaran_id_fk" FOREIGN KEY ("pengajaran_id") REFERENCES "public"."pengajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rapor_template" ADD CONSTRAINT "rapor_template_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skala_predikat" ADD CONSTRAINT "skala_predikat_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tugas" ADD CONSTRAINT "tugas_pengajaran_id_pengajaran_id_fk" FOREIGN KEY ("pengajaran_id") REFERENCES "public"."pengajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tugas" ADD CONSTRAINT "tugas_dibuat_oleh_users_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "penilaian_pengajaran_idx" ON "penilaian" USING btree ("pengajaran_id","semester_id");--> statement-breakpoint
CREATE INDEX "rapor_aspek_unit_idx" ON "rapor_aspek" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rapor_template_satu_aktif" ON "rapor_template" USING btree ("unit_id") WHERE "rapor_template"."aktif";--> statement-breakpoint
CREATE INDEX "tugas_pengajaran_idx" ON "tugas" USING btree ("pengajaran_id");