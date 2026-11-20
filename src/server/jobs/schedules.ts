import { sql } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { Db } from "../db/client";
import { tagihanHarian } from "../services/keuangan";
import { rekonsiliasi } from "../services/pembayaran-online";
import { schoolTimeZone } from "../services/pengaturan";
import { sendPush } from "../services/push";
import { processWaJob } from "../services/wa";
import { QUEUES } from "./queues";

/** Jadwal cron dalam zona waktu sekolah. Aman dipanggil ulang (pg-boss menimpa jadwal lama). */
export async function scheduleJobs(boss: PgBoss, timeZone: string) {
  await boss.schedule(QUEUES.heartbeat, "0 * * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.cleanup, "30 2 * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.tagihanBuat, "0 3 * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.rekonsiliasi, "*/15 * * * *", {}, { tz: timeZone });
}

export async function registerJobs(
  boss: PgBoss,
  db: Db,
  pool: pg.Pool,
  timeZone: string,
  cfg: { encryptionKey: string; appUrl: string },
) {
  await boss.createQueue(QUEUES.heartbeat);
  await boss.createQueue(QUEUES.cleanup);
  await boss.createQueue(QUEUES.pushSend);
  await boss.createQueue(QUEUES.waSend);
  await boss.createQueue(QUEUES.tagihanBuat);
  await boss.createQueue(QUEUES.rekonsiliasi);
  await scheduleJobs(boss, timeZone);

  // Interval polling diperbesar: bawaan pg-boss 2 detik per worker = query terus-menerus saat menganggur.
  await boss.work(QUEUES.heartbeat, { pollingIntervalSeconds: 60 }, async () => {
    console.log(`[heartbeat] ${new Date().toISOString()}`);
  });
  // Bersih-bersih sesi, batas percobaan, dan OTP yang sudah kedaluwarsa.
  await boss.work(QUEUES.cleanup, { pollingIntervalSeconds: 60 }, async () => {
    await db.execute(sql`delete from sessions where kedaluwarsa < now()`);
    await db.execute(sql`delete from rate_limits where reset_at < now()`);
    await db.execute(sql`delete from otp_codes where kedaluwarsa < now() - interval '1 day'`);
    // Cadangan bila worker WA tidak sempat memproses: pesan OTP lama tetap disamarkan.
    await db.execute(sql`update wa_outbox set pesan = regexp_replace(pesan, '[0-9]{6}', '******', 'g')
      where rujukan_tipe = 'otp' and dibuat_at < now() - interval '1 hour' and pesan ~ '[0-9]{6}'`);
  });

  // Tagihan SPP bulan berjalan dibuat tanggal 1 (idempoten; terlewat → tombol "Buat tagihan").
  await boss.work(QUEUES.tagihanBuat, { pollingIntervalSeconds: 60 }, async () => {
    const hasil = await tagihanHarian(db);
    if (hasil) console.log(`[tagihan] ${hasil.periode}: ${hasil.dibuat} tagihan dibuat`);
  });

  // Cadangan webhook pembayaran yang hilang.
  await boss.work(QUEUES.rekonsiliasi, { pollingIntervalSeconds: 60 }, async () => {
    await rekonsiliasi({ db, pool, boss, config: cfg });
  });

  // WA: satu worker (konkurensi 1), jeda antar-pesan diatur di processWaJob.
  await boss.work<{ outboxId: string }>(
    QUEUES.waSend,
    { batchSize: 1, pollingIntervalSeconds: 5 },
    async ([job]) => {
      if (job) await processWaJob({ db, encryptionKey: cfg.encryptionKey }, job.data.outboxId);
    },
  );

  // Web Push: 5 worker (konkurensi 5) agar hemat memori; retry bertahap diatur per job.
  for (let i = 0; i < 5; i++) {
    await boss.work<{ subscriptionId: string; notifikasiId: string }>(
      QUEUES.pushSend,
      { batchSize: 1, pollingIntervalSeconds: 10 },
      async ([job]) => {
        if (job) await sendPush(db, cfg, job.data);
      },
    );
  }
}
