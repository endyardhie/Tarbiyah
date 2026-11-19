import {
  BookOpen,
  Building2,
  ClipboardCheck,
  House,
  type LucideIcon,
  Megaphone,
  Settings,
  Wallet,
} from "lucide-react";

export type AppPath =
  | "/"
  | "/presensi"
  | "/akademik"
  | "/keuangan"
  | "/informasi"
  | "/sekolah"
  | "/sistem";

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

// Navbar bawah mobile: maks 4 tujuan + "Menu" di paling kanan. Disesuaikan per peran mulai M1.
export const MOBILE_NAV = (["/", "/presensi", "/akademik", "/informasi"] as const)
  .map((to) => NAV_ITEMS.find((i) => i.to === to))
  .filter((i): i is NavItem => Boolean(i));
