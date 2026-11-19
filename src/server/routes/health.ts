import { Hono } from "hono";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { QUEUES } from "../jobs/queues";
import { schoolNow } from "../lib/tanggal";

export type HealthDeps = { pool: pg.Pool; boss: PgBoss; version: string; timeZone: string };

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    return Boolean(await fn());
  } catch {
    return false;
  }
}

export function healthRoutes({ pool, boss, version, timeZone }: HealthDeps) {
  return new Hono().get("/", async (c) => {
    const [db, bossOk] = await Promise.all([
      check(() => pool.query("select 1")),
      check(() => boss.getQueue(QUEUES.heartbeat)),
    ]);
    const ok = db && bossOk;
    return c.json(
      {
        ok,
        versi: version,
        waktuSekolah: schoolNow(timeZone),
        zonaWaktu: timeZone,
        db,
        boss: bossOk,
      },
      ok ? 200 : 503,
    );
  });
}
