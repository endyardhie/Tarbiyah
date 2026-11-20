CREATE TABLE "backup_file" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nama" text NOT NULL,
	"jenis" text NOT NULL,
	"status" text DEFAULT 'berjalan' NOT NULL,
	"ukuran" bigint,
	"versi_skema" integer,
	"versi_aplikasi" text,
	"ada_di_server" boolean DEFAULT false NOT NULL,
	"b2_key" text,
	"b2_at" timestamp with time zone,
	"error" text,
	"dibuat_oleh" uuid,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"selesai_at" timestamp with time zone,
	CONSTRAINT "backup_file_nama_unique" UNIQUE("nama")
);
--> statement-breakpoint
ALTER TABLE "backup_file" ADD CONSTRAINT "backup_file_dibuat_oleh_users_id_fk" FOREIGN KEY ("dibuat_oleh") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_file_waktu_idx" ON "backup_file" USING btree ("dibuat_at");