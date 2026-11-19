CREATE TABLE "agenda" (
	"id" uuid PRIMARY KEY NOT NULL,
	"judul" text NOT NULL,
	"deskripsi" text,
	"mulai" date NOT NULL,
	"selesai" date NOT NULL,
	"libur" boolean DEFAULT false NOT NULL,
	"dibuat_oleh" uuid,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agenda_rentang_valid" CHECK ("agenda"."selesai" >= "agenda"."mulai")
);
--> statement-breakpoint
CREATE TABLE "presensi" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pendaftaran_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"status" text NOT NULL,
	"keterangan" text,
	CONSTRAINT "presensi_pendaftaran_tanggal" UNIQUE("pendaftaran_id","tanggal"),
	CONSTRAINT "presensi_status_valid" CHECK ("presensi"."status" in ('H','S','I','A'))
);
--> statement-breakpoint
CREATE TABLE "presensi_sesi" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kelas_id" uuid NOT NULL,
	"tanggal" date NOT NULL,
	"disimpan_oleh" uuid,
	"disimpan_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presensi_sesi_kelas_tanggal" UNIQUE("kelas_id","tanggal")
);
--> statement-breakpoint
CREATE TABLE "sasaran" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agenda_id" uuid,
	"unit_id" uuid,
	"lokasi_id" uuid,
	"kelas_id" uuid
);
--> statement-breakpoint
ALTER TABLE "agenda" ADD CONSTRAINT "agenda_dibuat_oleh_users_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presensi" ADD CONSTRAINT "presensi_pendaftaran_id_pendaftaran_id_fk" FOREIGN KEY ("pendaftaran_id") REFERENCES "public"."pendaftaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presensi_sesi" ADD CONSTRAINT "presensi_sesi_kelas_id_kelas_id_fk" FOREIGN KEY ("kelas_id") REFERENCES "public"."kelas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presensi_sesi" ADD CONSTRAINT "presensi_sesi_disimpan_oleh_users_id_fk" FOREIGN KEY ("disimpan_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sasaran" ADD CONSTRAINT "sasaran_agenda_id_agenda_id_fk" FOREIGN KEY ("agenda_id") REFERENCES "public"."agenda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sasaran" ADD CONSTRAINT "sasaran_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sasaran" ADD CONSTRAINT "sasaran_lokasi_id_lokasi_id_fk" FOREIGN KEY ("lokasi_id") REFERENCES "public"."lokasi"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sasaran" ADD CONSTRAINT "sasaran_kelas_id_kelas_id_fk" FOREIGN KEY ("kelas_id") REFERENCES "public"."kelas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agenda_tanggal_idx" ON "agenda" USING btree ("mulai","selesai");--> statement-breakpoint
CREATE INDEX "presensi_tanggal_idx" ON "presensi" USING btree ("tanggal");--> statement-breakpoint
CREATE INDEX "sasaran_agenda_idx" ON "sasaran" USING btree ("agenda_id");