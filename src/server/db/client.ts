import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema";

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: "drizzle" });
}

/** Pelanggaran unique constraint Postgres (langsung atau dibungkus Drizzle). */
export function isUniqueViolation(e: unknown) {
  const err = e as { code?: string; cause?: { code?: string } };
  return (err.code ?? err.cause?.code) === "23505";
}

/**
 * Transaksi dengan koneksi pg yang bisa dipakai pihak lain (mis. pg-boss `db` option) sehingga
 * job antrean ikut di-commit atau di-rollback bersama data.
 */
export async function transactionWithClient<T>(
  pool: pg.Pool,
  fn: (tx: Db, client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(drizzle(client, { schema }) as unknown as Db, client);
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
