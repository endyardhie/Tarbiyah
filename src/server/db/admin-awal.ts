// Membuat admin pertama di instalasi baru (termasuk production), hanya bila belum ada admin aktif.
// Di container: node dist/server/db/admin-awal.js 0812xxxxxxxx
// Password sementara dicetak sekali ke terminal dan wajib diganti saat login pertama.
import { normalizePhone } from "../../shared/phone";
import { tempPassword } from "../lib/password";
import { ensureDefaultRoles } from "../services/roles";
import { createFirstAdmin } from "../services/users";
import { createDb, runMigrations } from "./client";

const url = process.env.DATABASE_URL;
const nomor = normalizePhone(process.argv[2] ?? "");
if (!url || !nomor) {
  console.error("Pemakaian: node dist/server/db/admin-awal.js <nomor HP admin>");
  process.exit(1);
}

const { db, pool } = createDb(url);
let code = 0;
try {
  await runMigrations(db);
  await ensureDefaultRoles(db);
  const password = tempPassword(12);
  await createFirstAdmin(db, nomor, password);
  console.log(`Admin ${nomor} dibuat.\nPassword sementara: ${password}\nWajib diganti saat login.`);
} catch (e) {
  console.error(`Gagal: ${(e as Error).message}`);
  code = 1;
}
await pool.end();
process.exit(code);
