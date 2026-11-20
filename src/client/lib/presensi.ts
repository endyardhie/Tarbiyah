import { useQuery } from "@tanstack/react-query";
import type { KelasHariIni, Status } from "../../shared/types";
import { api } from "./api";

export const STATUS: { value: Status; label: string; className: string }[] = [
  { value: "H", label: "Hadir", className: "bg-hadir" },
  { value: "S", label: "Sakit", className: "bg-sakit" },
  { value: "I", label: "Izin", className: "bg-izin" },
  { value: "A", label: "Alpa", className: "bg-alpa" },
];

export const useHariIni = (enabled = true) =>
  useQuery({
    queryKey: ["presensi", "hari-ini"],
    queryFn: () => api<{ tanggal: string; kelas: KelasHariIni[] }>("/presensi/hari-ini"),
    enabled,
  });

/** "2026-11-18" → Date di tengah hari UTC (aman untuk format tanggal sekolah). */
export const tglDate = (t: string) => new Date(`${t}T12:00:00Z`);

export function monthOf(t: string) {
  const [y, m] = t.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, "0");
  return { dari: `${y}-${mm}-01`, sampai: `${y}-${mm}-${String(last).padStart(2, "0")}` };
}

/**
 * Nama di daftar presensi: nama panggilan (nama lengkap bisa sama antar-santri). Bila panggilan
 * kembar di kelas yang sama, ditambah huruf awal kata kedua nama lengkap, mis. "Aisyah H.".
 */
export function namaPresensi(
  rows: { pendaftaranId: string; nama: string; namaPanggilan: string | null }[],
) {
  const dasar = (r: (typeof rows)[number]) => r.namaPanggilan?.trim() || r.nama;
  const jumlah = new Map<string, number>();
  for (const r of rows) jumlah.set(dasar(r), (jumlah.get(dasar(r)) ?? 0) + 1);
  return new Map(
    rows.map((r) => {
      const n = dasar(r);
      const kedua = r.nama.trim().split(/\s+/)[1];
      return [r.pendaftaranId, (jumlah.get(n) ?? 0) > 1 && kedua ? `${n} ${kedua[0]}.` : n];
    }),
  );
}
