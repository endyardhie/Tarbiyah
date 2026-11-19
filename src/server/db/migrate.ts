import { createDb, runMigrations } from "./client";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL belum diisi");
const { db, pool } = createDb(url);
await runMigrations(db);
await pool.end();
console.log("Migrasi selesai");
