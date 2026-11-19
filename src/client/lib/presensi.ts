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
