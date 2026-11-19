CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"terenkripsi" boolean DEFAULT false NOT NULL,
	"versi_kunci" integer,
	"diubah_at" timestamp with time zone DEFAULT now() NOT NULL
);
