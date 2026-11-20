// Zona waktu sekolah dari Pengaturan; diisi saat public-config dimuat (sebelum halaman aplikasi tampil).
let schoolTz = "Asia/Jayapura";
export function setSchoolTimeZone(tz: string) {
  schoolTz = tz;
}

/** "Jumat, 20 November 2026" */
export function formatTanggal(date: Date, timeZone = schoolTz) {
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}

/** "20 Nov 2026 09.15" */
export function formatWaktu(iso: string, timeZone = schoolTz) {
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

/** Bulan berjalan "YYYY-MM" & tanggal hari ini "YYYY-MM-DD" menurut zona waktu sekolah. */
export function hariIniSekolah(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: schoolTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
