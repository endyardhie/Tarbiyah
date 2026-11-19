/**
 * Ringkasan error yang aman untuk log. Pesan error Drizzle memuat nilai query ("params: …")
 * yang bisa berisi nomor HP, alamat, atau hash password, jadi untuk error database hanya
 * kode, tabel, dan constraint yang dicatat.
 */
export function safeError(err: unknown): string {
  const e = err as {
    name?: string;
    stack?: string;
    cause?: { code?: string; table?: string; constraint?: string; routine?: string };
  };
  const db = e.cause?.code ? e.cause : (err as typeof e.cause);
  if (db?.code && /^[0-9A-Z]{5}$/.test(db.code)) {
    const parts = [
      `kode=${db.code}`,
      db.table && `tabel=${db.table}`,
      db.constraint && `constraint=${db.constraint}`,
    ];
    return `Error database ${parts.filter(Boolean).join(" ")}`;
  }
  return e.stack ?? String(err);
}
