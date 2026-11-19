import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createDb, runMigrations } from "./db/client";
import { configWarnings, parseEnv } from "./env";
import { createBoss } from "./jobs/boss";
import { registerJobs } from "./jobs/schedules";
import { createStorage } from "./lib/storage";
import { createTurnstileVerifier } from "./lib/turnstile";
import { schoolTimeZone } from "./services/pengaturan";
import { ensureDefaultRoles } from "./services/roles";

let env: ReturnType<typeof parseEnv>;
try {
  env = parseEnv();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}

for (const w of configWarnings(env)) console.warn(`PERINGATAN: ${w}`);

const { db, pool } = createDb(env.DATABASE_URL);
console.log("Menjalankan migrasi…");
await runMigrations(db);
await ensureDefaultRoles(db);

const boss = createBoss(env.DATABASE_URL);
await boss.start();
await registerJobs(boss, db, await schoolTimeZone(db));

const app = createApp({
  db,
  pool,
  boss,
  config: {
    version: env.APP_VERSION,
    appUrl: env.APP_URL,
    trustCloudflare: env.TRUST_CLOUDFLARE,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY,
  },
  verifyTurnstile: createTurnstileVerifier(env.TURNSTILE_SECRET_KEY),
  storage: createStorage(env.DATA_DIR),
  staticDir: "dist/client",
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) =>
  console.log(`TARBIYAH ${env.APP_VERSION} berjalan di port ${info.port}`),
);

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} diterima, berhenti dengan rapi…`);
  server.close();
  await boss.stop({ graceful: true, wait: true, timeout: 20_000 });
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
