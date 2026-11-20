import { and, eq, inArray, sql } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import {
  DEFAULT_KEUANGAN,
  formatRupiah,
  hitungPotongan,
  isiTemplate,
  labelPeriode,
  METODE_LABEL,
  type PengaturanKeuangan,
} from "../../shared/keuangan";
import { type Db, type Tx, transactionWithClient } from "../db/client";
import { paymentIntent, paymentIntentItem, pembayaran, tagihan } from "../db/schema";
import { schoolToday } from "../lib/tanggal";
import type { PaymentState } from "../payment/types";
import { getIdentitas, readSetting, schoolTimeZone } from "./pengaturan";
import { notify } from "./push";
import { queueWa } from "./wa";

/** Daftar uuid untuk `in (...)` di SQL mentah. */
export const uuidList = (ids: string[]) =>
  sql.join(
    ids.map((i) => sql`${i}::uuid`),
    sql`, `,
  );

export const getKeuangan = (db: Db) =>
  readSetting<PengaturanKeuangan>(db, "keuangan", DEFAULT_KEUANGAN);

/** Admin + pengguna aktif yang jabatannya punya izin tertentu (penerima notifikasi). */
export async function usersWithPermission(db: Db, izin: string): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    select distinct u.id from users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    left join role_permissions rp on rp.role_id = r.id and rp.izin = ${izin}
    where u.status = 'aktif' and (r.admin or rp.izin is not null)`);
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------- pembuatan tagihan

export type CalonTagihan = {
  santriId: string;
  pendaftaranId: string;
  nama: string;
  nis: string;
  kelasNama: string;
  unitKode: string;
  lokasiNama: string;
  nominal: number | null;
  potongan: number;
  total: number;
  status: "baru" | "sudah" | "tanpa_tarif" | "bebas";
};

export type HasilBuatTagihan = {
  periode: string;
  ditagih: boolean;
  tahunAjaran: { id: string; nama: string } | null;
  jatuhTempo: string;
  items: CalonTagihan[];
  dibuat: number;
};

/**
 * Tagihan SPP satu periode untuk santri aktif: tarif unit+lokasi tahun ajaran periode itu − potongan.
 * Idempoten (unik santri+jenis+periode). `simpan: false` = pratinjau saja.
 */
export async function buatTagihan(
  db: Db,
  periode: string,
  opts: { simpan: boolean },
): Promise<HasilBuatTagihan> {
  const set = await getKeuangan(db);
  const bulan = Number(periode.slice(5));
  const ditagih = set.bulanDitagih.includes(bulan);
  const jatuhTempo = `${periode}-${String(set.tanggalJatuhTempo).padStart(2, "0")}`;
  const { rows: taRows } = await db.execute<{ id: string; nama: string }>(sql`
    select id, nama from tahun_ajaran
    where to_char(mulai, 'YYYY-MM') <= ${periode} and to_char(selesai, 'YYYY-MM') >= ${periode}
    order by aktif desc, mulai desc limit 1`);
  const ta = taRows[0] ?? null;
  if (!ta) return { periode, ditagih, tahunAjaran: null, jatuhTempo, items: [], dibuat: 0 };

  const { rows } = await db.execute<{
    santri_id: string;
    pendaftaran_id: string;
    nama: string;
    nis: string;
    kelas_nama: string;
    unit_kode: string;
    lokasi_nama: string;
    tarif: number | null;
    pot_jenis: "nominal" | "persen" | null;
    pot_nilai: number | null;
    sudah: boolean;
  }>(sql`
    select s.id santri_id, p.id pendaftaran_id, s.nama, s.nis, k.nama kelas_nama,
      u.kode unit_kode, l.nama lokasi_nama, t.nominal::float8 tarif,
      pot.jenis pot_jenis, pot.nilai::float8 pot_nilai,
      exists (select 1 from tagihan tg where tg.santri_id = s.id and tg.jenis = 'spp'
        and tg.periode = ${periode}) sudah
    from pendaftaran p
    join santri s on s.id = p.santri_id and s.status = 'aktif'
    join kelas k on k.id = p.kelas_id
    join units u on u.id = k.unit_id
    join lokasi l on l.id = k.lokasi_id
    left join tarif_spp t on t.tahun_ajaran_id = p.tahun_ajaran_id and t.unit_id = k.unit_id
      and t.lokasi_id = k.lokasi_id
    left join potongan pot on pot.santri_id = s.id and pot.tahun_ajaran_id = p.tahun_ajaran_id
    where p.tahun_ajaran_id = ${ta.id} and p.status = 'aktif'
    order by l.nama, u.kode, k.nama, s.nama`);

  const items: CalonTagihan[] = rows.map((r) => {
    const pot =
      r.tarif === null || !r.pot_jenis
        ? 0
        : hitungPotongan(r.tarif, { jenis: r.pot_jenis, nilai: r.pot_nilai ?? 0 });
    const total = (r.tarif ?? 0) - pot;
    return {
      santriId: r.santri_id,
      pendaftaranId: r.pendaftaran_id,
      nama: r.nama,
      nis: r.nis,
      kelasNama: r.kelas_nama,
      unitKode: r.unit_kode,
      lokasiNama: r.lokasi_nama,
      nominal: r.tarif,
      potongan: pot,
      total,
      status: r.sudah ? "sudah" : r.tarif === null ? "tanpa_tarif" : total <= 0 ? "bebas" : "baru",
    };
  });

  let dibuat = 0;
  const baru = items.filter((i) => i.status === "baru");
  if (opts.simpan && ditagih && baru.length) {
    const inserted = await db
      .insert(tagihan)
      .values(
        baru.map((i) => ({
          santriId: i.santriId,
          pendaftaranId: i.pendaftaranId,
          jenis: "spp",
          periode,
          nominal: i.nominal ?? 0,
          potongan: i.potongan,
          total: i.total,
          jatuhTempo,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: tagihan.id });
    dibuat = inserted.length;
  }
  return { periode, ditagih, tahunAjaran: ta, jatuhTempo, items, dibuat };
}

/** Job harian 03.00: tagihan bulan berjalan dibuat hanya pada tanggal 1 (zona waktu sekolah). */
export async function tagihanHarian(db: Db, now = new Date()) {
  const today = schoolToday(await schoolTimeZone(db), now);
  if (!today.endsWith("-01")) return null;
  return buatTagihan(db, today.slice(0, 7), { simpan: true });
}

// ---------------------------------------------------------------- pelunasan

export type ItemBayar = { tagihanId: string; jumlah: number; providerRef?: string | null };

/**
 * SATU-SATUNYA tempat status "lunas" ditetapkan (pembayaran manual, webhook, rekonsiliasi).
 * Idempoten: tagihan yang sudah lunas dilewati. Mengembalikan id pembayaran yang baru dibuat.
 */
export async function markInvoicesPaid(
  tx: Db | Tx,
  p: {
    items: ItemBayar[];
    metode: "tunai" | "transfer" | "gateway";
    intentId?: string | null;
    dicatatOleh?: string | null;
    catatan?: string | null;
    dibayarAt?: Date | null;
  },
): Promise<string[]> {
  const dibayarAt = p.dibayarAt ?? new Date();
  const ids: string[] = [];
  for (const item of p.items) {
    const [t] = await tx
      .select({ status: tagihan.status })
      .from(tagihan)
      .where(eq(tagihan.id, item.tagihanId))
      .for("update");
    if (!t || t.status === "lunas") continue;
    // Tagihan yang dibatalkan tapi tetap dibayar lewat QRIS: uang sudah masuk → dicatat lunas.
    const [row] = await tx
      .insert(pembayaran)
      .values({
        tagihanId: item.tagihanId,
        jumlah: item.jumlah,
        metode: p.metode,
        providerRef: item.providerRef ?? null,
        intentId: p.intentId ?? null,
        catatan: p.catatan ?? null,
        dicatatOleh: p.dicatatOleh ?? null,
        dibayarAt,
      })
      .onConflictDoNothing()
      .returning({ id: pembayaran.id });
    if (!row) continue;
    await tx
      .update(tagihan)
      .set({ status: "lunas", lunasAt: dibayarAt })
      .where(eq(tagihan.id, item.tagihanId));
    ids.push(row.id);
  }
  return ids;
}

/** Tanggal panjang Indonesia di zona waktu sekolah. */
function tanggalPanjang(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(d);
}

/**
 * Antrekan bukti bayar WA ke semua nomor wali (punya WA, penerima tagihan) per santri.
 * Pembayaran dari satu transaksi QRIS digabung jadi satu pesan. Mengembalikan jumlah pesan.
 */
export async function antriBuktiWa(
  tx: Db,
  client: pg.PoolClient,
  boss: PgBoss,
  pembayaranIds: string[],
) {
  if (!pembayaranIds.length) return 0;
  const { rows } = await tx.execute<{
    id: string;
    santri_id: string;
    santri_nama: string;
    periode: string;
    jumlah: number;
    metode: keyof typeof METODE_LABEL;
    dibayar_at: Date;
    grup: string;
  }>(sql`
    select pb.id, s.id santri_id, s.nama santri_nama, t.periode, pb.jumlah::float8 jumlah,
      pb.metode, pb.dibayar_at, coalesce(pb.intent_id::text, pb.id::text) grup
    from pembayaran pb
    join tagihan t on t.id = pb.tagihan_id
    join santri s on s.id = t.santri_id
    where pb.id in (${uuidList(pembayaranIds)})
    order by t.periode`);
  const santriIds = [...new Set(rows.map((r) => r.santri_id))];
  const { rows: nomor } = await tx.execute<{ santri_id: string; nomor: string }>(sql`
    select distinct sw.santri_id, up.nomor from santri_wali sw
    join users u on u.id = sw.user_id and u.status = 'aktif'
    join user_phones up on up.user_id = u.id and up.punya_wa
    where sw.penerima_tagihan and sw.santri_id in (${uuidList(santriIds)})`);
  // Berurutan: satu koneksi transaksi tidak boleh menjalankan query paralel.
  const set = await getKeuangan(tx);
  const ident = await getIdentitas(tx);
  const timeZone = ident.zonaWaktu;

  const grup = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = `${r.santri_id}|${r.grup}`;
    grup.set(key, [...(grup.get(key) ?? []), r]);
  }
  const pesan = [];
  for (const list of grup.values()) {
    const first = list[0];
    if (!first) continue;
    const teks = isiTemplate(set.templateBukti, {
      nama_santri: first.santri_nama,
      bulan: list.map((r) => labelPeriode(r.periode)).join(", "),
      jumlah: formatRupiah(list.reduce((a, r) => a + r.jumlah, 0)),
      metode: METODE_LABEL[first.metode],
      tanggal: tanggalPanjang(new Date(first.dibayar_at), timeZone),
      nama_lembaga: ident.nama,
    });
    for (const n of nomor.filter((x) => x.santri_id === first.santri_id)) {
      pesan.push({ nomor: n.nomor, pesan: teks, rujukanTipe: "pembayaran", rujukanId: first.id });
    }
  }
  if (!pesan.length) return 0;
  await queueWa(tx, client, boss, pesan);
  const punyaNomor = new Set(nomor.map((n) => n.santri_id));
  const terkirim = rows.filter((r) => punyaNomor.has(r.santri_id)).map((r) => r.id);
  await tx
    .update(pembayaran)
    .set({ buktiWaDikirimAt: new Date() })
    .where(inArray(pembayaran.id, terkirim));
  return pesan.length;
}

// ---------------------------------------------------------------- status dari provider

type ApplyDeps = { db: Db; pool: pg.Pool; boss: PgBoss };

/**
 * Terapkan keadaan transaksi dari provider (webhook, rekonsiliasi, tombol cek status).
 * Lunas → cek jumlah = total intent → markInvoicesPaid → bukti WA + push. Idempoten.
 */
export async function applyPaymentState(deps: ApplyDeps, provider: string, state: PaymentState) {
  return transactionWithClient(deps.pool, async (tx, client) => {
    const [intent] = await tx
      .select()
      .from(paymentIntent)
      .where(
        and(eq(paymentIntent.provider, provider), eq(paymentIntent.providerRef, state.providerRef)),
      )
      .for("update");
    if (!intent) return "tidak-dikenal" as const;

    if (state.status !== "lunas") {
      if (intent.status === "menunggu" && state.status !== "menunggu") {
        await tx
          .update(paymentIntent)
          .set({ status: state.status })
          .where(eq(paymentIntent.id, intent.id));
      }
      return state.status;
    }
    if (intent.status === "lunas") return "sudah" as const;

    const bendahara = () => usersWithPermission(tx, "keuangan.kelola");
    // Nominal yang dibayar harus sama dengan yang ditampilkan di QRIS (termasuk kode unik),
    // nominal dasar sama dengan total intent, dan transaksi memang milik intent ini.
    const harus = intent.jumlahBayar ?? intent.total;
    const cocok =
      state.externalId === intent.id &&
      state.jumlah === intent.total &&
      state.jumlahBayar === harus;
    if (!cocok) {
      if (intent.status !== "selisih") {
        await tx
          .update(paymentIntent)
          .set({ status: "selisih" })
          .where(eq(paymentIntent.id, intent.id));
        await notify(tx, client, deps.boss, await bendahara(), {
          jenis: "keuangan",
          judul: "Pembayaran QRIS tidak cocok",
          isi: `Transaksi ${state.providerRef}: diterima ${formatRupiah(state.jumlahBayar)}, seharusnya ${formatRupiah(harus)}. Tagihan belum ditandai lunas — periksa di Keuangan › Laporan › Perlu dicek.`,
          url: "/keuangan",
          pengirimUserId: null,
        });
      }
      return "selisih" as const;
    }

    const items = await tx
      .select()
      .from(paymentIntentItem)
      .where(eq(paymentIntentItem.intentId, intent.id));
    const paid = await markInvoicesPaid(tx, {
      items: items.map((i) => ({
        tagihanId: i.tagihanId,
        jumlah: i.nominal,
        providerRef: `${state.providerRef}/${i.tagihanId}`,
      })),
      metode: "gateway",
      intentId: intent.id,
      dibayarAt: state.dibayarAt,
    });
    await tx
      .update(paymentIntent)
      .set({ status: "lunas", lunasAt: state.dibayarAt ?? new Date() })
      .where(eq(paymentIntent.id, intent.id));
    if (paid.length) {
      await antriBuktiWa(tx, client, deps.boss, paid);
      await notify(tx, client, deps.boss, [intent.userId], {
        jenis: "keuangan",
        judul: "Pembayaran diterima",
        isi: `Pembayaran ${formatRupiah(intent.total)} sudah kami terima. Terima kasih.`,
        url: "/keuangan",
        pengirimUserId: null,
      });
    }
    if (paid.length < items.length) {
      // Sebagian tagihan sudah lunas lebih dulu (mis. dibayar tunai) → uang lebih, cek manual.
      await notify(tx, client, deps.boss, await bendahara(), {
        jenis: "keuangan",
        judul: "Pembayaran ganda perlu dicek",
        isi: `Transaksi QRIS ${state.providerRef} membayar tagihan yang sudah lunas sebelumnya. Periksa di Keuangan › Laporan › Perlu dicek.`,
        url: "/keuangan",
        pengirimUserId: null,
      });
    }
    return "lunas" as const;
  });
}
