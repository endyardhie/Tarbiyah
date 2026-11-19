/** Waktu sekarang di zona waktu sekolah, format "YYYY-MM-DD HH:mm:ss". */
export function schoolNow(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(now);
}
