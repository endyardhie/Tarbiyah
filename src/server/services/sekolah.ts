import { and, eq } from "drizzle-orm";
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
