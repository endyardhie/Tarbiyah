// Admin awal (dan nanti data contoh) untuk development/staging. Ditolak di production.
// Di container: node dist/server/db/seed.js
import { normalizePhone } from "../../shared/phone";
import { ensureDefaultRoles } from "../services/roles";
import { createFirstAdmin } from "../services/users";
import { createDb, runMigrations } from "./client";

if (process.env.NODE_ENV === "production") {
  console.error("Seed ditolak: NODE_ENV=production. Untuk admin pertama pakai admin-awal.js.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
const nomor = normalizePhone(process.env.SEED_ADMIN_PHONE ?? "");
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
if (!url || !nomor || password.length < 8) {
  console.error(
    "Isi DATABASE_URL, SEED_ADMIN_PHONE (nomor HP valid), dan SEED_ADMIN_PASSWORD (min. 8).",
  );
  process.exit(1);
}

const { db, pool } = createDb(url);
await runMigrations(db);
await ensureDefaultRoles(db);
try {
  await createFirstAdmin(db, nomor, password);
  console.log(`Admin ${nomor} dibuat. Wajib ganti password saat login pertama.`);
} catch (e) {
  console.log(`Admin dilewati: ${(e as Error).message}`);
}
await pool.end();
