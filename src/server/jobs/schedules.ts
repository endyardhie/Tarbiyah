import { sql } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { Db } from "../db/client";
import type { B2, B2Config } from "../lib/b2";
import { safeError } from "../lib/log";
import { pemeliharaan } from "../lib/pemeliharaan";
import type { Storage } from "../lib/storage";
import {
  backupTerjadwal,
  eksklusif,
  jalankanBackup,
  notifyAdmin,
  PESAN_SIBUK,
  sinkronBerkas,
} from "../services/backup";
import { tagihanHarian } from "../services/keuangan";
import { rekonsiliasi } from "../services/pembayaran-online";
import { sendPush } from "../services/push";
import { processWaJob } from "../services/wa";
import { QUEUES } from "./queues";

/** Jadwal cron dalam zona waktu sekolah. Aman dipanggil ulang (pg-boss menimpa jadwal lama). */
export async function scheduleJobs(boss: PgBoss, timeZone: string) {
  await boss.schedule(QUEUES.heartbeat, "0 * * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.cleanup, "30 2 * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.tagihanBuat, "0 3 * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.rekonsiliasi, "*/15 * * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.backupCek, "0 2 * * *", {}, { tz: timeZone });
  await boss.schedule(QUEUES.filesSync, "15 * * * *", {}, { tz: timeZone });
}

export type JobConfig = {
  encryptionKey: string;
  appUrl: string;
  storage: Storage;
  databaseUrl: string;
  version: string;
  makeB2?: (cfg: B2Config) => B2;
};

export async function registerJobs(
  boss: PgBoss,
  db: Db,
  pool: pg.Pool,
  timeZone: string,
  cfg: JobConfig,
) {
  for (const q of Object.values(QUEUES)) await boss.createQueue(q);
  await scheduleJobs(boss, timeZone);
  await registerWorkers(boss, db, pool, cfg);
}

/** Hentikan semua worker (job yang sedang berjalan dibiarkan selesai). Dipakai restore. */
export async function jedaWorkers(boss: PgBoss) {
  for (const q of Object.values(QUEUES)) await boss.offWork(q);
}

/** Pasang worker semua antrean (saat start dan setelah restore). */
export async function registerWorkers(boss: PgBoss, db: Db, pool: pg.Pool, cfg: JobConfig) {
  const backupDeps = { db, pool, boss, ...cfg };

  // Selama restore (mode pemeliharaan) job ditunda, bukan digagalkan.
  const siap =
    <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
    async (...a: A) => {
      await pemeliharaan.tunggu();
      await fn(...a);
    };

  // Interval polling diperbesar: bawaan pg-boss 2 detik per worker = query terus-menerus saat menganggur.
  await boss.work(
    QUEUES.heartbeat,
    { pollingIntervalSeconds: 60 },
    siap(async () => console.log(`[heartbeat] ${new Date().toISOString()}`)),
  );
  // Bersih-bersih sesi, batas percobaan, dan OTP yang sudah kedaluwarsa.
  await boss.work(
    QUEUES.cleanup,
    { pollingIntervalSeconds: 60 },
    siap(async () => {
      await db.execute(sql`delete from sessions where kedaluwarsa < now()`);
      await db.execute(sql`delete from rate_limits where reset_at < now()`);
      await db.execute(sql`delete from otp_codes where kedaluwarsa < now() - interval '1 day'`);
      // Cadangan bila worker WA tidak sempat memproses: pesan OTP lama tetap disamarkan.
      await db.execute(sql`update wa_outbox set pesan = regexp_replace(pesan, '[0-9]{6}', '******', 'g')
        where rujukan_tipe = 'otp' and dibuat_at < now() - interval '1 hour' and pesan ~ '[0-9]{6}'`);
    }),
  );

  // Tagihan SPP bulan berjalan dibuat tanggal 1 (idempoten; terlewat → tombol "Buat tagihan").
  await boss.work(
    QUEUES.tagihanBuat,
    { pollingIntervalSeconds: 60 },
    siap(async () => {
      const hasil = await tagihanHarian(db);
      if (hasil) console.log(`[tagihan] ${hasil.periode}: ${hasil.dibuat} tagihan dibuat`);
    }),
  );

  // Cadangan webhook pembayaran yang hilang.
  await boss.work(
    QUEUES.rekonsiliasi,
    { pollingIntervalSeconds: 60 },
    siap(() => rekonsiliasi({ db, pool, boss, config: cfg })),
  );

  // Backup: cek jadwal harian, backup manual dari halaman Backup, dan salin berkas tiap jam.
  await boss.work(
    QUEUES.backupCek,
    { pollingIntervalSeconds: 60 },
    siap(() => backupTerjadwal(backupDeps).catch((e) => console.error(`[backup] ${safeError(e)}`))),
  );
  await boss.work<{ userId: string | null }>(
    QUEUES.backupRun,
    { batchSize: 1, pollingIntervalSeconds: 5 },
    siap(async ([job]) => {
      await eksklusif(() =>
        jalankanBackup(backupDeps, { jenis: "manual", userId: job?.data.userId ?? null }),
      ).catch(async (e) => {
        console.error(`[backup] ${safeError(e)}`);
        // Kegagalan backup sudah diberitahukan oleh jalankanBackup; yang belum: dilewati karena sibuk.
        if (e instanceof Error && e.message === PESAN_SIBUK) {
          await notifyAdmin(
            backupDeps,
            "Backup manual tidak dijalankan",
            "Backup atau restore lain sedang berjalan. Coba lagi setelah selesai.",
          ).catch(() => {});
        }
      });
    }),
  );
  await boss.work(
    QUEUES.filesSync,
    { pollingIntervalSeconds: 60 },
    siap(() => sinkronBerkas(backupDeps)),
  );

  // WA: satu worker (konkurensi 1), jeda antar-pesan diatur di processWaJob.
  await boss.work<{ outboxId: string }>(
    QUEUES.waSend,
    { batchSize: 1, pollingIntervalSeconds: 5 },
    siap(async ([job]) => {
      if (job) await processWaJob({ db, encryptionKey: cfg.encryptionKey }, job.data.outboxId);
    }),
  );

  // Web Push: 5 worker (konkurensi 5) agar hemat memori; retry bertahap diatur per job.
  for (let i = 0; i < 5; i++) {
    await boss.work<{ subscriptionId: string; notifikasiId: string }>(
      QUEUES.pushSend,
      { batchSize: 1, pollingIntervalSeconds: 10 },
      siap(async ([job]) => {
        if (job) await sendPush(db, cfg, job.data);
      }),
    );
  }
}
