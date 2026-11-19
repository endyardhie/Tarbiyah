import type PgBoss from "pg-boss";
import { QUEUES } from "./queues";

export async function registerJobs(boss: PgBoss, timeZone: string) {
  await boss.createQueue(QUEUES.heartbeat);
  await boss.schedule(QUEUES.heartbeat, "0 * * * *", {}, { tz: timeZone });
  await boss.work(QUEUES.heartbeat, async () => {
    console.log(`[heartbeat] ${new Date().toISOString()}`);
  });
}
