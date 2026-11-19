import { sql } from "drizzle-orm";
import type { Db } from "../db/client";

/** Detik sampai boleh mencoba lagi, atau 0 bila belum terkunci. */
export async function lockedFor(db: Db, key: string, limit: number): Promise<number> {
  const { rows } = await db.execute<{ detik: number }>(sql`
    select ceil(extract(epoch from reset_at - now()))::int as detik
    from rate_limits where key = ${key} and reset_at > now() and jumlah >= ${limit}`);
  return rows[0]?.detik ?? 0;
}

/** Catat satu percobaan gagal dalam jendela waktu tetap. */
export async function recordFailure(db: Db, key: string, windowSec: number) {
  await db.execute(sql`
    insert into rate_limits (key, jumlah, reset_at)
    values (${key}, 1, now() + make_interval(secs => ${windowSec}))
    on conflict (key) do update set
      jumlah = case when rate_limits.reset_at <= now() then 1 else rate_limits.jumlah + 1 end,
      reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end`);
}

export async function clearFailures(db: Db, key: string) {
  await db.execute(sql`delete from rate_limits where key = ${key}`);
}
