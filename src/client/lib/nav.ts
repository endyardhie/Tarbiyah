import {
  Bell,
  BookOpen,
  Building2,
  ClipboardCheck,
  House,
  type LucideIcon,
  Megaphone,
  Receipt,
  Settings,
  Wallet,
} from "lucide-react";
import type { Me } from "../../shared/types";
import { hasPermission } from "./auth";

export type AppPath =
  | "/"
  | "/presensi"
  | "/akademik"
  | "/akademik/pengaturan"
  | "/akademik/template"
  | "/keuangan"
  | "/informasi"
  | "/informasi/kalender"
  | "/informasi/pengumuman"
  | "/notifikasi"
  | "/notifikasi/aktifkan"
  | "/sekolah"
  | "/sekolah/santri"
  | "/sekolah/wali"
  | "/sekolah/kelas"
  | "/sekolah/mapel"
  | "/sekolah/pengajaran"
  | "/sekolah/struktur"
  | "/sekolah/impor"
  | "/sistem"
  | "/sistem/pengguna"
  | "/sistem/role"
  | "/sistem/pengaturan"
  | "/profil"
  | "/perangkat";

export type NavItem = { to: AppPath; label: string; icon: LucideIcon };

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Beranda", icon: House },
  { to: "/presensi", label: "Presensi", icon: ClipboardCheck },
  { to: "/akademik", label: "Akademik", icon: BookOpen },
  { to: "/keuangan", label: "Keuangan", icon: Wallet },
  { to: "/informasi", label: "Informasi", icon: Megaphone },
  { to: "/sekolah", label: "Data Sekolah", icon: Building2 },
  { to: "/sistem", label: "Sistem", icon: Settings },
];

/** Wali santri yang tidak punya jabatan maupun kelas/mapel yang dipegang. */
export function isPureWali(me: Me | null | undefined) {
  return (
    !!me &&
    !me.isAdmin &&
    me.user.roles.length === 0 &&
    me.relasi.kelasWali.length === 0 &&
    me.relasi.pengajaran.length === 0
  );
}

/** Bendahara/staf keuangan (hanya tampilan; server tetap memeriksa can()). */
export function aksesKeuangan(me: Me | null | undefined) {
  return (
    hasPermission(me, "keuangan.lihat") ||
    hasPermission(me, "keuangan.kelola") ||
    hasPermission(me, "keuangan.catat_manual")
  );
}

/** Menu sesuai hak pengguna (hanya tampilan; server tetap memeriksa can()). */
export function visibleNav(me: Me | null | undefined) {
  const wali = isPureWali(me);
  return NAV_ITEMS.filter((i) => {
    if (i.to === "/sistem") return hasPermission(me, "pengguna.kelola");
    if (i.to === "/sekolah") return !wali;
    if (i.to === "/keuangan") return aksesKeuangan(me) || !!me?.relasi.anak.length;
    return true;
  });
}

const item = (to: AppPath, label: string, icon: LucideIcon): NavItem => ({ to, label, icon });

/** Navbar bawah mobile per peran: maks 4 tujuan, item ke-5 (paling kanan) selalu "Menu". */
export function mobileNav(me: Me | null | undefined): NavItem[] {
  if (isPureWali(me)) {
    return [
      item("/", "Beranda", House),
      item("/akademik", "Akademik", BookOpen),
      item("/keuangan", "Tagihan", Receipt),
      item("/notifikasi", "Notifikasi", Bell),
    ];
  }
  if (me?.relasi.kelasWali.length) {
    return [
      item("/", "Beranda", House),
      item("/presensi", "Presensi", ClipboardCheck),
      item("/akademik", "Akademik", BookOpen),
      item("/notifikasi", "Notifikasi", Bell),
    ];
  }
  if (!me?.isAdmin && aksesKeuangan(me)) {
    return [
      item("/", "Beranda", House),
      item("/keuangan", "Keuangan", Wallet),
      item("/informasi", "Informasi", Megaphone),
      item("/notifikasi", "Notifikasi", Bell),
    ];
  }
  return [
    item("/", "Beranda", House),
    item("/presensi", "Presensi", ClipboardCheck),
    item("/akademik", "Akademik", BookOpen),
    item("/informasi", "Informasi", Megaphone),
  ];
}
