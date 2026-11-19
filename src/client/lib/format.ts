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

/** "20 Nov 2026 09.15" */
export function formatWaktu(iso: string, timeZone = SCHOOL_TZ) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}

/** 6281234567890 → "0812-3456-7890" */
export function formatPhone(nomor: string) {
  const local = nomor.startsWith("62") ? `0${nomor.slice(2)}` : nomor;
  return local.replace(/^(\d{4})(\d{4})(\d+)$/, "$1-$2-$3");
}
