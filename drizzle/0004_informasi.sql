CREATE TABLE "notifikasi" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"jenis" text NOT NULL,
	"judul" text NOT NULL,
	"isi" text NOT NULL,
	"url" text,
	"pengirim_id" uuid,
	"dibaca_at" timestamp with time zone,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pengumuman" (
	"id" uuid PRIMARY KEY NOT NULL,
	"judul" text NOT NULL,
	"isi" text NOT NULL,
	"pengirim_id" uuid NOT NULL,
	"kirim_notifikasi" boolean DEFAULT true NOT NULL,
	"dikirim_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"perangkat" text,
	"dibuat_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
ALTER TABLE "sasaran" ADD COLUMN "pengumuman_id" uuid;--> statement-breakpoint
ALTER TABLE "notifikasi" ADD CONSTRAINT "notifikasi_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifikasi" ADD CONSTRAINT "notifikasi_pengirim_id_users_id_fk" FOREIGN KEY ("pengirim_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pengumuman" ADD CONSTRAINT "pengumuman_pengirim_id_users_id_fk" FOREIGN KEY ("pengirim_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifikasi_user_waktu_idx" ON "notifikasi" USING btree ("user_id","dibuat_at");--> statement-breakpoint
CREATE INDEX "notifikasi_belum_dibaca_idx" ON "notifikasi" USING btree ("user_id") WHERE "notifikasi"."dibaca_at" is null;--> statement-breakpoint
CREATE INDEX "pengumuman_waktu_idx" ON "pengumuman" USING btree ("dikirim_at");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "sasaran" ADD CONSTRAINT "sasaran_pengumuman_id_pengumuman_id_fk" FOREIGN KEY ("pengumuman_id") REFERENCES "public"."pengumuman"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sasaran_pengumuman_idx" ON "sasaran" USING btree ("pengumuman_id");--> statement-breakpoint
ALTER TABLE "sasaran" ADD CONSTRAINT "sasaran_satu_induk" CHECK (num_nonnulls("sasaran"."agenda_id", "sasaran"."pengumuman_id") = 1);