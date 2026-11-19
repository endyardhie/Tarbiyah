import { randomBytes } from "node:crypto";
import pg from "pg";
import { createDb, runMigrations } from "../../src/server/db/client";

const ADMIN_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://tarbiyah:tarbiyah@localhost:5432/tarbiyah";

/** Database baru yang kosong + sudah dimigrasi, khusus satu berkas tes. */
export async function createTestDb() {
  const name = `test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const { db, pool } = createDb(url.toString());
  await runMigrations(db);

  return {
    url: url.toString(),
    db,
    pool,
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}
