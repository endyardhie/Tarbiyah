import { and, eq, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import {
  batalSchema,
  bayarManualSchema,
  bayarOnlineSchema,
  labelPeriode,
  METODE_LABEL,
  periodeSchema,
  potonganSchema,
  type TagihanRow,
  tarifSchema,
} from "../../shared/keuangan";
import { transactionWithClient } from "../db/client";
import {
  lokasi,
  paymentIntent,
  pembayaran,
  potongan,
  santri,
  tagihan,
  tarifSpp,
  units,
  waOutbox,
} from "../db/schema";
import { audit } from "../lib/audit";
import { can } from "../lib/can";
import {
  type AppDeps,
  type AppEnv,
  currentUser,
  fail,
  paramId,
  parseBody,
  queryId,
} from "../lib/context";
import { requireAnyPermission, requirePermission, requireUser } from "../lib/guards";
import { safeError } from "../lib/log";
import { schoolToday } from "../lib/tanggal";
import { uuidv7 } from "../lib/uuid";
import { getProvider } from "../payment/registry";
import {
  antriBuktiWa,
  applyPaymentState,
  buatTagihan,
  markInvoicesPaid,
  uuidList,
} from "../services/keuangan";
import { buatIntent, cekIntent, intentView } from "../services/pembayaran-online";
import { schoolTimeZone } from "../services/pengaturan";
import { activeTahunAjaran } from "../services/sekolah";
import { getWaConfig, resendWa } from "../services/wa";

const tanggal = z.iso.date();
const STATUS_TAGIHAN = ["belum", "lunas", "batal"] as const;

/** Tagihan menunggu QRIS yang belum kedaluwarsa: tidak boleh dibatalkan. */
const menungguQris = (tagihanId: string | SQL) => sql`exists (
  select 1 from payment_intent_item it join payment_intent i on i.id = it.intent_id
  where it.tagihan_id = ${tagihanId} and i.status = 'menunggu'
    and (i.kedaluwarsa_at is null or i.kedaluwarsa_at > now()))`;

export function keuanganRoutes(deps: AppDeps) {
  const { db, pool, boss } = deps;
  const lihat = requireAnyPermission("keuangan.lihat", "keuangan.kelola", "keuangan.catat_manual");
  const kelola = requirePermission("keuangan.kelola");
  const catat = requireAnyPermission("keuangan.kelola", "keuangan.catat_manual");
  const today = async () => schoolToday(await schoolTimeZone(db), deps.now?.() ?? new Date());
  const onlineDeps = { db, pool, boss, config: deps.config };

  /** Filter tagihan dari query (dipakai daftar & ekspor). */
  function filterTagihan(q: (k: string) => string | undefined) {
    const where = [sql`true`];
    const periode = q("periode");
    if (periode) {
      if (!periodeSchema.safeParse(periode).success) throw fail(400, "Periode tidak valid");
      where.push(sql`t.periode = ${periode}`);
    }
    const status = q("status");
    if (status) {
      if (!(STATUS_TAGIHAN as readonly string[]).includes(status))
        throw fail(400, "Status tidak valid");
      where.push(sql`t.status = ${status}`);
    }
    const id = (k: string) => {
      const v = q(k);
      if (v && !z.uuid().safeParse(v).success) throw fail(400, `Parameter ${k} tidak valid`);
      return v;
    };
    const lokasiId = id("lokasiId");
    const unitId = id("unitId");
    const kelasId = id("kelasId");
    if (lokasiId) where.push(sql`k.lokasi_id = ${lokasiId}`);
    if (unitId) where.push(sql`k.unit_id = ${unitId}`);
    if (kelasId) where.push(sql`k.id = ${kelasId}`);
    return sql.join(where, sql` and `);
  }

  const tagihanSelect = sql`
    select t.id, t.santri_id "santriId", s.nama "santriNama", s.nis, k.nama "kelasNama",
      u.kode "unitKode", l.nama "lokasiNama", t.periode, t.nominal::float8 nominal,
      t.potongan::float8 potongan, t.total::float8 total, t.jatuh_tempo::text "jatuhTempo",
      t.status, t.alasan_batal "alasanBatal", t.lunas_at "lunasAt",
      ${menungguQris(sql`t.id`)} "menungguQris",
      case when pb.id is null then null else json_build_object('id', pb.id, 'metode', pb.metode,
        'dibayarAt', pb.dibayar_at, 'buktiWaDikirimAt', pb.bukti_wa_dikirim_at) end pembayaran
    from tagihan t
    join santri s on s.id = t.santri_id
    join pendaftaran p on p.id = t.pendaftaran_id
    join kelas k on k.id = p.kelas_id
    join units u on u.id = k.unit_id
    join lokasi l on l.id = k.lokasi_id
    left join pembayaran pb on pb.tagihan_id = t.id`;

  return (
    new Hono<AppEnv>()
      .use(requireUser)
      // ------------------------------------------------------------ bendahara
      .get("/tagihan", lihat, async (c) => {
        const where = filterTagihan((k) => c.req.query(k));
        const { rows } = await db.execute<TagihanRow>(sql`${tagihanSelect} where ${where}
          order by t.periode desc, l.nama, u.kode, k.nama, s.nama limit 2000`);
        return c.json(rows);
      })
      .get("/tagihan/pratinjau", kelola, async (c) => {
        const periode = periodeSchema.safeParse(c.req.query("periode"));
        if (!periode.success) throw fail(400, "Periode tidak valid");
        return c.json(await buatTagihan(db, periode.data, { simpan: false }));
      })
      .post("/tagihan/buat", kelola, async (c) => {
        const { periode } = await parseBody(c, z.object({ periode: periodeSchema }));
        const hasil = await buatTagihan(db, periode, { simpan: true });
        if (!hasil.tahunAjaran) throw fail(400, "Tidak ada tahun ajaran untuk periode ini");
        if (!hasil.ditagih)
          throw fail(400, `${labelPeriode(periode)} tidak termasuk bulan yang ditagih`);
        await audit(db, {
          userId: currentUser(c).id,
          aksi: "tagihan.buat",
          entitas: "tagihan",
          entitasId: periode,
          sesudah: { periode, dibuat: hasil.dibuat },
          ip: c.get("ip"),
        });
        return c.json({ periode, dibuat: hasil.dibuat });
      })
      .post("/tagihan/:id/bayar", catat, async (c) => {
        const id = paramId(c);
        const input = await parseBody(c, bayarManualSchema);
        const user = currentUser(c);
        const pembayaranId = await db.transaction(async (tx) => {
          const [t] = await tx.select().from(tagihan).where(eq(tagihan.id, id)).for("update");
          if (!t) throw fail(404, "Tagihan tidak ditemukan");
          if (t.status !== "belum") throw fail(409, "Tagihan sudah lunas atau dibatalkan");
          const [pid] = await markInvoicesPaid(tx, {
            items: [{ tagihanId: id, jumlah: t.total }],
            metode: input.metode,
            dicatatOleh: user.id,
            catatan: input.catatan,
            dibayarAt: deps.now?.() ?? new Date(),
          });
          await audit(tx, {
            userId: user.id,
            aksi: "pembayaran.catat",
            entitas: "tagihan",
            entitasId: id,
            sebelum: { status: t.status },
            sesudah: { status: "lunas", metode: input.metode, jumlah: t.total, pembayaranId: pid },
            ip: c.get("ip"),
          });
          return pid;
        });
        return c.json({ pembayaranId });
      })
      .post("/tagihan/:id/batal", kelola, async (c) => {
        const id = paramId(c);
        const { alasan } = await parseBody(c, batalSchema);
        const user = currentUser(c);
        await db.transaction(async (tx) => {
          const [t] = await tx.select().from(tagihan).where(eq(tagihan.id, id)).for("update");
          if (!t) throw fail(404, "Tagihan tidak ditemukan");
          if (t.status !== "belum")
            throw fail(409, "Hanya tagihan belum lunas yang bisa dibatalkan");
          const { rows } = await tx.execute<{ ada: boolean }>(sql`select ${menungguQris(id)} ada`);
          if (rows[0]?.ada) {
            throw fail(
              409,
              "Tagihan sedang menunggu pembayaran QRIS wali. Coba lagi setelah kedaluwarsa.",
            );
          }
          await tx
            .update(tagihan)
            .set({ status: "batal", alasanBatal: alasan, dibatalkanOleh: user.id })
            .where(eq(tagihan.id, id));
          await audit(tx, {
            userId: user.id,
            aksi: "tagihan.batal",
            entitas: "tagihan",
            entitasId: id,
            sebelum: { status: t.status },
            sesudah: { status: "batal", alasan },
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      })
      .post("/pembayaran/:id/kirim-bukti", catat, async (c) => {
        const id = paramId(c);
        const [pb] = await db
          .select({ id: pembayaran.id })
          .from(pembayaran)
          .where(eq(pembayaran.id, id));
        if (!pb) throw fail(404, "Pembayaran tidak ditemukan");
        const pesan = await transactionWithClient(pool, (tx, client) =>
          antriBuktiWa(tx, client, boss, [id]),
        );
        if (!pesan) throw fail(409, "Wali santri ini belum punya nomor WhatsApp penerima tagihan");
        const waAktif = !!(await getWaConfig(db, deps.config.encryptionKey));
        return c.json({ pesan, waAktif });
      })
      // ------------------------------------------------------------ tarif & potongan
      .get("/tarif", lihat, async (c) => {
        const ta = await activeTahunAjaran(db);
        if (!ta) return c.json({ tahunAjaran: null, units: [], lokasi: [], tarif: [] });
        const [u, l, t] = await Promise.all([
          db.select().from(units).where(eq(units.aktif, true)).orderBy(units.urutan),
          db.select().from(lokasi).where(eq(lokasi.aktif, true)).orderBy(lokasi.nama),
          db.select().from(tarifSpp).where(eq(tarifSpp.tahunAjaranId, ta.id)),
        ]);
        return c.json({ tahunAjaran: { id: ta.id, nama: ta.nama }, units: u, lokasi: l, tarif: t });
      })
      .put("/tarif", kelola, async (c) => {
        const input = await parseBody(c, tarifSchema);
        const ta = await activeTahunAjaran(db);
        if (!ta) throw fail(400, "Belum ada tahun ajaran aktif");
        await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(tarifSpp)
            .where(
              and(
                eq(tarifSpp.tahunAjaranId, ta.id),
                eq(tarifSpp.unitId, input.unitId),
                eq(tarifSpp.lokasiId, input.lokasiId),
              ),
            );
          await tx
            .insert(tarifSpp)
            .values({ tahunAjaranId: ta.id, ...input })
            .onConflictDoUpdate({
              target: [tarifSpp.tahunAjaranId, tarifSpp.unitId, tarifSpp.lokasiId],
              set: { nominal: input.nominal },
            });
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "tarif.simpan",
            entitas: "tarif_spp",
            entitasId: before?.id ?? null,
            sebelum: before ?? null,
            sesudah: { tahunAjaranId: ta.id, ...input },
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      })
      .get("/potongan", lihat, async (c) => {
        const ta = await activeTahunAjaran(db);
        if (!ta) return c.json([]);
        const rows = await db
          .select({
            id: potongan.id,
            santriId: potongan.santriId,
            santriNama: santri.nama,
            nis: santri.nis,
            jenis: potongan.jenis,
            nilai: potongan.nilai,
            alasan: potongan.alasan,
          })
          .from(potongan)
          .innerJoin(santri, eq(santri.id, potongan.santriId))
          .where(eq(potongan.tahunAjaranId, ta.id))
          .orderBy(santri.nama);
        return c.json(rows);
      })
      /** Santri aktif tahun ajaran aktif (pilihan potongan; bendahara tidak punya izin santri.lihat). */
      .get("/santri", lihat, async (c) => {
        const { rows } = await db.execute(sql`
          select s.id, s.nis, s.nama, k.nama "kelasNama", u.kode "unitKode"
          from pendaftaran p join tahun_ajaran ta on ta.id = p.tahun_ajaran_id and ta.aktif
          join santri s on s.id = p.santri_id and s.status = 'aktif'
          join kelas k on k.id = p.kelas_id join units u on u.id = k.unit_id
          where p.status = 'aktif' order by s.nama`);
        return c.json(rows);
      })
      .put("/potongan", kelola, async (c) => {
        const input = await parseBody(c, potonganSchema);
        const ta = await activeTahunAjaran(db);
        if (!ta) throw fail(400, "Belum ada tahun ajaran aktif");
        await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(potongan)
            .where(and(eq(potongan.santriId, input.santriId), eq(potongan.tahunAjaranId, ta.id)));
          await tx
            .insert(potongan)
            .values({ tahunAjaranId: ta.id, ...input })
            .onConflictDoUpdate({
              target: [potongan.santriId, potongan.tahunAjaranId],
              set: { jenis: input.jenis, nilai: input.nilai, alasan: input.alasan },
            });
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "potongan.simpan",
            entitas: "potongan",
            entitasId: input.santriId,
            sebelum: before ?? null,
            sesudah: input,
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      })
      .delete("/potongan/:id", kelola, async (c) => {
        const id = paramId(c);
        await db.transaction(async (tx) => {
          const [before] = await tx.delete(potongan).where(eq(potongan.id, id)).returning();
          if (!before) throw fail(404, "Potongan tidak ditemukan");
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "potongan.hapus",
            entitas: "potongan",
            entitasId: before.santriId,
            sebelum: before,
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      })
      // ------------------------------------------------------------ laporan
      .get("/laporan", lihat, async (c) => {
        const dari = tanggal.safeParse(c.req.query("dari"));
        const sampai = tanggal.safeParse(c.req.query("sampai"));
        if (!dari.success || !sampai.success) throw fail(400, "Rentang tanggal tidak valid");
        if (dari.data > sampai.data) throw fail(400, "Tanggal awal harus sebelum tanggal akhir");
        const hari = (Date.parse(sampai.data) - Date.parse(dari.data)) / 86_400_000;
        if (hari > 366) throw fail(400, "Rentang laporan maksimal satu tahun");
        const tz = await schoolTimeZone(db);
        const hariIni = await today();
        const { rows: pembayaranRows } = await db.execute<{
          id: string;
          dibayarAt: string;
          santriNama: string;
          nis: string;
          periode: string;
          jumlah: number;
          metode: keyof typeof METODE_LABEL;
          dicatatOleh: string | null;
        }>(sql`
          select pb.id, pb.dibayar_at "dibayarAt", s.nama "santriNama", s.nis, t.periode,
            pb.jumlah::float8 jumlah, pb.metode, u.nama "dicatatOleh"
          from pembayaran pb
          join tagihan t on t.id = pb.tagihan_id
          join santri s on s.id = t.santri_id
          left join users u on u.id = pb.dicatat_oleh
          where (pb.dibayar_at at time zone ${tz})::date between ${dari.data} and ${sampai.data}
          order by pb.dibayar_at`);
        const { rows: tunggakan } = await db.execute<{
          santriId: string;
          santriNama: string;
          nis: string;
          kelasNama: string;
          unitKode: string;
          lokasiNama: string;
          bulan: number;
          jumlah: number;
          periode: string[];
        }>(sql`
          select s.id "santriId", s.nama "santriNama", s.nis, k.nama "kelasNama",
            u.kode "unitKode", l.nama "lokasiNama", count(*)::int bulan,
            sum(t.total)::float8 jumlah, array_agg(t.periode order by t.periode) periode
          from tagihan t
          join santri s on s.id = t.santri_id
          join pendaftaran p on p.id = t.pendaftaran_id
          join kelas k on k.id = p.kelas_id
          join units u on u.id = k.unit_id
          join lokasi l on l.id = k.lokasi_id
          where t.status = 'belum' and t.jatuh_tempo < ${hariIni}
          group by s.id, k.nama, u.kode, l.nama
          order by l.nama, u.kode, k.nama, s.nama`);
        const perMetode = Object.keys(METODE_LABEL).map((m) => {
          const list = pembayaranRows.filter((r) => r.metode === m);
          return { metode: m, n: list.length, jumlah: list.reduce((a, r) => a + r.jumlah, 0) };
        });
        return c.json({
          dari: dari.data,
          sampai: sampai.data,
          hariIni,
          perMetode,
          pembayaran: pembayaranRows,
          tunggakan,
        });
      })
      .get("/ekspor.csv", lihat, async (c) => {
        const where = filterTagihan((k) => c.req.query(k));
        const tz = await schoolTimeZone(db);
        const cell = (v: unknown) => {
          const s = v === null || v === undefined ? "" : String(v);
          // Cegah formula injection di Excel/Sheets.
          const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
          return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        };
        c.header("Content-Type", "text/csv; charset=utf-8");
        c.header("Content-Disposition", 'attachment; filename="tagihan.csv"');
        c.header("Cache-Control", "no-store");
        return stream(c, async (s) => {
          await s.write(
            "﻿NIS,Nama,Kelas,Unit,Lokasi,Periode,Nominal,Potongan,Total,Jatuh tempo,Status,Metode,Tanggal bayar,Alasan batal\n",
          );
          // Streaming per 500 baris (keyset) agar memori tetap kecil.
          let after = "00000000-0000-0000-0000-000000000000";
          for (;;) {
            const { rows } = await db.execute<TagihanRow>(sql`${tagihanSelect}
              where ${where} and t.id > ${after}::uuid order by t.id limit 500`);
            if (!rows.length) break;
            let out = "";
            for (const r of rows) {
              out += `${[
                r.nis,
                r.santriNama,
                r.kelasNama,
                r.unitKode,
                r.lokasiNama,
                r.periode,
                r.nominal,
                r.potongan,
                r.total,
                r.jatuhTempo,
                r.status,
                r.pembayaran ? METODE_LABEL[r.pembayaran.metode] : "",
                r.pembayaran ? schoolToday(tz, new Date(r.pembayaran.dibayarAt)) : "",
                r.alasanBatal,
              ]
                .map(cell)
                .join(",")}\n`;
            }
            await s.write(out);
            after = rows[rows.length - 1]?.id ?? after;
          }
        });
      })
      .get("/ringkasan", lihat, async (c) => {
        const hariIni = await today();
        const periode = hariIni.slice(0, 7);
        const tz = await schoolTimeZone(db);
        const { rows } = await db.execute<{
          tagihan: number;
          nTagihan: number;
          terbayar: number;
          nLunas: number;
          tunggakan: number;
          nTunggak: number;
          penerimaan: number;
        }>(sql`
          select
            coalesce(sum(total) filter (where periode = ${periode} and status <> 'batal'), 0)::float8 tagihan,
            count(*) filter (where periode = ${periode} and status <> 'batal')::int "nTagihan",
            coalesce(sum(total) filter (where periode = ${periode} and status = 'lunas'), 0)::float8 terbayar,
            count(*) filter (where periode = ${periode} and status = 'lunas')::int "nLunas",
            coalesce(sum(total) filter (where status = 'belum' and jatuh_tempo < ${hariIni}), 0)::float8 tunggakan,
            count(distinct santri_id) filter (where status = 'belum' and jatuh_tempo < ${hariIni})::int "nTunggak",
            (select coalesce(sum(jumlah), 0)::float8 from pembayaran
              where to_char(dibayar_at at time zone ${tz}, 'YYYY-MM') = ${periode}) penerimaan
          from tagihan`);
        const { rows: terbaru } = await db.execute(sql`
          select pb.id, s.nama "santriNama", t.periode, pb.jumlah::float8 jumlah, pb.metode,
            pb.dibayar_at "dibayarAt"
          from pembayaran pb join tagihan t on t.id = pb.tagihan_id
          join santri s on s.id = t.santri_id
          order by pb.dibayar_at desc limit 5`);
        return c.json({ periode, ...rows[0], terbaru });
      })
      /** QRIS selisih / bayar ganda yang belum diperiksa bendahara. */
      .get("/perlu-dicek", lihat, async (c) => {
        const { rows } = await db.execute(sql`
          select i.id, i.provider_ref "providerRef", i.total::float8 total,
            i.jumlah_bayar::float8 "jumlahBayar", i.dibuat_at "dibuatAt", i.lunas_at "lunasAt",
            case when i.status = 'selisih' then 'selisih' else 'ganda' end jenis,
            u.nama "waliNama", string_agg(distinct s.nama, ', ') "santriNama",
            array_agg(t.periode order by t.periode) periode
          from payment_intent i
          join users u on u.id = i.user_id
          join payment_intent_item it on it.intent_id = i.id
          join tagihan t on t.id = it.tagihan_id
          join santri s on s.id = t.santri_id
          where i.dicek_at is null and (i.status = 'selisih' or (i.status = 'lunas' and exists (
            select 1 from payment_intent_item x join pembayaran p on p.tagihan_id = x.tagihan_id
            where x.intent_id = i.id and p.intent_id is distinct from i.id)))
          group by i.id, u.nama
          order by i.dibuat_at desc limit 100`);
        return c.json(rows);
      })
      .post("/perlu-dicek/:id/selesai", kelola, async (c) => {
        const id = paramId(c);
        const { catatan } = await parseBody(
          c,
          z.object({
            catatan: z.string().trim().min(3, "Tulis catatan hasil pemeriksaan").max(300),
          }),
        );
        const user = currentUser(c);
        await db.transaction(async (tx) => {
          const [row] = await tx
            .update(paymentIntent)
            .set({ dicekAt: new Date(), dicekOleh: user.id, catatanCek: catatan })
            .where(and(eq(paymentIntent.id, id), sql`${paymentIntent.dicekAt} is null`))
            .returning({ id: paymentIntent.id, status: paymentIntent.status });
          if (!row) throw fail(404, "Data tidak ditemukan");
          await audit(tx, {
            userId: user.id,
            aksi: "pembayaran.dicek",
            entitas: "payment_intent",
            entitasId: id,
            sesudah: { status: row.status, catatan },
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      })
      // ------------------------------------------------------------ antrean WA
      .get("/wa", lihat, async (c) => {
        const status = c.req.query("status");
        // Pesan OTP berisi kode rahasia: tidak pernah ditampilkan.
        const rows = await db
          .select({
            id: waOutbox.id,
            nomor: waOutbox.nomor,
            pesan: waOutbox.pesan,
            status: waOutbox.status,
            percobaan: waOutbox.percobaan,
            error: waOutbox.error,
            dibuatAt: waOutbox.dibuatAt,
            terkirimAt: waOutbox.terkirimAt,
          })
          .from(waOutbox)
          .where(
            and(
              eq(waOutbox.rujukanTipe, "pembayaran"),
              status ? sql`${waOutbox.status} = ${status}` : undefined,
            ),
          )
          .orderBy(sql`${waOutbox.dibuatAt} desc`)
          .limit(200);
        return c.json(rows);
      })
      .post("/wa/:id/kirim-ulang", catat, async (c) => {
        const id = paramId(c);
        const [row] = await db.select().from(waOutbox).where(eq(waOutbox.id, id));
        if (!row || row.rujukanTipe !== "pembayaran") throw fail(404, "Pesan tidak ditemukan");
        const ok = await transactionWithClient(pool, (tx, client) =>
          resendWa(tx, client, boss, id),
        );
        if (!ok) throw fail(409, "Hanya pesan gagal/dilewati yang bisa dikirim ulang");
        return c.json({ ok: true });
      })
      // ------------------------------------------------------------ wali santri
      .get("/anak", async (c) => {
        const user = currentUser(c);
        const anak = user.relasi.anak;
        if (!anak.length) return c.json({ online: false, anak: [], menunggu: [] });
        const ap = await getProvider(db, deps.config);
        const list = await db
          .select({ id: santri.id, nama: santri.nama, nis: santri.nis })
          .from(santri)
          .where(sql`${santri.id} in (${uuidList(anak)})`)
          .orderBy(santri.nama);
        const { rows: tg } = await db.execute<TagihanRow>(sql`${tagihanSelect}
          where t.santri_id in (${uuidList(anak)}) and t.status <> 'batal'
          order by t.periode desc`);
        const { rows: menunggu } = await db.execute<{ id: string }>(sql`
          select id from payment_intent where user_id = ${user.id} and status = 'menunggu'
            and kedaluwarsa_at > now() order by dibuat_at desc`);
        return c.json({
          online: !!ap?.aktif,
          anak: list.map((a) => ({
            ...a,
            tagihan: tg.filter((t) => t.santriId === a.id).slice(0, 24),
          })),
          menunggu: menunggu.map((m) => m.id),
        });
      })
      .post("/bayar", async (c) => {
        const user = currentUser(c);
        const { tagihanIds } = await parseBody(c, bayarOnlineSchema);
        // Hanya wali santri (relasi anak) yang membayar online; dicek lagi per tagihan.
        if (!user.relasi.anak.length) throw fail(403, "Anda tidak punya akses");
        return c.json(
          await buatIntent(onlineDeps, { id: user.id, anak: user.relasi.anak }, tagihanIds),
        );
      })
      .get("/intent/:id", async (c) => {
        const id = paramId(c);
        const [i] = await db.select().from(paymentIntent).where(eq(paymentIntent.id, id));
        if (!i || i.userId !== currentUser(c).id) throw fail(404, "Data tidak ditemukan");
        return c.json(await intentView(db, id));
      })
      .post("/intent/:id/cek", async (c) => {
        const id = paramId(c);
        const user = currentUser(c);
        const [i] = await db.select().from(paymentIntent).where(eq(paymentIntent.id, id));
        const staf = await can(user, "keuangan.kelola");
        if (!i || (i.userId !== user.id && !staf)) throw fail(404, "Data tidak ditemukan");
        try {
          await cekIntent(onlineDeps, id);
        } catch (e) {
          console.error(`[pembayaran] cek ${id}: ${safeError(e)}`);
          throw fail(409, "Status belum bisa dicek. Coba lagi sebentar.");
        }
        return c.json(await intentView(db, id));
      })
  );
}

/**
 * Webhook provider pembayaran (tanpa sesi & tanpa cek Origin). Urutan: verifikasi tanda tangan →
 * simpan webhook_event (unik) → proses idempoten. Gagal diproses → 500 agar provider mengirim ulang.
 */
export function webhookRoutes(deps: AppDeps) {
  const { db } = deps;
  return new Hono<AppEnv>().post("/:provider", async (c) => {
    const name = c.req.param("provider");
    const raw = await c.req.text();
    const ap = await getProvider(db, deps.config, { name });
    if (!ap) throw fail(404, "Tidak ditemukan");
    if (!ap.provider.verifyWebhook(c.req.raw.headers, raw, deps.now?.() ?? new Date())) {
      throw fail(401, "Tanda tangan tidak valid");
    }
    let ev: ReturnType<typeof ap.provider.parseWebhook>;
    try {
      ev = ap.provider.parseWebhook(raw);
    } catch {
      throw fail(400, "Isi webhook tidak dikenal");
    }
    const { rows } = await db.execute<{ id: string }>(sql`
      insert into webhook_event (id, provider, event_id, payload)
      values (${uuidv7()}, ${name}, ${ev.eventId}, ${raw}::jsonb)
      on conflict (provider, event_id) do update set payload = excluded.payload
        where webhook_event.status in ('gagal', 'diterima')
      returning id`);
    const eventRow = rows[0];
    if (!eventRow) return c.json({ ok: true, duplikat: true });
    try {
      const hasil = await applyPaymentState(deps, name, ev.state);
      await db.execute(sql`update webhook_event set status = ${hasil === "tidak-dikenal" ? "diabaikan" : "diproses"},
        error = null, diproses_at = now() where id = ${eventRow.id}`);
      return c.json({ ok: true, hasil });
    } catch (e) {
      await db.execute(sql`update webhook_event set status = 'gagal', error = ${safeError(e)}
        where id = ${eventRow.id}`);
      throw e;
    }
  });
}
