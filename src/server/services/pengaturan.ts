import { eq } from "drizzle-orm";
import type { Identitas } from "../../shared/sekolah";
import type { Db, Tx } from "../db/client";
import { settings } from "../db/schema";
import { KEY_VERSION } from "../lib/crypto";

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

/** Baca pengaturan berbentuk objek, dilengkapi nilai bawaan. */
export async function readSetting<T extends object>(
  db: Db | Tx,
  key: string,
  defaults: T,
): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return { ...defaults, ...((row?.value as Partial<T>) ?? {}) };
}

/** Simpan pengaturan; `terenkripsi` menandai value berisi secret AES-GCM (lihat lib/crypto). */
export async function writeSetting(tx: Db | Tx, key: string, value: object, terenkripsi = false) {
  const set = {
    value,
    terenkripsi,
    versiKunci: terenkripsi ? KEY_VERSION : null,
    diubahAt: new Date(),
  };
  await tx
    .insert(settings)
    .values({ key, ...set })
    .onConflictDoUpdate({ target: settings.key, set });
}

/** Dipanggil setelah restore: isi tabel settings berganti seluruhnya. */
export function lupakanCacheIdentitas(db: Db) {
  cache.delete(db);
}

export const DEFAULT_PERSETUJUAN = `Dengan memakai aplikasi ini, Anda menyetujui lembaga mengolah data pribadi Anda dan anak Anda (nama, nomor HP, kehadiran, nilai, rapor, dan pembayaran) hanya untuk keperluan pendidikan, komunikasi sekolah, dan administrasi keuangan.

Data hanya dapat dilihat oleh guru, wali kelas, dan petugas yang berwenang, tidak dijual atau dibagikan kepada pihak lain, dan disimpan selama anak Anda terdaftar serta masa arsip yang diwajibkan.

Anda dapat meminta perbaikan data atau penghapusan akun melalui admin sekolah.`;

export const getPersetujuan = (db: Db | Tx) =>
  readSetting(db, "persetujuan", { teks: DEFAULT_PERSETUJUAN });
