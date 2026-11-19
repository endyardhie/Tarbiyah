// Admin awal (dan nanti data contoh) untuk development/staging. Ditolak di production.
// Di container: node dist/server/db/seed.js
import { eq } from "drizzle-orm";
import { normalizePhone } from "../../shared/phone";
import { hashPassword } from "../lib/password";
import { ensureDefaultRoles } from "../services/roles";
import { createDb, runMigrations } from "./client";
import { roles, userPhones, userRoles, users } from "./schema";

if (process.env.NODE_ENV === "production") {
  console.error("Seed ditolak: NODE_ENV=production");
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

const [existing] = await db.select().from(userPhones).where(eq(userPhones.nomor, nomor));
if (existing) {
  console.log(`Admin ${nomor} sudah ada, dilewati.`);
} else {
  const passwordHash = await hashPassword(password);
  await db.transaction(async (tx) => {
    const [admin] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.admin, true));
    const [user] = await tx
      .insert(users)
      .values({ nama: "Administrator", passwordHash, wajibGantiPassword: true })
      .returning({ id: users.id });
    if (!admin || !user) throw new Error("Jabatan Admin tidak ditemukan");
    await tx.insert(userPhones).values({ userId: user.id, nomor, label: "Pribadi" });
    await tx.insert(userRoles).values({ userId: user.id, roleId: admin.id });
  });
  console.log(`Admin ${nomor} dibuat. Wajib ganti password saat login pertama.`);
}
await pool.end();
