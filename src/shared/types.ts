/** Bentuk respons API yang dipakai frontend. */
export type Phone = {
  nomor: string;
  label: string | null;
  punyaWa: boolean;
  untukLogin: boolean;
};

export type RoleRef = { id: string; nama: string; admin: boolean };

export type UserDetail = {
  id: string;
  nama: string;
  namaPanggilan: string | null;
  alamat: string | null;
  status: "aktif" | "nonaktif";
  wajibGantiPassword: boolean;
  loginTerakhir: string | null;
  phones: Phone[];
  roles: RoleRef[];
};

export type Me = {
  user: UserDetail;
  isAdmin: boolean;
  permissions: string[];
  relasi: { kelasWali: string[]; pengajaran: string[]; kelasAjar: string[]; anak: string[] };
};

export type Role = RoleRef & {
  keterangan: string | null;
  izin: string[];
  jumlahPengguna: number;
};

export type SessionInfo = {
  id: string;
  perangkat: string | null;
  ip: string | null;
  dibuatAt: string;
  terakhirAktif: string;
  ini: boolean;
};

export type Lokasi = { id: string; nama: string; alamat: string | null; aktif: boolean };
export type Unit = { id: string; kode: string; nama: string; urutan: number; aktif: boolean };
export type Semester = {
  id: string;
  tahunAjaranId: string;
  nomor: number;
  mulai: string;
  selesai: string;
  aktif: boolean;
};
export type TahunAjaran = {
  id: string;
  nama: string;
  mulai: string;
  selesai: string;
  aktif: boolean;
  semester: Semester[];
};
export type Kelas = {
  id: string;
  tahunAjaranId: string;
  unitId: string;
  lokasiId: string;
  nama: string;
  tingkat: number;
  kelompok: "banin" | "banat" | "campur";
  waliKelasId: string | null;
  aktif: boolean;
  unitKode: string;
  lokasiNama: string;
  waliKelasNama: string | null;
  jumlahSantri: number;
};
export type Mapel = {
  id: string;
  nama: string;
  namaArab: string | null;
  kode: string | null;
  unitId: string | null;
  aktif: boolean;
};
export type Jadwal = {
  id: string;
  pengajaranId: string;
  hari: number;
  jamMulai: string;
  jamSelesai: string;
};
export type Pengajaran = {
  id: string;
  kelasId: string;
  mapelId: string;
  guruId: string;
  kkm: number | null;
  kelasNama: string;
  mapelNama: string;
  mapelNamaArab: string | null;
  guruNama: string;
  jadwal: Jadwal[];
};
export type SantriRow = {
  id: string;
  nis: string;
  nama: string;
  namaPanggilan: string | null;
  jenisKelamin: "L" | "P" | null;
  status: "aktif" | "lulus" | "pindah" | "keluar";
  kelasId: string | null;
  kelasNama: string | null;
  unitKode: string | null;
  lokasiNama: string | null;
  panggilanKembar: boolean;
};
export type SantriDetail = Omit<
  SantriRow,
  "kelasId" | "kelasNama" | "unitKode" | "lokasiNama" | "panggilanKembar"
> & {
  tempatLahir: string | null;
  tanggalLahir: string | null;
  alamat: string | null;
  riwayat: {
    id: string;
    tahunAjaranId: string;
    tahunAjaran: string;
    kelasId: string;
    kelasNama: string;
    status: string;
  }[];
  wali: {
    userId: string;
    nama: string;
    hubungan: "ayah" | "ibu" | "wali";
    penerimaTagihan: boolean;
    nomor: string[];
  }[];
};
export type WaliRow = {
  id: string;
  nama: string;
  status: "aktif" | "nonaktif";
  phones: Phone[];
  anak: {
    santriId: string;
    nama: string;
    nis: string;
    hubungan: "ayah" | "ibu" | "wali";
    penerimaTagihan: boolean;
  }[];
};
export type PublicConfig = {
  turnstileSiteKey: string;
  nama: string;
  namaSingkat: string;
  logoUrl: string | null;
  dataContoh: boolean;
  zonaWaktu: string;
};

export type Status = "H" | "S" | "I" | "A";
export type KelasHariIni = {
  id: string;
  nama: string;
  unitKode: string;
  lokasiNama: string;
  sudah: boolean;
  libur: boolean;
  alasan: string | null;
  bisaIsi: boolean;
};
export type PresensiKelas = {
  kelas: {
    id: string;
    nama: string;
    unitKode: string;
    lokasiNama: string;
    waliKelasNama: string | null;
    taMulai: string;
    taSelesai: string;
  };
  tanggal: string;
  hariIni: string;
  libur: boolean;
  alasan: string | null;
  bisaUbah: boolean;
  bisaKoreksi: boolean;
  sesi: { disimpanAt: string; disimpanOleh: string | null } | null;
  santri: {
    pendaftaranId: string;
    santriId: string;
    nama: string;
    namaPanggilan: string | null;
    noAbsen: number | null;
    status: Status;
    keterangan: string | null;
    tersimpan: boolean;
  }[];
};
export type Laporan = {
  kelas?: PresensiKelas["kelas"];
  dari: string;
  sampai: string;
  tanggal: string[];
  rows: {
    pendaftaranId: string;
    santriId: string;
    nama: string;
    namaPanggilan: string | null;
    noAbsen: number | null;
    kelasNama: string;
    harian: Record<string, Status>;
    total: Record<Status, number>;
    persen: number | null;
  }[];
};
export type Agenda = {
  id: string;
  judul: string;
  deskripsi: string | null;
  mulai: string;
  selesai: string;
  libur: boolean;
  sasaran: { unitId: string | null; lokasiId: string | null; kelasId: string | null }[];
};
