import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import {
  DEFAULT_BOBOT,
  DEFAULT_SKALA,
  JENIS,
  type Jenis,
  nilaiBerbobot,
  predikatDari,
  type Skala,
} from "../../shared/akademik";
import type { RaporContext } from "../../shared/rapor-template";
import type { Db, Tx } from "../db/client";
import {
  bobotNilai,
  kelas,
  lokasi,
  mapel,
  nilai,
  pendaftaran,
  pengajaran,
  penilaian,
  presensi,
  rapor,
  raporAspek,
  raporAspekNilai,
  raporNilai,
  santri,
  semester,
  skalaPredikat,
  tahunAjaran,
  units,
  users,
} from "../db/schema";
import { fail } from "../lib/context";
import { getIdentitas } from "./pengaturan";

type DbLike = Db | Tx;

export async function getPengajaran(db: DbLike, id: string) {
  const [p] = await db
    .select({
      id: pengajaran.id,
      kelasId: pengajaran.kelasId,
      guruId: pengajaran.guruId,
      kkm: pengajaran.kkm,
      mapelNama: mapel.nama,
      mapelNamaArab: mapel.namaArab,
      kelasNama: kelas.nama,
      unitId: kelas.unitId,
      tahunAjaranId: kelas.tahunAjaranId,
    })
    .from(pengajaran)
    .innerJoin(mapel, eq(mapel.id, pengajaran.mapelId))
    .innerJoin(kelas, eq(kelas.id, pengajaran.kelasId))
    .where(eq(pengajaran.id, id));
  if (!p) throw fail(404, "Pengajaran tidak ditemukan");
  return p;
}

export async function getSemester(db: DbLike, id: string | undefined, tahunAjaranId: string) {
  const [s] = await db
    .select()
    .from(semester)
    .where(
      id
        ? eq(semester.id, id)
        : and(eq(semester.aktif, true), eq(semester.tahunAjaranId, tahunAjaranId)),
    );
  if (!s)
    throw fail(
      400,
      id ? "Semester tidak ditemukan" : "Belum ada semester aktif untuk tahun ajaran ini",
    );
  if (s.tahunAjaranId !== tahunAjaranId)
    throw fail(400, "Semester bukan dari tahun ajaran kelas ini");
  return s;
}

/** Bobot, skala predikat, dan aspek rapor untuk satu unit (bawaan bila belum diatur). */
export async function pengaturanUnit(db: DbLike, unitId: string) {
  const [b, s, a] = await Promise.all([
    db.select().from(bobotNilai).where(eq(bobotNilai.unitId, unitId)),
    db.select().from(skalaPredikat).where(eq(skalaPredikat.unitId, unitId)),
    db
      .select()
      .from(raporAspek)
      .where(eq(raporAspek.unitId, unitId))
      .orderBy(asc(raporAspek.urutan)),
  ]);
  const bobot = b.length
    ? (Object.fromEntries(
        JENIS.map((j) => [j, b.find((x) => x.jenis === j)?.bobot ?? 0]),
      ) as Record<Jenis, number>)
    : { ...DEFAULT_BOBOT };
  const skala: Skala[] = s.length
    ? s
        .map((x) => ({ predikat: x.predikat, min: x.min, deskripsi: x.deskripsi }))
        .sort((x, y) => y.min - x.min)
    : DEFAULT_SKALA;
  return { bobot, skala, aspek: a };
}

/** Santri aktif di kelas (urut no absen, nama). */
export async function santriKelas(db: DbLike, kelasId: string) {
  return db
    .select({
      pendaftaranId: pendaftaran.id,
      santriId: santri.id,
      nama: santri.nama,
      namaPanggilan: santri.namaPanggilan,
      noAbsen: pendaftaran.noAbsen,
    })
    .from(pendaftaran)
    .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
    .where(
      and(
        eq(pendaftaran.kelasId, kelasId),
        eq(pendaftaran.status, "aktif"),
        eq(santri.status, "aktif"),
      ),
    )
    .orderBy(sql`${pendaftaran.noAbsen} nulls last`, asc(santri.nama));
}

/** Rapor yang sudah final (terkunci) di antara pendaftaran ini pada semester itu. */
export async function finalSet(db: DbLike, pendaftaranIds: string[], semesterId: string) {
  if (!pendaftaranIds.length) return new Set<string>();
  const rows = await db
    .select({ id: rapor.pendaftaranId })
    .from(rapor)
    .where(
      and(
        inArray(rapor.pendaftaranId, pendaftaranIds),
        eq(rapor.semesterId, semesterId),
        eq(rapor.status, "final"),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

export async function ensureRapor(tx: DbLike, pendaftaranId: string, semesterId: string) {
  await tx.insert(rapor).values({ pendaftaranId, semesterId }).onConflictDoNothing();
  const [r] = await tx
    .select()
    .from(rapor)
    .where(and(eq(rapor.pendaftaranId, pendaftaranId), eq(rapor.semesterId, semesterId)));
  return r as typeof rapor.$inferSelect;
}

/** Nilai rapor otomatis per pendaftaran untuk satu pengajaran & semester. */
export async function nilaiOtomatis(
  db: DbLike,
  pengajaranId: string,
  semesterId: string,
  bobot: Record<Jenis, number>,
) {
  const rows = await db
    .select({ pendaftaranId: nilai.pendaftaranId, jenis: penilaian.jenis, nilai: nilai.nilai })
    .from(nilai)
    .innerJoin(penilaian, eq(penilaian.id, nilai.penilaianId))
    .where(and(eq(penilaian.pengajaranId, pengajaranId), eq(penilaian.semesterId, semesterId)));
  const per = new Map<string, Partial<Record<Jenis, number[]>>>();
  for (const r of rows) {
    const m = per.get(r.pendaftaranId) ?? {};
    (m[r.jenis] ??= []).push(r.nilai);
    per.set(r.pendaftaranId, m);
  }
  return new Map([...per].map(([id, m]) => [id, nilaiBerbobot(m, bobot)]));
}

/**
 * Nilai rapor satu mapel untuk satu santri. Rapor final → nilai yang dibekukan saat dikunci.
 * Draft → nilai akhir guru bila diubah manual, selain itu dihitung ulang dari nilai terkini
 * (agar nilai yang masuk belakangan selalu ikut); deskripsi otomatis kecuali ditulis guru.
 */
export function nilaiRaporEfektif(
  row: typeof raporNilai.$inferSelect | undefined,
  final: boolean,
  otomatis: number | null,
  skala: Skala[],
  mapelNama: string,
) {
  if (final && row) {
    return {
      otomatis: row.nilaiOtomatis,
      nilai: row.nilaiAkhir,
      predikat: row.predikat,
      deskripsi: row.deskripsi ?? "",
      manual: row.manual,
      deskripsiManual: row.deskripsiManual,
    };
  }
  const nilaiAkhir = row?.manual ? row.nilaiAkhir : otomatis;
  const pred = predikatDari(nilaiAkhir, skala, mapelNama);
  return {
    otomatis,
    nilai: nilaiAkhir,
    predikat: pred?.predikat ?? null,
    deskripsi: row?.deskripsiManual ? (row.deskripsi ?? "") : (pred?.deskripsi ?? ""),
    manual: !!row?.manual,
    deskripsiManual: !!row?.deskripsiManual,
  };
}

/** Rekap S/I/A dari presensi dalam rentang semester. */
export async function rekapAbsen(
  db: DbLike,
  pendaftaranIds: string[],
  s: { mulai: string; selesai: string },
) {
  const out = new Map<string, { sakit: number; izin: number; alpa: number }>();
  if (!pendaftaranIds.length) return out;
  const rows = await db
    .select({ id: presensi.pendaftaranId, status: presensi.status, n: sql<number>`count(*)::int` })
    .from(presensi)
    .where(
      and(
        inArray(presensi.pendaftaranId, pendaftaranIds),
        gte(presensi.tanggal, s.mulai),
        lte(presensi.tanggal, s.selesai),
      ),
    )
    .groupBy(presensi.pendaftaranId, presensi.status);
  for (const id of pendaftaranIds) out.set(id, { sakit: 0, izin: 0, alpa: 0 });
  for (const r of rows) {
    const x = out.get(r.id);
    if (!x) continue;
    if (r.status === "S") x.sakit = r.n;
    if (r.status === "I") x.izin = r.n;
    if (r.status === "A") x.alpa = r.n;
  }
  return out;
}

/**
 * Bekukan rapor menjadi final: nilai mapel yang belum disimpan guru diisi dari nilai otomatis,
 * rekap absen disalin, status final + siapa & kapan.
 */
export async function kunciRapor(
  tx: Tx,
  kelasId: string,
  semesterId: string,
  pendaftaranIds: string[],
  userId: string,
) {
  const [k] = await tx.select().from(kelas).where(eq(kelas.id, kelasId));
  if (!k) throw fail(404, "Kelas tidak ditemukan");
  const sem = await getSemester(tx, semesterId, k.tahunAjaranId);
  const set = await pengaturanUnit(tx, k.unitId);
  const ajar = await tx
    .select({ id: pengajaran.id, mapelNama: mapel.nama })
    .from(pengajaran)
    .innerJoin(mapel, eq(mapel.id, pengajaran.mapelId))
    .where(eq(pengajaran.kelasId, kelasId));
  const absen = await rekapAbsen(tx, pendaftaranIds, sem);
  const otomatis = new Map(
    await Promise.all(
      ajar.map(async (p) => [p.id, await nilaiOtomatis(tx, p.id, sem.id, set.bobot)] as const),
    ),
  );
  for (const pid of pendaftaranIds) {
    const r = await ensureRapor(tx, pid, sem.id);
    const saved = await tx.select().from(raporNilai).where(eq(raporNilai.raporId, r.id));
    for (const p of ajar) {
      // Bekukan dengan nilai terkini (bukan nilai saat guru terakhir menyimpan).
      const e = nilaiRaporEfektif(
        saved.find((x) => x.pengajaranId === p.id),
        false,
        otomatis.get(p.id)?.get(pid) ?? null,
        set.skala,
        p.mapelNama,
      );
      const values = {
        nilaiOtomatis: e.otomatis,
        nilaiAkhir: e.nilai,
        predikat: e.predikat,
        deskripsi: e.deskripsi || null,
        manual: e.manual,
        deskripsiManual: e.deskripsiManual,
      };
      await tx
        .insert(raporNilai)
        .values({ raporId: r.id, pengajaranId: p.id, ...values })
        .onConflictDoUpdate({ target: [raporNilai.raporId, raporNilai.pengajaranId], set: values });
    }
    const a = absen.get(pid) ?? { sakit: 0, izin: 0, alpa: 0 };
    await tx
      .update(rapor)
      .set({ ...a, status: "final", dikunciOleh: userId, dikunciAt: new Date() })
      .where(eq(rapor.id, r.id));
  }
}

const tglIndo = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${iso}T00:00:00Z`))
    : "";

/** Data template untuk satu kelas (atau sebagian santrinya) pada satu semester. */
export async function raporContexts(
  db: Db,
  kelasId: string,
  semesterId: string,
  pendaftaranIds?: string[],
) {
  const [k] = await db
    .select({
      id: kelas.id,
      nama: kelas.nama,
      unitId: kelas.unitId,
      tahunAjaranId: kelas.tahunAjaranId,
      unitKode: units.kode,
      lokasiNama: lokasi.nama,
      waliKelas: users.nama,
      tahunAjaran: tahunAjaran.nama,
    })
    .from(kelas)
    .innerJoin(units, eq(units.id, kelas.unitId))
    .innerJoin(lokasi, eq(lokasi.id, kelas.lokasiId))
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, kelas.tahunAjaranId))
    .leftJoin(users, eq(users.id, kelas.waliKelasId))
    .where(eq(kelas.id, kelasId));
  if (!k) throw fail(404, "Kelas tidak ditemukan");
  const sem = await getSemester(db, semesterId, k.tahunAjaranId);
  const ident = await getIdentitas(db);
  const set = await pengaturanUnit(db, k.unitId);
  const siswa = (
    await db
      .select({
        pendaftaranId: pendaftaran.id,
        nama: santri.nama,
        nis: santri.nis,
        namaPanggilan: santri.namaPanggilan,
        jenisKelamin: santri.jenisKelamin,
        tempatLahir: santri.tempatLahir,
        tanggalLahir: santri.tanggalLahir,
        noAbsen: pendaftaran.noAbsen,
        aktif: sql<boolean>`${pendaftaran.status} = 'aktif' and ${santri.status} = 'aktif'`,
        final: sql<boolean>`exists (select 1 from rapor r where r.pendaftaran_id = ${pendaftaran.id}
          and r.semester_id = ${sem.id} and r.status = 'final')`,
      })
      .from(pendaftaran)
      .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
      .where(eq(pendaftaran.kelasId, kelasId))
      .orderBy(sql`${pendaftaran.noAbsen} nulls last`, asc(santri.nama))
  ).filter((s) =>
    // Cetak satu kelas: santri aktif + yang rapornya sudah final (bukan yang sudah pindah/keluar).
    pendaftaranIds ? pendaftaranIds.includes(s.pendaftaranId) : s.aktif || s.final,
  );
  const ids = siswa.map((s) => s.pendaftaranId);
  const ajar = await db
    .select({ id: pengajaran.id, kkm: pengajaran.kkm, nama: mapel.nama, namaArab: mapel.namaArab })
    .from(pengajaran)
    .innerJoin(mapel, eq(mapel.id, pengajaran.mapelId))
    .where(eq(pengajaran.kelasId, kelasId))
    .orderBy(asc(mapel.nama));
  const raporRows = ids.length
    ? await db
        .select()
        .from(rapor)
        .where(and(inArray(rapor.pendaftaranId, ids), eq(rapor.semesterId, sem.id)))
    : [];
  const raporIds = raporRows.map((r) => r.id);
  const [rn, ran] = raporIds.length
    ? await Promise.all([
        db.select().from(raporNilai).where(inArray(raporNilai.raporId, raporIds)),
        db.select().from(raporAspekNilai).where(inArray(raporAspekNilai.raporId, raporIds)),
      ])
    : [[], []];
  const otomatis = new Map(
    await Promise.all(
      ajar.map(async (p) => [p.id, await nilaiOtomatis(db, p.id, sem.id, set.bobot)] as const),
    ),
  );
  const absenLive = await rekapAbsen(db, ids, sem);
  const aspekAktif = set.aspek.filter((a) => a.aktif);
  const tz = ident.zonaWaktu;
  const today = new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(new Date());

  return {
    unitId: k.unitId,
    data: siswa.map((s): RaporContext & { pendaftaranId: string; status: "draft" | "final" } => {
      const r = raporRows.find((x) => x.pendaftaranId === s.pendaftaranId);
      const final = r?.status === "final";
      const mapelList = ajar.map((p, i) => {
        const e = nilaiRaporEfektif(
          r ? rn.find((x) => x.raporId === r.id && x.pengajaranId === p.id) : undefined,
          final,
          otomatis.get(p.id)?.get(s.pendaftaranId) ?? null,
          set.skala,
          p.nama,
        );
        return {
          no: i + 1,
          nama: p.nama,
          namaArab: p.namaArab ?? "",
          kkm: p.kkm == null ? "" : String(p.kkm),
          nilai: e.nilai == null ? "" : String(Math.round(e.nilai)),
          predikat: e.predikat ?? "",
          deskripsi: e.deskripsi,
        };
      });
      const absen =
        final && r
          ? { sakit: r.sakit ?? 0, izin: r.izin ?? 0, alpa: r.alpa ?? 0 }
          : (absenLive.get(s.pendaftaranId) ?? { sakit: 0, izin: 0, alpa: 0 });
      return {
        pendaftaranId: s.pendaftaranId,
        status: final ? "final" : "draft",
        lembaga: {
          nama: ident.nama,
          alamat: ident.alamat ?? "",
          logo: ident.logoId ? `/api/files/${ident.logoId}` : "",
        },
        tahunAjaran: k.tahunAjaran,
        semester: sem.nomor,
        semesterLabel: sem.nomor === 1 ? "Ganjil" : "Genap",
        draft: !final,
        santri: {
          nama: s.nama,
          nis: s.nis,
          namaPanggilan: s.namaPanggilan ?? "",
          jenisKelamin:
            s.jenisKelamin === "L" ? "Laki-laki" : s.jenisKelamin === "P" ? "Perempuan" : "",
          ttl: [s.tempatLahir, tglIndo(s.tanggalLahir)].filter(Boolean).join(", "),
        },
        kelas: {
          nama: k.nama,
          unit: k.unitKode,
          lokasi: k.lokasiNama,
          waliKelas: k.waliKelas ?? "",
        },
        mapel: mapelList,
        aspek: aspekAktif.map((a) => ({
          kelompok: a.kelompok,
          nama: a.nama,
          nilai: (r && ran.find((x) => x.raporId === r.id && x.aspekId === a.id)?.nilai) || "",
        })),
        absensi: absen,
        catatan: r?.catatanWali ?? "",
        keputusan:
          r?.keputusan === "naik"
            ? "Naik ke kelas berikutnya"
            : r?.keputusan === "tinggal"
              ? "Tinggal di kelas yang sama"
              : "",
        tanggalCetak: today,
      };
    }),
  };
}
