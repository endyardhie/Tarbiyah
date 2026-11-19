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
  relasi: { kelasWali: string[]; pengajaran: string[]; anak: string[] };
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
