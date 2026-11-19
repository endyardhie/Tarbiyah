import { sql } from "drizzle-orm";
import type PgBoss from "pg-boss";
import type { Db } from "../db/client";
import { QUEUES } from "./queues";

/** Jadwal cron dalam zona waktu sekolah. Aman dipanggil ulang (pg-boss menimpa jadwal lama). */
export async function scheduleJobs(boss: PgBoss, timeZone: string) {
  await boss.schedule(QUEUES.heartbeat, "0 * * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.cleanup, "30 2 * * *", {}, { tz: timeZone });
}

export async function registerJobs(boss: PgBoss, db: Db, timeZone: string) {
  await boss.createQueue(QUEUES.heartbeat);
  await boss.createQueue(QUEUES.cleanup);
  await scheduleJobs(boss, timeZone);

  await boss.work(QUEUES.heartbeat, async () => {
    console.log(`[heartbeat] ${new Date().toISOString()}`);
  });
  // Bersih-bersih sesi & batas percobaan yang sudah kedaluwarsa (OTP menyusul di M6).
  await boss.work(QUEUES.cleanup, async () => {
    await db.execute(sql`delete from sessions where kedaluwarsa < now()`);
    await db.execute(sql`delete from rate_limits where reset_at < now()`);
  });
}
