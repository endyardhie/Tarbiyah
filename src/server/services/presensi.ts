import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { StatusPresensi, simpanPresensiSchema } from "../../shared/presensi";
import type { Db, Tx } from "../db/client";
import {
  agenda,
  kelas,
  liburMingguan,
  lokasi,
  pendaftaran,
  presensi,
  presensiSesi,
  santri,
  sasaran,
  tahunAjaran,
  units,
  users,
} from "../db/schema";
import { audit } from "../lib/audit";
import { type AuthUser, can } from "../lib/can";
import { fail } from "../lib/context";
import { isoWeekday } from "../lib/tanggal";

const HARI = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Ahad"];

export async function getKelas(db: Db | Tx, kelasId: string) {
  const [k] = await db
    .select({
      id: kelas.id,
      nama: kelas.nama,
      unitId: kelas.unitId,
      lokasiId: kelas.lokasiId,
      tahunAjaranId: kelas.tahunAjaranId,
      taMulai: tahunAjaran.mulai,
      taSelesai: tahunAjaran.selesai,
      unitKode: units.kode,
      lokasiNama: lokasi.nama,
      waliKelasNama: users.nama,
    })
    .from(kelas)
    .innerJoin(units, eq(units.id, kelas.unitId))
    .innerJoin(lokasi, eq(lokasi.id, kelas.lokasiId))
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, kelas.tahunAjaranId))
    .leftJoin(users, eq(users.id, kelas.waliKelasId))
    .where(eq(kelas.id, kelasId));
  if (!k) throw fail(404, "Kelas tidak ditemukan");
  return k;
}

/** Sasaran cocok dengan kelas: tiap kolom kosong atau sama dengan kelas itu. */
const sasaranCocok = (k: { id: string; unitId: string; lokasiId: string }) => sql`
  (${sasaran.unitId} is null or ${sasaran.unitId} = ${k.unitId})
  and (${sasaran.lokasiId} is null or ${sasaran.lokasiId} = ${k.lokasiId})
  and (${sasaran.kelasId} is null or ${sasaran.kelasId} = ${k.id})`;

/**
 * Hari libur untuk kelas pada tanggal sekolah: libur mingguan (semua / unit / lokasi)
 * atau agenda bertanda libur yang sasarannya mengenai kelas ini.
 */
export async function isHariLibur(db: Db | Tx, kelasId: string, tanggal: string) {
  const k = await getKelas(db, kelasId);
  const hari = isoWeekday(tanggal);
  const [mingguan] = await db
    .select({ id: liburMingguan.id })
    .from(liburMingguan)
    .where(
      and(
        eq(liburMingguan.hari, hari),
        sql`(${liburMingguan.unitId} is null or ${liburMingguan.unitId} = ${k.unitId})`,
        sql`(${liburMingguan.lokasiId} is null or ${liburMingguan.lokasiId} = ${k.lokasiId})`,
      ),
    )
    .limit(1);
  if (mingguan) return { libur: true, alasan: `Libur mingguan (${HARI[hari]})` };
  const [ag] = await db
    .select({ judul: agenda.judul })
    .from(agenda)
    .innerJoin(sasaran, eq(sasaran.agendaId, agenda.id))
    .where(
      and(
        eq(agenda.libur, true),
        lte(agenda.mulai, tanggal),
        gte(agenda.selesai, tanggal),
        sasaranCocok(k),
      ),
    )
    .limit(1);
  return ag ? { libur: true, alasan: ag.judul } : { libur: false, alasan: null };
}

/**
 * Status libur banyak kelas sekaligus (dashboard): 2 query total, bukan per kelas.
 * Aturannya sama dengan isHariLibur.
 */
export async function liburKelas(
  db: Db,
  list: { id: string; unitId: string; lokasiId: string }[],
  tanggal: string,
) {
  const hari = isoWeekday(tanggal);
  const [mingguan, agendaLibur] = await Promise.all([
    db.select().from(liburMingguan).where(eq(liburMingguan.hari, hari)),
    db
      .select({
        judul: agenda.judul,
        unitId: sasaran.unitId,
        lokasiId: sasaran.lokasiId,
        kelasId: sasaran.kelasId,
      })
      .from(agenda)
      .innerJoin(sasaran, eq(sasaran.agendaId, agenda.id))
      .where(and(eq(agenda.libur, true), lte(agenda.mulai, tanggal), gte(agenda.selesai, tanggal))),
  ]);
  const cocok = (
    r: { unitId: string | null; lokasiId: string | null; kelasId?: string | null },
    k: { id: string; unitId: string; lokasiId: string },
  ) =>
    (!r.unitId || r.unitId === k.unitId) &&
    (!r.lokasiId || r.lokasiId === k.lokasiId) &&
    (!r.kelasId || r.kelasId === k.id);
  return new Map(
    list.map((k) => {
      if (mingguan.some((m) => cocok(m, k)))
        return [k.id, { libur: true, alasan: `Libur mingguan (${HARI[hari]})` }];
      const ag = agendaLibur.find((a) => cocok(a, k));
      return [
        k.id,
        ag ? { libur: true, alasan: ag.judul } : { libur: false, alasan: null as string | null },
      ];
    }),
  );
}

/** Santri aktif di kelas + presensi tanggal itu (default H bila belum diisi). */
export async function getPresensiKelas(db: Db, kelasId: string, tanggal: string) {
  const rows = await db
    .select({
      pendaftaranId: pendaftaran.id,
      santriId: santri.id,
      nama: santri.nama,
      namaPanggilan: santri.namaPanggilan,
      noAbsen: pendaftaran.noAbsen,
      status: presensi.status,
      keterangan: presensi.keterangan,
    })
    .from(pendaftaran)
    .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
    .leftJoin(
      presensi,
      and(eq(presensi.pendaftaranId, pendaftaran.id), eq(presensi.tanggal, tanggal)),
    )
    .where(
      and(
        eq(pendaftaran.kelasId, kelasId),
        eq(pendaftaran.status, "aktif"),
        eq(santri.status, "aktif"),
      ),
    )
    .orderBy(sql`${pendaftaran.noAbsen} nulls last`, asc(santri.nama));
  const [sesi] = await db
    .select({ disimpanAt: presensiSesi.disimpanAt, disimpanOleh: users.nama })
    .from(presensiSesi)
    .leftJoin(users, eq(users.id, presensiSesi.disimpanOleh))
    .where(and(eq(presensiSesi.kelasId, kelasId), eq(presensiSesi.tanggal, tanggal)));
  return {
    sesi: sesi ?? null,
    santri: rows.map((r) => ({
      ...r,
      status: (r.status ?? "H") as StatusPresensi,
      tersimpan: r.status != null,
    })),
  };
}

/**
 * Hak mengubah presensi tanggal tertentu: hari ini → wali kelasnya (atau presensi.koreksi/admin);
 * tanggal lampau → hanya presensi.koreksi (admin). Tanggal mendatang tidak boleh.
 */
export async function bisaUbah(
  user: AuthUser,
  k: { id: string; taMulai: string; taSelesai: string },
  tanggal: string,
  today: string,
) {
  const kelasId = k.id;
  if (tanggal > today || tanggal < k.taMulai || tanggal > k.taSelesai) return false;
  if (tanggal === today) return can(user, "presensi.isi", { kelasId });
  return can(user, "presensi.koreksi");
}

export async function simpanPresensi(
  db: Db,
  user: AuthUser,
  input: z.output<typeof simpanPresensiSchema>,
  today: string,
  ip: string,
) {
  const { kelasId, tanggal, items } = input;
  if (tanggal > today) throw fail(400, "Presensi tidak bisa diisi untuk tanggal yang akan datang");
  const k = await getKelas(db, kelasId);
  if (tanggal < k.taMulai || tanggal > k.taSelesai) {
    throw fail(400, "Tanggal di luar tahun ajaran kelas ini");
  }
  if (!(await bisaUbah(user, k, tanggal, today))) {
    throw fail(
      403,
      tanggal < today
        ? "Presensi tanggal lampau hanya bisa dikoreksi oleh pemegang izin koreksi"
        : "Anda bukan wali kelas ini",
    );
  }
  const libur = await isHariLibur(db, kelasId, tanggal);
  if (libur.libur) throw fail(400, `Hari libur: ${libur.alasan}`);

  await db.transaction(async (tx) => {
    const aktif = await tx
      .select({ id: pendaftaran.id })
      .from(pendaftaran)
      .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
      .where(
        and(
          eq(pendaftaran.kelasId, kelasId),
          eq(pendaftaran.status, "aktif"),
          eq(santri.status, "aktif"),
        ),
      );
    const ids = new Set(aktif.map((a) => a.id));
    const sent = new Set(items.map((i) => i.pendaftaranId));
    // Wajib lengkap: kelas yang tersimpan berarti semua santrinya sudah dicatat.
    if (
      sent.size !== items.length ||
      sent.size !== ids.size ||
      [...sent].some((x) => !ids.has(x))
    ) {
      throw fail(400, "Daftar santri tidak sesuai dengan kelas; muat ulang halaman lalu coba lagi");
    }
    const before =
      tanggal < today
        ? await tx
            .select({
              pendaftaranId: presensi.pendaftaranId,
              status: presensi.status,
              keterangan: presensi.keterangan,
            })
            .from(presensi)
            .where(and(inArray(presensi.pendaftaranId, [...ids]), eq(presensi.tanggal, tanggal)))
        : [];
    const values = items.map((i) => ({
      pendaftaranId: i.pendaftaranId,
      tanggal,
      status: i.status,
      keterangan: i.status === "S" || i.status === "I" ? i.keterangan || null : null,
    }));
    await tx
      .insert(presensi)
      .values(values)
      .onConflictDoUpdate({
        target: [presensi.pendaftaranId, presensi.tanggal],
        set: { status: sql`excluded.status`, keterangan: sql`excluded.keterangan` },
      });
    await tx
      .insert(presensiSesi)
      .values({ kelasId, tanggal, disimpanOleh: user.id })
      .onConflictDoUpdate({
        target: [presensiSesi.kelasId, presensiSesi.tanggal],
        set: { disimpanOleh: user.id, disimpanAt: new Date() },
      });
    if (tanggal < today) {
      const old = new Map(before.map((b) => [b.pendaftaranId, b]));
      const diff = values.filter((v) => {
        const o = old.get(v.pendaftaranId);
        return !o || o.status !== v.status || (o.keterangan ?? null) !== v.keterangan;
      });
      await audit(tx, {
        userId: user.id,
        aksi: "presensi.koreksi",
        entitas: "presensi_sesi",
        entitasId: `${kelasId}:${tanggal}`,
        sebelum: diff.map((d) => ({ pendaftaranId: d.pendaftaranId, ...old.get(d.pendaftaranId) })),
        sesudah: diff,
        ip,
      });
    }
  });
}

/** Rekap kelas atau satu santri pada rentang tanggal: santri × tanggal + total H/S/I/A + persen. */
export async function laporan(
  db: Db,
  q: { kelasId?: string; santriId?: string; dari: string; sampai: string },
) {
  const filter = q.kelasId
    ? eq(pendaftaran.kelasId, q.kelasId)
    : eq(pendaftaran.santriId, q.santriId as string);
  const rows = await db
    .select({
      pendaftaranId: pendaftaran.id,
      santriId: santri.id,
      nama: santri.nama,
      namaPanggilan: santri.namaPanggilan,
      noAbsen: pendaftaran.noAbsen,
      kelasId: pendaftaran.kelasId,
      kelasNama: kelas.nama,
    })
    .from(pendaftaran)
    .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
    .innerJoin(kelas, eq(kelas.id, pendaftaran.kelasId))
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, pendaftaran.tahunAjaranId))
    // Pendaftaran yang tahun ajarannya beririsan dengan rentang laporan.
    .where(and(filter, lte(tahunAjaran.mulai, q.sampai), gte(tahunAjaran.selesai, q.dari)))
    .orderBy(sql`${pendaftaran.noAbsen} nulls last`, asc(santri.nama));
  const ids = rows.map((r) => r.pendaftaranId);
  const data = ids.length
    ? await db
        .select({
          pendaftaranId: presensi.pendaftaranId,
          tanggal: presensi.tanggal,
          status: presensi.status,
        })
        .from(presensi)
        .where(
          and(
            inArray(presensi.pendaftaranId, ids),
            gte(presensi.tanggal, q.dari),
            lte(presensi.tanggal, q.sampai),
          ),
        )
    : [];
  const kelasIds = [...new Set(rows.map((r) => r.kelasId))];
  const sesi = kelasIds.length
    ? await db
        .select({ tanggal: presensiSesi.tanggal })
        .from(presensiSesi)
        .where(
          and(
            inArray(presensiSesi.kelasId, kelasIds),
            gte(presensiSesi.tanggal, q.dari),
            lte(presensiSesi.tanggal, q.sampai),
          ),
        )
    : [];
  const tanggal = [...new Set(sesi.map((s) => s.tanggal))].sort();
  return {
    dari: q.dari,
    sampai: q.sampai,
    tanggal,
    rows: rows.map((r) => {
      const harian: Record<string, StatusPresensi> = {};
      const total = { H: 0, S: 0, I: 0, A: 0 };
      for (const d of data) {
        if (d.pendaftaranId !== r.pendaftaranId) continue;
        harian[d.tanggal] = d.status;
        total[d.status]++;
      }
      const n = total.H + total.S + total.I + total.A;
      return { ...r, harian, total, persen: n ? Math.round((total.H / n) * 1000) / 10 : null };
    }),
  };
}
