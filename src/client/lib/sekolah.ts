import { useQuery } from "@tanstack/react-query";
import type { Kelas, Lokasi, Mapel, PublicConfig, TahunAjaran, Unit } from "../../shared/types";
import { api } from "./api";

export const HARI = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Ahad"];
export const hariOptions = HARI.slice(1).map((label, i) => ({ value: String(i + 1), label }));

export const useLokasi = () =>
  useQuery({ queryKey: ["lokasi"], queryFn: () => api<Lokasi[]>("/lokasi") });
export const useUnits = () =>
  useQuery({ queryKey: ["units"], queryFn: () => api<Unit[]>("/units") });
export const useMapel = () =>
  useQuery({ queryKey: ["mapel"], queryFn: () => api<Mapel[]>("/mapel") });
export const useTahunAjaran = () =>
  useQuery({ queryKey: ["tahun-ajaran"], queryFn: () => api<TahunAjaran[]>("/tahun-ajaran") });
/** Kelas pada tahun ajaran tertentu (kosong = tahun ajaran aktif). */
export const useKelas = (tahunAjaranId = "") =>
  useQuery({
    queryKey: ["kelas", tahunAjaranId ? `tahunAjaranId=${tahunAjaranId}` : ""],
    queryFn: () => api<Kelas[]>(`/kelas${tahunAjaranId ? `?tahunAjaranId=${tahunAjaranId}` : ""}`),
  });
export const useGuru = (enabled = true) =>
  useQuery({
    queryKey: ["guru-pilihan"],
    queryFn: () => api<{ id: string; nama: string }[]>("/guru-pilihan"),
    enabled,
  });
export const usePublicConfig = () =>
  useQuery({
    queryKey: ["public-config"],
    queryFn: () => api<PublicConfig>("/public-config"),
    staleTime: 5 * 60_000,
  });

export const kelasLabel = (k: Pick<Kelas, "nama" | "unitKode" | "lokasiNama">) =>
  `${k.nama} · ${k.unitKode} ${k.lokasiNama}`;
