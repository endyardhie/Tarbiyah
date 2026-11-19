import { eq } from "drizzle-orm";
import type { Identitas } from "../../shared/sekolah";
import type { Db, Tx } from "../db/client";
import { settings } from "../db/schema";

export const DEFAULT_IDENTITAS: Identitas = {
  nama: "TARBIYAH",
  namaSingkat: "TARBIYAH",
  alamat: null,
  zonaWaktu: "Asia/Jayapura",
  logoId: null,
  ikon192Id: null,
  ikon512Id: null,
  ikonMaskableId: null,
};

// Dibaca di banyak request (manifest, zona waktu); proses tunggal → cache di memori per koneksi DB.
const cache = new WeakMap<object, Identitas>();

export async function getIdentitas(db: Db): Promise<Identitas> {
  const hit = cache.get(db);
  if (hit) return hit;
  const [row] = await db.select().from(settings).where(eq(settings.key, "identitas"));
  const value = { ...DEFAULT_IDENTITAS, ...((row?.value as Partial<Identitas>) ?? {}) };
  cache.set(db, value);
  return value;
}

export async function saveIdentitas(db: Db, tx: Tx, value: Identitas) {
  await tx
    .insert(settings)
    .values({ key: "identitas", value })
    .onConflictDoUpdate({ target: settings.key, set: { value, diubahAt: new Date() } });
  cache.delete(db);
}

/** Zona waktu sekolah dari pengaturan (aturan: "hari ini" dihitung di server). */
export async function schoolTimeZone(db: Db) {
  return (await getIdentitas(db)).zonaWaktu;
}

/** True bila database berisi data contoh (seed --contoh). */
export async function isSampleData(db: Db) {
  const [row] = await db
    .select({ key: settings.key })
    .from(settings)
    .where(eq(settings.key, "data_contoh"));
  return !!row;
}
