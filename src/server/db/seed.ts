// Admin awal (+ data contoh dengan --contoh) untuk development/staging. Ditolak di production.
// Di container: node dist/server/db/seed.js [--contoh]
import { normalizePhone } from "../../shared/phone";
import { ensureDefaultRoles } from "../services/roles";
import { createFirstAdmin } from "../services/users";
import { createDb, runMigrations } from "./client";
import { createSampleData, createSampleNilai, PASSWORD_CONTOH } from "./contoh";

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
if (process.argv.includes("--contoh")) {
  const r = await createSampleData(db);
  console.log(
    r.dilewati
      ? "Data contoh sudah ada, dilewati."
      : `Data contoh dibuat: ${r.kelas} kelas, ${r.santri} santri, ${r.wali} wali, ${r.guru} guru. ` +
          `Semua akun contoh berpassword "${PASSWORD_CONTOH}" (nomor 628000…).`,
  );
  const n = await createSampleNilai(db);
  if (n) console.log(`Nilai contoh dibuat untuk 1 kelas (${n.santri} santri × ${n.mapel} mapel).`);
}
await pool.end();
