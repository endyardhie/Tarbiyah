/** Waktu sekarang di zona waktu sekolah, format "YYYY-MM-DD HH:mm:ss". */
export function schoolNow(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(now);
}

/** Tanggal "hari ini" (YYYY-MM-DD) menurut zona waktu sekolah, bukan jam HP/server. */
export function schoolToday(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Hari ISO untuk tanggal sekolah: 1 = Senin … 7 = Ahad. */
export function isoWeekday(tanggal: string): number {
  const d = new Date(`${tanggal}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Awal & akhir bulan dari "YYYY-MM-DD" atau "YYYY-MM". */
export function monthBounds(tanggal: string): { dari: string; sampai: string } {
  const [y, m] = tanggal.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { dari: `${y}-${mm}-01`, sampai: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}
