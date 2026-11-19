import { useQuery } from "@tanstack/react-query";
import type { Jenis } from "../../shared/akademik";
import { api } from "./api";

export type Ajar = {
  id: string;
  kelasId: string;
  kelasNama: string;
  unitId: string;
  unitKode: string;
  mapelNama: string;
  guruId: string;
  bisaIsi: boolean;
};
export type Lampiran = { id: string; namaAsli: string; tipe: string; ukuran?: number };
export type Tugas = {
  id: string;
  pengajaranId: string;
  judul: string;
  deskripsi: string | null;
  tanggalDiberi: string;
  tenggat: string | null;
  dinotifikasiAt: string | null;
  lampiran: Lampiran[];
};
export type Penilaian = {
  id: string;
  jenis: Jenis;
  judul: string;
  tanggal: string;
  dinotifikasiAt: string | null;
  terisi: number;
  rataRata: number | null;
};
export type Semester = {
  id: string;
  nomor: number;
  mulai: string;
  selesai: string;
  tahunAjaranId: string;
};

export const useAjar = () =>
  useQuery({
    queryKey: ["akademik", "pengajaran"],
    queryFn: () => api<Ajar[]>("/akademik/pengajaran"),
  });

export const ajarLabel = (p: Ajar) => `${p.mapelNama} · ${p.kelasNama} ${p.unitKode}`;
