import { and, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import { tahunAjaran, users } from "../db/schema";
import { fail } from "../lib/context";

export async function activeTahunAjaran(db: Db | Tx) {
  const [row] = await db.select().from(tahunAjaran).where(eq(tahunAjaran.aktif, true));
  return row ?? null;
}

/** id tahun ajaran dari query (?tahunAjaranId=) atau tahun ajaran aktif. */
export async function resolveTahunAjaran(db: Db, fromQuery: string | undefined) {
  if (fromQuery) return fromQuery;
  return (await activeTahunAjaran(db))?.id ?? null;
}

export async function assertActiveUser(tx: Tx, id: string | null, label: string) {
  if (!id) return;
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, id), eq(users.status, "aktif")));
  if (!u) throw fail(400, `${label} harus pengguna aktif`);
}

export const PESAN_ARSIP = "Tahun ajaran ini sudah diarsipkan dan hanya bisa dibaca.";

/** Tahun ajaran arsip = lebih lama dari tahun ajaran aktif; datanya baca-saja. */
export async function assertTaBukanArsip(db: Db | Tx, tahunAjaranId: string) {
  const { rows } = await db.execute(sql`
    select 1 from tahun_ajaran lama join tahun_ajaran a on a.aktif and a.mulai > lama.mulai
    where lama.id = ${tahunAjaranId}`);
  if (rows.length) throw fail(409, PESAN_ARSIP);
}

export async function assertKelasBukanArsip(db: Db | Tx, kelasId: string) {
  const { rows } = await db.execute(sql`
    select 1 from kelas k join tahun_ajaran lama on lama.id = k.tahun_ajaran_id
    join tahun_ajaran a on a.aktif and a.mulai > lama.mulai where k.id = ${kelasId}`);
  if (rows.length) throw fail(409, PESAN_ARSIP);
}

export async function assertPengajaranBukanArsip(db: Db | Tx, pengajaranId: string) {
  const { rows } = await db.execute(sql`
    select 1 from pengajaran p join kelas k on k.id = p.kelas_id
    join tahun_ajaran lama on lama.id = k.tahun_ajaran_id
    join tahun_ajaran a on a.aktif and a.mulai > lama.mulai where p.id = ${pengajaranId}`);
  if (rows.length) throw fail(409, PESAN_ARSIP);
}
