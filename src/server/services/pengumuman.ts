import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { pendaftaran, pengumuman, sasaran, tahunAjaran, users } from "../db/schema";
import { type AuthUser, can } from "../lib/can";
import { fail } from "../lib/context";

export type Sasaran = { unitId: string | null; lokasiId: string | null; kelasId: string | null };
const isSemua = (s: Sasaran) => !s.unitId && !s.lokasiId && !s.kelasId;

/**
 * Hak mengirim: pengumuman.semua → sasaran apa pun. Selain itu: wali kelas → kelasnya sendiri;
 * guru pengajar → kelas atau unit mana pun (rancangan › Peran & hak akses).
 */
export async function assertBolehKirim(user: AuthUser, list: Sasaran[]) {
  if (await can(user, "pengumuman.semua")) return;
  const pengajar = user.relasi.pengajaran.length > 0;
  for (const s of list) {
    const hanyaKelas = !!s.kelasId && !s.unitId && !s.lokasiId;
    const hanyaUnit = !!s.unitId && !s.lokasiId && !s.kelasId;
    const ok =
      (hanyaKelas && (pengajar || user.relasi.kelasWali.includes(s.kelasId as string))) ||
      (hanyaUnit && pengajar);
    if (!ok) {
      throw fail(
        403,
        pengajar
          ? "Guru hanya bisa mengirim ke kelas atau unit"
          : user.relasi.kelasWali.length
            ? "Wali kelas hanya bisa mengirim ke kelasnya sendiri"
            : "Anda tidak punya izin mengirim pengumuman",
      );
    }
  }
}

/**
 * Penerima dari sasaran: wali santri aktif di kelas yang cocok (tahun ajaran aktif) + wali kelas &
 * guru pengajar kelas itu. Sasaran "seluruh sekolah" juga mengenai semua pemegang jabatan.
 */
export async function penerimaDariSasaran(db: Db, list: Sasaran[], pengirimId: string) {
  const json = JSON.stringify(
    list.map((s) => ({ unit_id: s.unitId, lokasi_id: s.lokasiId, kelas_id: s.kelasId })),
  );
  const semua = list.some(isSemua);
  const { rows } = await db.execute<{ id: string }>(sql`
    with s as (
      select * from jsonb_to_recordset(${json}::jsonb) as x(unit_id uuid, lokasi_id uuid, kelas_id uuid)
    ),
    k as (
      select distinct kl.id from kelas kl
      join tahun_ajaran ta on ta.id = kl.tahun_ajaran_id and ta.aktif
      join s on (s.unit_id is null or s.unit_id = kl.unit_id)
        and (s.lokasi_id is null or s.lokasi_id = kl.lokasi_id)
        and (s.kelas_id is null or s.kelas_id = kl.id)
      where kl.aktif
    ),
    calon as (
      select sw.user_id as id from santri_wali sw
        join santri sn on sn.id = sw.santri_id and sn.status = 'aktif'
        join pendaftaran p on p.santri_id = sw.santri_id and p.status = 'aktif'
        where p.kelas_id in (select id from k)
      union select wali_kelas_id from kelas where id in (select id from k) and wali_kelas_id is not null
      union select guru_id from pengajaran where kelas_id in (select id from k)
      union select ur.user_id from user_roles ur where ${semua}
    )
    select distinct u.id from users u join calon on calon.id = u.id
    where u.status = 'aktif' and u.id <> ${pengirimId}`);
  return rows.map((r) => r.id);
}

/** Kelas yang terkait dengan pengguna di tahun ajaran aktif (wali kelas, mengajar, kelas anak). */
async function kelasTerkait(db: Db, user: AuthUser) {
  const anakKelas = user.relasi.anak.length
    ? await db
        .select({ id: pendaftaran.kelasId })
        .from(pendaftaran)
        .innerJoin(
          tahunAjaran,
          and(eq(tahunAjaran.id, pendaftaran.tahunAjaranId), eq(tahunAjaran.aktif, true)),
        )
        .where(inArray(pendaftaran.santriId, user.relasi.anak))
    : [];
  return [
    ...new Set([...user.relasi.kelasWali, ...user.relasi.kelasAjar, ...anakKelas.map((a) => a.id)]),
  ];
}

/** Pengumuman yang relevan untuk pengguna (terbaru dulu). */
export async function listPengumuman(db: Db, user: AuthUser) {
  const semua = await can(user, "pengumuman.semua");
  const ids = await kelasTerkait(db, user);
  const kelasArr = ids.length
    ? sql`array[${sql.join(
        ids.map((i) => sql`${i}::uuid`),
        sql`, `,
      )}]`
    : sql`array[]::uuid[]`;
  const relevan = semua
    ? undefined
    : sql`(${pengumuman.pengirimId} = ${user.id}
        or exists (select 1 from sasaran s where s.pengumuman_id = "pengumuman"."id"
          and s.unit_id is null and s.lokasi_id is null and s.kelas_id is null)
        or exists (select 1 from sasaran s join kelas k on k.id = any(${kelasArr})
          where s.pengumuman_id = "pengumuman"."id"
            and (s.unit_id is null or s.unit_id = k.unit_id)
            and (s.lokasi_id is null or s.lokasi_id = k.lokasi_id)
            and (s.kelas_id is null or s.kelas_id = k.id)))`;
  // shortcut: 100 pengumuman terbaru tanpa paginasi; tambah paginasi bila arsip sudah panjang.
  const rows = await db
    .select({
      id: pengumuman.id,
      judul: pengumuman.judul,
      isi: pengumuman.isi,
      dikirimAt: pengumuman.dikirimAt,
      kirimNotifikasi: pengumuman.kirimNotifikasi,
      pengirimId: pengumuman.pengirimId,
      pengirimNama: users.nama,
    })
    .from(pengumuman)
    .innerJoin(users, eq(users.id, pengumuman.pengirimId))
    .where(relevan)
    .orderBy(desc(pengumuman.dikirimAt))
    .limit(100);
  const s = rows.length
    ? await db
        .select({
          pengumumanId: sasaran.pengumumanId,
          unitId: sasaran.unitId,
          lokasiId: sasaran.lokasiId,
          kelasId: sasaran.kelasId,
        })
        .from(sasaran)
        .where(
          inArray(
            sasaran.pengumumanId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((r) => ({
    ...r,
    sasaran: s.filter((x) => x.pengumumanId === r.id).map(({ pengumumanId: _, ...x }) => x),
  }));
}
