import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "staging", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url(),
  DATABASE_URL: z.url(),
  DATA_DIR: z.string().min(1).default("/data"),
  TZ: z.string().min(1).default("Asia/Jayapura"),
  APP_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, {
    message: "harus 32 byte dalam base64 (buat dengan: openssl rand -base64 32)",
  }),
  TURNSTILE_SITE_KEY: z.string().min(1),
  TURNSTILE_SECRET_KEY: z.string().min(1),
  TRUST_CLOUDFLARE: bool,
  SEED_ADMIN_PHONE: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  APP_VERSION: z.string().default("dev"),
});

export type Env = z.infer<typeof envSchema>;

// Kunci uji resmi Cloudflare Turnstile (1x…, 2x…, 3x…) selalu lolos / selalu gagal.
const isTurnstileTestKey = (key: string) => /^[123]x0{10,}/.test(key);

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema
    .refine(
      (e) =>
        e.NODE_ENV !== "production" ||
        !(isTurnstileTestKey(e.TURNSTILE_SITE_KEY) || isTurnstileTestKey(e.TURNSTILE_SECRET_KEY)),
      {
        path: ["TURNSTILE_SECRET_KEY"],
        message: "kunci uji Turnstile tidak boleh dipakai di production",
      },
    )
    .safeParse(source);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Environment variable tidak lengkap/tidak valid:\n${lines.join("\n")}`);
}

/** Peringatan konfigurasi yang tidak menghentikan start, tapi berbahaya di server. */
export function configWarnings(env: Env): string[] {
  if (env.NODE_ENV !== "staging" && env.NODE_ENV !== "production") return [];
  const warnings: string[] = [];
  if (!env.TRUST_CLOUDFLARE) {
    warnings.push(
      "TRUST_CLOUDFLARE=false: di belakang Traefik semua pengguna terlihat dari satu IP, sehingga " +
        "batas gagal login per IP bisa mengunci login semua orang. Set TRUST_CLOUDFLARE=true dan " +
        "batasi port 80/443 hanya untuk IP Cloudflare.",
    );
  }
  if (isTurnstileTestKey(env.TURNSTILE_SITE_KEY) || isTurnstileTestKey(env.TURNSTILE_SECRET_KEY)) {
    warnings.push("Kunci uji Turnstile dipakai: verifikasi keamanan login selalu lolos.");
  }
  return warnings;
}
