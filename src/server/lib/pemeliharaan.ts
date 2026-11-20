import type { StatusPemeliharaan } from "../../shared/backup";

// Satu proses/container: status mode pemeliharaan cukup disimpan di memori.
const state: StatusPemeliharaan = {
  aktif: false,
  tahap: null,
  mulaiAt: null,
  selesaiAt: null,
  gagal: false,
  pesan: null,
};

export const pemeliharaan = {
  status: (): StatusPemeliharaan => ({ ...state }),
  aktif: () => state.aktif,
  mulai(tahap: string) {
    Object.assign(state, {
      aktif: true,
      tahap,
      mulaiAt: new Date().toISOString(),
      selesaiAt: null,
      gagal: false,
      pesan: null,
    });
  },
  tahap(tahap: string) {
    state.tahap = tahap;
  },
  selesai(gagal: boolean, pesan: string) {
    Object.assign(state, {
      aktif: false,
      tahap: null,
      selesaiAt: new Date().toISOString(),
      gagal,
      pesan,
    });
  },
  /** Worker latar menunggu sampai restore selesai (job tidak gagal, hanya tertunda). */
  async tunggu() {
    while (state.aktif) await new Promise((r) => setTimeout(r, 2000));
  },
};
