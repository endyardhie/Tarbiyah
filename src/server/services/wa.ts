import { eq, sql } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import type { z } from "zod";
import type { PengaturanWaView, pengaturanWaSchema } from "../../shared/keuangan";
import type { Db, Tx } from "../db/client";
import { waOutbox } from "../db/schema";
import { QUEUES } from "../jobs/queues";
import { decryptSecret, type Encrypted, encryptSecret } from "../lib/crypto";
import { type GowaConfig, gowaSend } from "../lib/wa";
import { readSetting, writeSetting } from "./pengaturan";
import { bossDb } from "./push";

type WaStored = {
  aktif: boolean;
  url: string;
  user: string;
  password: Encrypted | null;
  deviceId: string;
  jedaDetik: number;
};
const DEFAULT_WA: WaStored = {
  aktif: false,
  url: "",
  user: "",
  password: null,
  deviceId: "",
  jedaDetik: 4,
};

/** 1 kirim pertama + 3 kali coba ulang. */
export const WA_MAX_PERCOBAAN = 4;

export async function getWaView(db: Db): Promise<PengaturanWaView> {
  const { password, ...rest } = await readSetting(db, "wa", DEFAULT_WA);
  return { ...rest, password: { terisi: !!password } };
}

export async function saveWa(
  tx: Db | Tx,
  input: z.output<typeof pengaturanWaSchema>,
  encryptionKey: string,
) {
  const before = await readSetting(tx, "wa", DEFAULT_WA);
  const { password, ...rest } = input;
  const value: WaStored = {
    ...rest,
    password: password ? encryptSecret(password, encryptionKey) : before.password,
  };
  await writeSetting(tx, "wa", value, true);
}

/** Konfigurasi siap pakai (password terbuka) atau null bila WA nonaktif/belum lengkap. */
export async function getWaConfig(
  db: Db,
  encryptionKey: string,
): Promise<(GowaConfig & { jedaDetik: number }) | null> {
  const s = await readSetting(db, "wa", DEFAULT_WA);
  if (!s.aktif || !s.url) return null;
  return {
    url: s.url,
    user: s.user,
    password: s.password ? decryptSecret(s.password, encryptionKey) : "",
    deviceId: s.deviceId,
    jedaDetik: s.jedaDetik,
  };
}

export type WaItem = { nomor: string; pesan: string; rujukanTipe: string; rujukanId: string };

/**
 * Tulis pesan ke wa_outbox + job "wa.send" dalam transaksi pemanggil (aturan: WA tidak pernah
 * dikirim langsung di request). `priority` lebih tinggi didahulukan (OTP).
 */
export async function queueWa(
  tx: Db,
  client: pg.PoolClient,
  boss: PgBoss,
  items: WaItem[],
  opts: { priority?: number } = {},
) {
  if (!items.length) return [];
  const rows = await tx.insert(waOutbox).values(items).returning({ id: waOutbox.id });
  await boss.insert(
    rows.map((r) => ({
      name: QUEUES.waSend,
      data: { outboxId: r.id },
      priority: opts.priority ?? 0,
      // Coba ulang diatur sendiri lewat kolom percobaan agar status "gagal" tercatat.
      retryLimit: WA_MAX_PERCOBAAN - 1,
      retryDelay: 60,
      retryBackoff: true,
    })),
    { db: bossDb(client) },
  );
  return rows.map((r) => r.id);
}

type Deps = {
  db: Db;
  encryptionKey: string;
  send?: typeof gowaSend;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Proses satu pesan antrean. Nonaktif → "dilewati". Gagal → error dicatat dan dilempar agar
 * pg-boss mencoba lagi; setelah WA_MAX_PERCOBAAN → "gagal" (bisa dikirim ulang bendahara).
 */
export async function processWaJob(deps: Deps, outboxId: string) {
  const { db } = deps;
  const [row] = await db.select().from(waOutbox).where(eq(waOutbox.id, outboxId));
  if (!row || row.status !== "antri") return row?.status ?? "tidak-ada";
  const cfg = await getWaConfig(db, deps.encryptionKey);
  if (!cfg) {
    await db
      .update(waOutbox)
      .set({ status: "dilewati", error: "WA gateway nonaktif" })
      .where(eq(waOutbox.id, outboxId));
    return "dilewati";
  }
  const percobaan = row.percobaan + 1;
  try {
    await (deps.send ?? gowaSend)(cfg, row.nomor, row.pesan);
    await db
      .update(waOutbox)
      .set({ status: "terkirim", percobaan, error: null, terkirimAt: new Date() })
      .where(eq(waOutbox.id, outboxId));
    return "terkirim";
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    const habis = percobaan >= WA_MAX_PERCOBAAN;
    await db
      .update(waOutbox)
      .set({ status: habis ? "gagal" : "antri", percobaan, error })
      .where(eq(waOutbox.id, outboxId));
    if (habis) return "gagal";
    throw e;
  } finally {
    // Jeda antar-pesan agar nomor sekolah tidak ditandai spam (worker berkonkurensi 1).
    await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(cfg.jedaDetik * 1000);
  }
}

/** Kirim ulang pesan yang gagal/dilewati: status kembali "antri" + job baru. */
export async function resendWa(tx: Db, client: pg.PoolClient, boss: PgBoss, id: string) {
  const [row] = await tx
    .update(waOutbox)
    .set({ status: "antri", percobaan: 0, error: null })
    .where(sql`${waOutbox.id} = ${id} and ${waOutbox.status} in ('gagal', 'dilewati')`)
    .returning({ id: waOutbox.id });
  if (!row) return false;
  await boss.insert(
    [
      {
        name: QUEUES.waSend,
        data: { outboxId: id },
        retryLimit: WA_MAX_PERCOBAAN - 1,
        retryDelay: 60,
        retryBackoff: true,
      },
    ],
    { db: bossDb(client) },
  );
  return true;
}
