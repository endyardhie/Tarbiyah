import { and, eq, inArray, sql } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { labelPeriode } from "../../shared/keuangan";
import type { Db } from "../db/client";
import { paymentIntent, paymentIntentItem, santri, tagihan } from "../db/schema";
import { fail } from "../lib/context";
import { safeError } from "../lib/log";
import { getProvider } from "../payment/registry";
import { applyPaymentState } from "./keuangan";

type Deps = {
  db: Db;
  pool: pg.Pool;
  boss: PgBoss;
  config: { encryptionKey: string; appUrl: string };
};

/** Batas nominal satu transaksi QRIS. */
const MAX_QRIS = 10_000_000;

export type IntentView = {
  id: string;
  status: string;
  total: number;
  jumlahBayar: number | null;
  qris: string | null;
  kedaluwarsaAt: string | null;
  bulan: string[];
};

export async function intentView(db: Db, id: string): Promise<IntentView | null> {
  const [i] = await db.select().from(paymentIntent).where(eq(paymentIntent.id, id));
  if (!i) return null;
  const items = await db
    .select({ periode: tagihan.periode })
    .from(paymentIntentItem)
    .innerJoin(tagihan, eq(tagihan.id, paymentIntentItem.tagihanId))
    .where(eq(paymentIntentItem.intentId, id))
    .orderBy(tagihan.periode);
  // Lewat batas waktu tapi rekonsiliasi belum jalan: tampil sebagai kedaluwarsa, QR disembunyikan.
  const lewat = i.status === "menunggu" && !!i.kedaluwarsaAt && i.kedaluwarsaAt <= new Date();
  const status = lewat ? "kedaluwarsa" : i.status;
  return {
    id: i.id,
    status,
    total: i.total,
    jumlahBayar: i.jumlahBayar,
    qris: status === "menunggu" ? i.qris : null,
    kedaluwarsaAt: i.kedaluwarsaAt?.toISOString() ?? null,
    bulan: items.map((x) => labelPeriode(x.periode)),
  };
}

/**
 * Wali memilih beberapa tagihan anaknya → satu payment_intent → QRIS dari provider.
 * Tagihan yang masih menunggu di intent lain (belum kedaluwarsa) ditolak, kecuali pilihannya
 * persis sama dan dibuat oleh wali yang sama (QRIS lama ditampilkan lagi).
 */
export async function buatIntent(
  deps: Deps,
  user: { id: string; anak: string[] },
  tagihanIds: string[],
): Promise<IntentView> {
  const { db } = deps;
  const ap = await getProvider(db, deps.config);
  if (!ap?.aktif) throw fail(409, "Pembayaran online belum aktif. Silakan bayar ke bendahara.");
  const ids = [...new Set(tagihanIds)];

  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: tagihan.id,
        santriId: tagihan.santriId,
        status: tagihan.status,
        total: tagihan.total,
        nis: santri.nis,
      })
      .from(tagihan)
      .innerJoin(santri, eq(santri.id, tagihan.santriId))
      .where(inArray(tagihan.id, ids))
      .for("update", { of: tagihan });
    if (rows.length !== ids.length || rows.some((r) => !user.anak.includes(r.santriId))) {
      throw fail(404, "Tagihan tidak ditemukan");
    }
    if (rows.some((r) => r.status !== "belum")) {
      throw fail(409, "Ada tagihan yang sudah lunas atau dibatalkan. Muat ulang halaman.");
    }
    const { rows: pending } = await tx.execute<{ intent_id: string; user_id: string; n: number }>(
      sql`
      select i.id intent_id, i.user_id,
        (select count(*)::int from payment_intent_item x where x.intent_id = i.id) n
      from payment_intent i join payment_intent_item it on it.intent_id = i.id
      where i.status = 'menunggu' and (i.kedaluwarsa_at is null or i.kedaluwarsa_at > now())
        and it.tagihan_id in (${sql.join(
          ids.map((i) => sql`${i}::uuid`),
          sql`, `,
        )})
      group by i.id`,
    );
    const p = pending[0];
    if (p) {
      if (pending.length === 1 && p.user_id === user.id && p.n === ids.length) {
        const [same] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(paymentIntentItem)
          .where(
            and(
              eq(paymentIntentItem.intentId, p.intent_id),
              inArray(paymentIntentItem.tagihanId, ids),
            ),
          );
        if (same?.n === ids.length) return { reuse: p.intent_id, intent: null, nis: "" };
      }
      throw fail(
        409,
        "Sebagian tagihan sedang menunggu pembayaran QRIS lain. Selesaikan atau tunggu kedaluwarsa.",
      );
    }
    const total = rows.reduce((a, r) => a + r.total, 0);
    if (total > MAX_QRIS)
      throw fail(400, "Total melebihi batas QRIS Rp 10.000.000. Pilih lebih sedikit bulan.");
    const [intent] = await tx
      .insert(paymentIntent)
      .values({ provider: ap.provider.name, userId: user.id, total })
      .returning();
    if (!intent) throw new Error("intent gagal dibuat");
    await tx
      .insert(paymentIntentItem)
      .values(rows.map((r) => ({ intentId: intent.id, tagihanId: r.id, nominal: r.total })));
    return { reuse: null, intent, nis: rows[0]?.nis ?? "" };
  });

  if (created.reuse) {
    const view = await intentView(db, created.reuse);
    if (!view) throw fail(404, "Tagihan tidak ditemukan");
    return view;
  }
  const { intent, nis } = created;
  if (!intent) throw new Error("intent tidak dibuat");
  try {
    const state = await ap.provider.createCharge({
      externalId: intent.id,
      amount: intent.total,
      callbackUrl: ap.urlWebhook,
      ref: `SPP ${nis}`,
      expirySeconds: ap.kedaluwarsaMenit * 60,
    });
    await db
      .update(paymentIntent)
      .set({
        providerRef: state.providerRef,
        qris: state.qris,
        jumlahBayar: state.jumlahBayar,
        kedaluwarsaAt: state.kedaluwarsaAt,
      })
      .where(eq(paymentIntent.id, intent.id));
  } catch (e) {
    console.error(`[pembayaran] createCharge: ${safeError(e)}`);
    await db.update(paymentIntent).set({ status: "batal" }).where(eq(paymentIntent.id, intent.id));
    throw fail(409, "Layanan pembayaran sedang bermasalah. Coba lagi beberapa saat lagi.");
  }
  const view = await intentView(db, intent.id);
  if (!view) throw new Error("intent hilang");
  return view;
}

/** Tanya status ke provider lalu terapkan (tombol "Cek status" & rekonsiliasi). */
export async function cekIntent(deps: Deps, intentId: string) {
  const [i] = await deps.db.select().from(paymentIntent).where(eq(paymentIntent.id, intentId));
  if (!i?.providerRef) return null;
  const ap = await getProvider(deps.db, deps.config, { name: i.provider });
  if (!ap) return null;
  const state = await ap.provider.getStatus(i.providerRef);
  return applyPaymentState(deps, i.provider, state);
}

/**
 * Cadangan bila webhook hilang (jadwal tiap 15 menit): intent menunggu, juga yang kedaluwarsa
 * < 2 hari (bisa dibayar terlambat). Intent tanpa providerRef > 5 menit = createCharge gagal → batal.
 */
export async function rekonsiliasi(deps: Deps) {
  await deps.db.execute(sql`
    update payment_intent set status = 'batal'
    where status = 'menunggu' and provider_ref is null and dibuat_at < now() - interval '5 minutes'`);
  const { rows } = await deps.db.execute<{ id: string }>(sql`
    select id from payment_intent
    where provider_ref is not null and (status = 'menunggu'
      or (status = 'kedaluwarsa' and dibuat_at > now() - interval '2 days'))
    order by dibuat_at limit 100`);
  let diperiksa = 0;
  for (const r of rows) {
    try {
      await cekIntent(deps, r.id);
      diperiksa++;
    } catch (e) {
      console.error(`[rekonsiliasi] ${r.id}: ${safeError(e)}`);
    }
  }
  return diperiksa;
}
