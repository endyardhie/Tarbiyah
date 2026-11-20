import type { StatusPemeliharaan } from "../../shared/backup";

// Satu proses/container: status mode pemeliharaan cukup disimpan di memori.
// Detail teknis (stderr pg_restore, dll.) hanya untuk admin, tidak ikut status publik.
let detail: string | null = null;
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
  detail: () => detail,
  aktif: () => state.aktif,
  mulai(tahap: string) {
    detail = null;
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
  selesai(gagal: boolean, pesan: string, rincian: string | null = null) {
    detail = rincian;
    Object.assign(state, {
      aktif: false,
      tahap: null,
      selesaiAt: new Date().toISOString(),
      gagal,
      pesan,
    });
  },
  /** Restore gagal total: aplikasi tetap terkunci sampai dipulihkan manual oleh pengelola. */
  macet(pesan: string, rincian: string) {
    detail = rincian;
    Object.assign(state, { aktif: true, tahap: pesan, gagal: true, pesan });
  },
  /** Worker latar menunggu sampai restore selesai (job tidak gagal, hanya tertunda). */
  async tunggu() {
    while (state.aktif) await new Promise((r) => setTimeout(r, 2000));
  },
};
