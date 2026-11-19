import { Hono } from "hono";
import { QUEUES } from "../jobs/queues";
import type { AppDeps, AppEnv } from "../lib/context";
import { schoolNow } from "../lib/tanggal";

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    return Boolean(await fn());
  } catch {
    return false;
  }
}

export function healthRoutes({ pool, boss, config }: AppDeps) {
  return new Hono<AppEnv>().get("/", async (c) => {
    const [db, bossOk] = await Promise.all([
      check(() => pool.query("select 1")),
      check(() => boss.getQueue(QUEUES.heartbeat)),
    ]);
    const ok = db && bossOk;
    return c.json(
      {
        ok,
        versi: config.version,
        waktuSekolah: schoolNow(config.timeZone),
        zonaWaktu: config.timeZone,
        db,
        boss: bossOk,
      },
      ok ? 200 : 503,
    );
  });
}
