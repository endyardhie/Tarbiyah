CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nomor" text NOT NULL,
	"user_id" uuid NOT NULL,
	"kode_hash" text NOT NULL,
	"percobaan" integer DEFAULT 0 NOT NULL,
	"kedaluwarsa" timestamp with time zone NOT NULL,
	"dipakai_at" timestamp with time zone,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_intent" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"user_id" uuid NOT NULL,
	"total" bigint NOT NULL,
	"jumlah_bayar" bigint,
	"status" text DEFAULT 'menunggu' NOT NULL,
	"qris" text,
	"kedaluwarsa_at" timestamp with time zone,
	"lunas_at" timestamp with time zone,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_intent_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "payment_intent_item" (
	"intent_id" uuid NOT NULL,
	"tagihan_id" uuid NOT NULL,
	"nominal" bigint NOT NULL,
	CONSTRAINT "payment_intent_item_intent_id_tagihan_id_pk" PRIMARY KEY("intent_id","tagihan_id")
);
--> statement-breakpoint
CREATE TABLE "pembayaran" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tagihan_id" uuid NOT NULL,
	"jumlah" bigint NOT NULL,
	"metode" text NOT NULL,
	"provider_ref" text,
	"intent_id" uuid,
	"catatan" text,
	"dicatat_oleh" uuid,
	"dibayar_at" timestamp with time zone DEFAULT now() NOT NULL,
	"bukti_wa_dikirim_at" timestamp with time zone,
	CONSTRAINT "pembayaran_provider_ref_unique" UNIQUE("provider_ref")
);
--> statement-breakpoint
CREATE TABLE "potongan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"santri_id" uuid NOT NULL,
	"tahun_ajaran_id" uuid NOT NULL,
	"jenis" text NOT NULL,
	"nilai" bigint NOT NULL,
	"alasan" text NOT NULL,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "potongan_unik" UNIQUE("santri_id","tahun_ajaran_id")
);
--> statement-breakpoint
CREATE TABLE "tagihan" (
	"id" uuid PRIMARY KEY NOT NULL,
	"santri_id" uuid NOT NULL,
	"pendaftaran_id" uuid NOT NULL,
	"jenis" text DEFAULT 'spp' NOT NULL,
	"periode" text NOT NULL,
	"nominal" bigint NOT NULL,
	"potongan" bigint DEFAULT 0 NOT NULL,
	"total" bigint NOT NULL,
	"jatuh_tempo" date NOT NULL,
	"status" text DEFAULT 'belum' NOT NULL,
	"alasan_batal" text,
	"dibatalkan_oleh" uuid,
	"lunas_at" timestamp with time zone,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tagihan_unik" UNIQUE("santri_id","jenis","periode")
);
--> statement-breakpoint
CREATE TABLE "tarif_spp" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tahun_ajaran_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"lokasi_id" uuid NOT NULL,
	"nominal" bigint NOT NULL,
	CONSTRAINT "tarif_spp_unik" UNIQUE("tahun_ajaran_id","unit_id","lokasi_id")
);
--> statement-breakpoint
CREATE TABLE "wa_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nomor" text NOT NULL,
	"pesan" text NOT NULL,
	"status" text DEFAULT 'antri' NOT NULL,
	"percobaan" integer DEFAULT 0 NOT NULL,
	"error" text,
	"rujukan_tipe" text,
	"rujukan_id" text,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terkirim_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'diterima' NOT NULL,
	"error" text,
	"diterima_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diproses_at" timestamp with time zone,
	CONSTRAINT "webhook_event_unik" UNIQUE("provider","event_id")
);
--> statement-breakpoint
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intent_item" ADD CONSTRAINT "payment_intent_item_intent_id_payment_intent_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intent_item" ADD CONSTRAINT "payment_intent_item_tagihan_id_tagihan_id_fk" FOREIGN KEY ("tagihan_id") REFERENCES "public"."tagihan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_tagihan_id_tagihan_id_fk" FOREIGN KEY ("tagihan_id") REFERENCES "public"."tagihan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_intent_id_payment_intent_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intent"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pembayaran" ADD CONSTRAINT "pembayaran_dicatat_oleh_users_id_fk" FOREIGN KEY ("dicatat_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "potongan" ADD CONSTRAINT "potongan_santri_id_santri_id_fk" FOREIGN KEY ("santri_id") REFERENCES "public"."santri"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "potongan" ADD CONSTRAINT "potongan_tahun_ajaran_id_tahun_ajaran_id_fk" FOREIGN KEY ("tahun_ajaran_id") REFERENCES "public"."tahun_ajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagihan" ADD CONSTRAINT "tagihan_santri_id_santri_id_fk" FOREIGN KEY ("santri_id") REFERENCES "public"."santri"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagihan" ADD CONSTRAINT "tagihan_pendaftaran_id_pendaftaran_id_fk" FOREIGN KEY ("pendaftaran_id") REFERENCES "public"."pendaftaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tagihan" ADD CONSTRAINT "tagihan_dibatalkan_oleh_users_id_fk" FOREIGN KEY ("dibatalkan_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif_spp" ADD CONSTRAINT "tarif_spp_tahun_ajaran_id_tahun_ajaran_id_fk" FOREIGN KEY ("tahun_ajaran_id") REFERENCES "public"."tahun_ajaran"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif_spp" ADD CONSTRAINT "tarif_spp_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tarif_spp" ADD CONSTRAINT "tarif_spp_lokasi_id_lokasi_id_fk" FOREIGN KEY ("lokasi_id") REFERENCES "public"."lokasi"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_codes_nomor_idx" ON "otp_codes" USING btree ("nomor") WHERE "otp_codes"."dipakai_at" is null;--> statement-breakpoint
CREATE INDEX "payment_intent_status_idx" ON "payment_intent" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_intent_item_tagihan_idx" ON "payment_intent_item" USING btree ("tagihan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pembayaran_satu_per_tagihan" ON "pembayaran" USING btree ("tagihan_id");--> statement-breakpoint
CREATE INDEX "pembayaran_waktu_idx" ON "pembayaran" USING btree ("dibayar_at");--> statement-breakpoint
CREATE INDEX "tagihan_periode_idx" ON "tagihan" USING btree ("periode","status");--> statement-breakpoint
CREATE INDEX "wa_outbox_status_idx" ON "wa_outbox" USING btree ("status","dibuat_at");--> statement-breakpoint
CREATE INDEX "wa_outbox_rujukan_idx" ON "wa_outbox" USING btree ("rujukan_tipe","rujukan_id");