import { eq, inArray } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { generateVAPIDKeys, sendNotification } from "web-push";
import type { Db } from "../db/client";
import { notifikasi, pushSubscriptions, settings } from "../db/schema";
import { QUEUES } from "../jobs/queues";
import { decryptSecret, type Encrypted, encryptSecret, KEY_VERSION } from "../lib/crypto";
import { getIdentitas } from "./pengaturan";

type Vapid = { publicKey: string; privateKey: string };
const vapidCache = new WeakMap<object, Vapid>();

/** Kunci VAPID dibuat sekali saat pertama dibutuhkan; kunci privat disimpan terenkripsi. */
export async function getVapid(db: Db, encryptionKey: string): Promise<Vapid> {
  const hit = vapidCache.get(db);
  if (hit) return hit;
  const read = async () => {
    const [row] = await db.select().from(settings).where(eq(settings.key, "vapid"));
    if (!row) return null;
    const v = row.value as { publicKey: string; privateKey: Encrypted };
    return { publicKey: v.publicKey, privateKey: decryptSecret(v.privateKey, encryptionKey) };
  };
  let vapid = await read();
  if (!vapid) {
    const keys = generateVAPIDKeys();
    await db
      .insert(settings)
      .values({
        key: "vapid",
        value: {
          publicKey: keys.publicKey,
          privateKey: encryptSecret(keys.privateKey, encryptionKey),
        },
        terenkripsi: true,
        versiKunci: KEY_VERSION,
      })
      .onConflictDoNothing();
    vapid = await read(); // proses lain bisa saja menang lebih dulu
  }
  if (!vapid) throw new Error("Kunci VAPID gagal dibuat");
  vapidCache.set(db, vapid);
  return vapid;
}

export type NotifInput = {
  jenis: string;
  judul: string;
  isi: string;
  url?: string | null;
  pengirimUserId: string | null;
};

/** Adapter agar pg-boss menulis job memakai koneksi transaksi yang sama. */
export const bossDb = (client: pg.PoolClient): PgBoss.Db => ({
  executeSql: (text, values) => client.query(text, values),
});

/**
 * Tulis notifikasi untuk penerima + satu job "push.send" per perangkat, di dalam transaksi pemanggil
 * (lihat transactionWithClient). Bila transaksi gagal, notifikasi & job ikut batal.
 */
export async function notify(
  tx: Db,
  client: pg.PoolClient,
  boss: PgBoss,
  penerima: string[],
  n: NotifInput,
): Promise<number> {
  const ids = [...new Set(penerima)];
  if (!ids.length) return 0;
  const rows = await tx
    .insert(notifikasi)
    .values(
      ids.map((userId) => ({
        userId,
        jenis: n.jenis,
        judul: n.judul,
        isi: n.isi,
        url: n.url ?? null,
        pengirimId: n.pengirimUserId,
      })),
    )
    .returning({ id: notifikasi.id, userId: notifikasi.userId });
  const subs = await tx
    .select({ id: pushSubscriptions.id, userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, ids));
  const notifByUser = new Map(rows.map((r) => [r.userId, r.id]));
  if (subs.length) {
    await boss.insert(
      subs.map((s) => ({
        name: QUEUES.pushSend,
        data: { subscriptionId: s.id, notifikasiId: notifByUser.get(s.userId) },
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 120,
      })),
      { db: bossDb(client) },
    );
  }
  return rows.length;
}

type Sender = typeof sendNotification;

/**
 * Kirim satu Web Push. 404/410 = langganan sudah tidak berlaku → dihapus.
 * Error lain dilempar agar pg-boss mencoba lagi bertahap.
 */
export async function sendPush(
  db: Db,
  cfg: { encryptionKey: string; appUrl: string },
  job: { subscriptionId: string; notifikasiId: string },
  send: Sender = sendNotification,
) {
  const [sub] = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.id, job.subscriptionId));
  const [n] = await db.select().from(notifikasi).where(eq(notifikasi.id, job.notifikasiId));
  if (!sub || !n) return "dilewati";
  const vapid = await getVapid(db, cfg.encryptionKey);
  const ident = await getIdentitas(db);
  const subject = cfg.appUrl.startsWith("https://") ? cfg.appUrl : "mailto:noreply@example.invalid";
  try {
    await send(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({
        judul: n.judul,
        isi: n.isi,
        url: n.url ?? "/notifikasi",
        icon: ident.ikon192Id ? `/api/files/${ident.ikon192Id}` : "/icons/icon-192.png",
        tag: n.id,
      }),
      { vapidDetails: { subject, ...vapid }, TTL: 24 * 60 * 60 },
    );
    return "terkirim";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      return "langganan-dihapus";
    }
    throw new Error(`Push gagal (status ${status ?? "?"})`);
  }
}

/** Dipanggil setelah restore: kunci VAPID ikut berganti dari backup. */
export function lupakanCacheVapid(db: Db) {
  vapidCache.delete(db);
}
