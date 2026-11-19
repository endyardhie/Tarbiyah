import { Hono } from "hono";
import { QUEUES } from "../jobs/queues";
import type { AppDeps, AppEnv } from "../lib/context";
import { schoolNow } from "../lib/tanggal";
import { schoolTimeZone } from "../services/pengaturan";

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    return Boolean(await fn());
  } catch {
    return false;
  }
}

export function healthRoutes({ db, pool, boss, config }: AppDeps) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const [dbOk, bossOk] = await Promise.all([
      check(() => pool.query("select 1")),
      check(() => boss.getQueue(QUEUES.heartbeat)),
    ]);
    const ok = dbOk && bossOk;
    const zona = dbOk ? await schoolTimeZone(db) : "Asia/Jayapura";
    return c.json(
      {
        ok,
        versi: config.version,
        waktuSekolah: schoolNow(zona),
        zonaWaktu: zona,
        db: dbOk,
        boss: bossOk,
      },
      ok ? 200 : 503,
    );
  });
}
