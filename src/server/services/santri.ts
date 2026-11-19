import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";
import type { santriSchema } from "../../shared/sekolah";
import type { Db, Tx } from "../db/client";
import {
  kelas,
  lokasi,
  pendaftaran,
  santri,
  santriWali,
  tahunAjaran,
  units,
  userPhones,
  users,
} from "../db/schema";
import { type AuthUser, can } from "../lib/can";
import { fail } from "../lib/context";

type SantriInput = z.output<typeof santriSchema>;

/**
 * Daftar santri pada satu tahun ajaran (dengan kelasnya), difilter sesuai hak:
 * izin "lihat semua" → semua; wali kelas/pengajar → kelasnya; wali santri → anaknya.
 */
export async function listSantri(
  db: Db,
  user: AuthUser,
  opts: { tahunAjaranId: string | null; kelasId?: string },
) {
  const all = await can(user, "santri.lihat");
  if (opts.kelasId && !all && !(await can(user, "santri.lihat", { kelasId: opts.kelasId }))) {
    throw fail(403, "Anda tidak punya akses ke kelas ini");
  }
  const kelasIds = [...user.relasi.kelasWali, ...user.relasi.kelasAjar];
  const visible = all
    ? undefined
    : or(
        kelasIds.length ? inArray(pendaftaran.kelasId, kelasIds) : sql`false`,
        user.relasi.anak.length ? inArray(santri.id, user.relasi.anak) : sql`false`,
      );
  const rows = await db
    .select({
      id: santri.id,
      nis: santri.nis,
      nama: santri.nama,
      namaPanggilan: santri.namaPanggilan,
      jenisKelamin: santri.jenisKelamin,
      status: santri.status,
      kelasId: pendaftaran.kelasId,
      kelasNama: kelas.nama,
      unitKode: units.kode,
      lokasiNama: lokasi.nama,
      statusPendaftaran: pendaftaran.status,
      noAbsen: pendaftaran.noAbsen,
    })
    .from(santri)
    .leftJoin(
      pendaftaran,
      and(
        eq(pendaftaran.santriId, santri.id),
        opts.tahunAjaranId ? eq(pendaftaran.tahunAjaranId, opts.tahunAjaranId) : sql`false`,
      ),
    )
    .leftJoin(kelas, eq(kelas.id, pendaftaran.kelasId))
    .leftJoin(units, eq(units.id, kelas.unitId))
    .leftJoin(lokasi, eq(lokasi.id, kelas.lokasiId))
    .where(and(visible, opts.kelasId ? eq(pendaftaran.kelasId, opts.kelasId) : undefined))
    .orderBy(asc(kelas.nama), asc(santri.nama));

  // Peringatan nama panggilan kembar dalam satu kelas (presensi memakai nama panggilan).
  const seen = new Map<string, number>();
  const key = (r: (typeof rows)[number]) =>
    r.kelasId && r.namaPanggilan ? `${r.kelasId}|${r.namaPanggilan.toLowerCase()}` : null;
  for (const r of rows) {
    const k = key(r);
    if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return rows.map((r) => ({ ...r, panggilanKembar: (seen.get(key(r) ?? "") ?? 0) > 1 }));
}

/** Detail santri + riwayat pendaftaran + wali; ditolak bila tidak berhak. */
export async function getSantri(db: Db, user: AuthUser, id: string) {
  const [s] = await db.select().from(santri).where(eq(santri.id, id));
  if (!s) throw fail(404, "Santri tidak ditemukan");
  const riwayat = await db
    .select({
      id: pendaftaran.id,
      tahunAjaranId: pendaftaran.tahunAjaranId,
      tahunAjaran: tahunAjaran.nama,
      kelasId: pendaftaran.kelasId,
      kelasNama: kelas.nama,
      status: pendaftaran.status,
      noAbsen: pendaftaran.noAbsen,
    })
    .from(pendaftaran)
    .innerJoin(tahunAjaran, eq(tahunAjaran.id, pendaftaran.tahunAjaranId))
    .innerJoin(kelas, eq(kelas.id, pendaftaran.kelasId))
    .where(eq(pendaftaran.santriId, id))
    .orderBy(sql`${tahunAjaran.mulai} desc`);

  let allowed = await can(user, "santri.lihat", { santriId: id });
  for (const r of riwayat) allowed ||= await can(user, "santri.lihat", { kelasId: r.kelasId });
  if (!allowed) throw fail(403, "Anda tidak punya akses ke santri ini");

  const wali = await db
    .select({
      userId: users.id,
      nama: users.nama,
      hubungan: santriWali.hubungan,
      penerimaTagihan: santriWali.penerimaTagihan,
      nomor: sql<
        string[]
      >`coalesce((select array_agg(up.nomor order by up.nomor) from user_phones up where up.user_id = "users"."id"), '{}')`,
    })
    .from(santriWali)
    .innerJoin(users, eq(users.id, santriWali.userId))
    .where(eq(santriWali.santriId, id))
    .orderBy(asc(santriWali.hubungan));
  return { ...s, riwayat, wali };
}

/** Nama panggilan yang sama di kelas yang sama → teks peringatan (bukan penolakan). */
async function panggilanWarning(
  tx: Tx,
  santriId: string,
  kelasId: string | null,
  panggilan: string | null,
) {
  if (!kelasId || !panggilan) return null;
  const twins = await tx
    .select({ nama: santri.nama })
    .from(pendaftaran)
    .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
    .where(
      and(
        eq(pendaftaran.kelasId, kelasId),
        ne(santri.id, santriId),
        sql`lower(${santri.namaPanggilan}) = lower(${panggilan})`,
      ),
    );
  return twins.length
    ? `Nama panggilan "${panggilan}" juga dipakai ${twins.map((t) => t.nama).join(", ")} di kelas ini.`
    : null;
}

/** Simpan pendaftaran santri ke kelas (tahun ajaran = tahun ajaran kelas). */
export async function enroll(tx: Tx, santriId: string, kelasId: string) {
  const [k] = await tx.select({ ta: kelas.tahunAjaranId }).from(kelas).where(eq(kelas.id, kelasId));
  if (!k) throw fail(400, "Kelas tidak ditemukan");
  await tx
    .insert(pendaftaran)
    .values({ santriId, tahunAjaranId: k.ta, kelasId })
    .onConflictDoUpdate({
      target: [pendaftaran.santriId, pendaftaran.tahunAjaranId],
      set: { kelasId },
    });
}

export async function saveSantri(tx: Tx, input: SantriInput, id: string | null) {
  const { kelasId, ...data } = input;
  let santriId = id;
  if (id) {
    const [row] = await tx
      .update(santri)
      .set({ ...data, diubahAt: new Date() })
      .where(eq(santri.id, id))
      .returning({ id: santri.id });
    if (!row) throw fail(404, "Santri tidak ditemukan");
  } else {
    const [row] = await tx.insert(santri).values(data).returning({ id: santri.id });
    santriId = row?.id as string;
  }
  if (kelasId) await enroll(tx, santriId as string, kelasId);
  return {
    id: santriId as string,
    peringatan: await panggilanWarning(tx, santriId as string, kelasId, data.namaPanggilan),
  };
}

/** Wali santri "murni": tanpa jabatan dan tidak memegang kelas/pengajaran. */
export async function assertPureWali(db: Db | Tx, userId: string) {
  const [row] = await db
    .select({
      staf: sql<boolean>`exists (select 1 from user_roles ur where ur.user_id = "users"."id")
        or exists (select 1 from kelas k where k.wali_kelas_id = "users"."id")
        or exists (select 1 from pengajaran p where p.guru_id = "users"."id")`,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!row) throw fail(404, "Wali tidak ditemukan");
  if (row.staf) throw fail(403, "Akun ini milik staf; ubah lewat halaman Pengguna");
}

/** Semua wali (terhubung ke santri, atau akun tanpa jabatan) beserta anaknya. */
export async function listWali(db: Db) {
  const list = await db
    .select({ id: users.id, nama: users.nama, status: users.status })
    .from(users)
    .where(
      sql`exists (select 1 from santri_wali sw where sw.user_id = "users"."id")
        or not (exists (select 1 from user_roles ur where ur.user_id = "users"."id")
          or exists (select 1 from kelas k where k.wali_kelas_id = "users"."id")
          or exists (select 1 from pengajaran p where p.guru_id = "users"."id"))`,
    )
    .orderBy(asc(users.nama));
  const ids = list.map((u) => u.id);
  if (!ids.length) return [];
  const [phones, anak] = await Promise.all([
    db
      .select({
        userId: userPhones.userId,
        nomor: userPhones.nomor,
        label: userPhones.label,
        punyaWa: userPhones.punyaWa,
        untukLogin: userPhones.untukLogin,
      })
      .from(userPhones)
      .where(inArray(userPhones.userId, ids)),
    db
      .select({
        userId: santriWali.userId,
        santriId: santri.id,
        nama: santri.nama,
        nis: santri.nis,
        hubungan: santriWali.hubungan,
        penerimaTagihan: santriWali.penerimaTagihan,
      })
      .from(santriWali)
      .innerJoin(santri, eq(santri.id, santriWali.santriId))
      .where(inArray(santriWali.userId, ids))
      .orderBy(asc(santri.nama)),
  ]);
  return list.map((u) => ({
    ...u,
    phones: phones.filter((p) => p.userId === u.id).map(({ userId: _, ...p }) => p),
    anak: anak.filter((a) => a.userId === u.id).map(({ userId: _, ...a }) => a),
  }));
}
