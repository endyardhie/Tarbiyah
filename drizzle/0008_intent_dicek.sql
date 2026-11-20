ALTER TABLE "payment_intent" ADD COLUMN "dicek_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_intent" ADD COLUMN "dicek_oleh" uuid;--> statement-breakpoint
ALTER TABLE "payment_intent" ADD COLUMN "catatan_cek" text;--> statement-breakpoint
ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_dicek_oleh_users_id_fk" FOREIGN KEY ("dicek_oleh") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;