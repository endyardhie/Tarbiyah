const SCHOOL_TZ = "Asia/Jayapura";

/** "Jumat, 20 November 2026" */
export function formatTanggal(date: Date, timeZone = SCHOOL_TZ) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}
