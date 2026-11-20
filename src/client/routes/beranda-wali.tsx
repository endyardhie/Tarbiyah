import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  type LucideIcon,
  Megaphone,
  PencilLine,
  Receipt,
  ScrollText,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { formatRupiah, labelPeriode } from "../../shared/keuangan";
import type { Agenda } from "../../shared/types";
import { api } from "../lib/api";
import { formatTanggal, formatWaktu, hariIniSekolah } from "../lib/format";
import type { AppPath } from "../lib/nav";
import { usePublicConfig } from "../lib/sekolah";
import { useTagihanAnak } from "./keuangan-wali";

type Kehadiran = {
  anak: {
    santriId: string;
    nama: string;
    namaPanggilan: string | null;
    kelasNama: string;
    total: Record<"H" | "S" | "I" | "A", number>;
    persen: number | null;
  }[];
};

const tglPendek = (t: string) =>
  formatTanggal(new Date(`${t}T00:00:00Z`), "UTC").replace(/^\w+, /, "");
const inisial = (n: string) =>
  n
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

const AKSI: { to: AppPath; label: string; icon: LucideIcon; cls: string }[] = [
  { to: "/presensi", label: "Presensi", icon: ClipboardCheck, cls: "bg-soft text-on-soft" },
  { to: "/akademik", label: "PR & nilai", icon: BookOpen, cls: "bg-info-soft text-info" },
  { to: "/keuangan", label: "Tagihan", icon: Receipt, cls: "bg-warn-soft text-warn" },
  { to: "/akademik", label: "Rapor", icon: ScrollText, cls: "bg-danger-soft text-danger" },
];

/** Beranda wali santri: sapaan, kartu anak, aksi cepat, angka penting, lalu yang perlu diperhatikan. */
export function BerandaWali({ nama }: { nama: string | undefined }) {
  const config = usePublicConfig();
  const tagihan = useTagihanAnak();
  const kehadiran = useQuery({
    queryKey: ["presensi", "ringkasan-anak"],
    queryFn: () => api<Kehadiran>("/presensi/ringkasan-anak"),
  });
  const tugas = useQuery({
    queryKey: ["akademik", "tugas-aktif"],
    queryFn: () =>
      api<{ id: string; judul: string; tenggat: string; mapelNama: string }[]>(
        "/akademik/tugas-aktif",
      ),
  });
  const pengumuman = useQuery({
    queryKey: ["pengumuman"],
    queryFn: () => api<{ id: string; judul: string; dikirimAt: string }[]>("/pengumuman"),
  });
  const hariIni = hariIniSekolah();
  const sampai = new Date(Date.parse(`${hariIni}T00:00:00Z`) + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const agenda = useQuery({
    queryKey: ["agenda", "beranda", hariIni],
    queryFn: () => api<Agenda[]>(`/agenda?dari=${hariIni}&sampai=${sampai}`),
  });
  const [anakId, setAnakId] = useState("");

  // Daftar anak dari data tagihan (selalu lengkap); kehadiran hanya ada bila terdaftar tahun ini.
  const daftar = tagihan.data?.anak ?? [];
  const anak = daftar.find((a) => a.id === anakId) ?? daftar[0];
  const hadir = kehadiran.data?.anak.find((k) => k.santriId === anak?.id);
  const belum = (anak?.tagihan ?? [])
    .filter((t) => t.status === "belum")
    .sort((x, y) => x.periode.localeCompare(y.periode));
  const totalBelum = belum.reduce((n, t) => n + t.total, 0);
  const panggilan = hadir?.namaPanggilan || anak?.nama.split(/\s+/)[0] || "";

  const perhatian = [
    ...(tugas.data ?? []).slice(0, 3).map((t) => ({
      id: `t${t.id}`,
      icon: PencilLine,
      cls: "bg-info-soft text-info",
      judul: t.judul,
      ket: `${t.mapelNama} · tenggat ${tglPendek(t.tenggat)}`,
      to: "/akademik" as AppPath,
    })),
    ...(agenda.data ?? []).slice(0, 1).map((a) => ({
      id: `a${a.id}`,
      icon: CalendarDays,
      cls: "bg-warn-soft text-warn",
      judul: a.judul,
      ket:
        a.mulai === a.selesai
          ? tglPendek(a.mulai)
          : `${tglPendek(a.mulai)} – ${tglPendek(a.selesai)}`,
      to: "/informasi/kalender" as AppPath,
    })),
    ...(pengumuman.data ?? []).slice(0, 2).map((p) => ({
      id: `p${p.id}`,
      icon: Megaphone,
      cls: "bg-soft text-on-soft",
      judul: p.judul,
      ket: `Pengumuman · ${formatWaktu(p.dikirimAt)}`,
      to: "/informasi/pengumuman" as AppPath,
    })),
  ];

  return (
    <div className="space-y-3">
      <section className="rounded-card bg-primary px-5 pt-5 pb-14 text-on-primary dark:bg-soft dark:text-on-soft">
        <p className="text-sm opacity-85">{config.data?.nama}</p>
        <p className="mt-3 text-sm opacity-85">Assalamu'alaikum,</p>
        <h1 className="text-2xl font-bold">{nama}</h1>
        <p className="text-sm opacity-85">{formatTanggal(new Date())}</p>
      </section>

      {anak ? (
        <div className="relative -mt-12 mx-2 flex flex-wrap items-center gap-3 rounded-[22px] border border-border bg-surface p-3 shadow-soft">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-warn-soft font-bold text-warn">
            {inisial(panggilan || anak.nama)}
          </span>
          <div className="min-w-36 flex-1">
            <p className="truncate font-bold">{anak.nama}</p>
            <p className="truncate text-sm text-text2">{hadir?.kelasNama ?? `NIS ${anak.nis}`}</p>
          </div>
          {daftar.length > 1 && (
            <select
              aria-label="Pilih anak"
              className="ml-auto min-h-11 max-w-28 rounded-full border border-border bg-surface-raised px-3 text-sm font-semibold"
              value={anak.id}
              onChange={(e) => setAnakId(e.target.value)}
            >
              {daftar.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nama.split(/\s+/)[0]}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <div className="-mt-12 mx-2 h-[68px] animate-pulse rounded-[22px] bg-surface-muted" />
      )}

      <nav
        aria-label="Aksi cepat"
        className="grid grid-cols-4 gap-2 rounded-[22px] border border-border bg-surface p-3"
      >
        {AKSI.map(({ to, label, icon: Icon, cls }) => (
          <Link
            key={label}
            to={to}
            className="flex min-h-11 flex-col items-center gap-1.5 rounded-2xl py-1 text-center text-xs font-semibold text-text active:scale-95"
          >
            <span className={`grid size-12 place-items-center rounded-2xl ${cls}`}>
              <Icon size={22} />
            </span>
            {label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/presensi" className="rounded-[22px] border border-border bg-surface p-4">
          <p className="text-xs text-text2">Hadir bulan ini</p>
          <p className="text-2xl font-bold text-primary tabular-nums">
            {hadir?.persen == null ? "—" : `${hadir.persen.toLocaleString("id-ID")}%`}
          </p>
          <p className="text-xs text-text2">
            {hadir && hadir.persen != null
              ? `${hadir.total.S} sakit · ${hadir.total.I} izin · ${hadir.total.A} alpa`
              : "Belum ada data"}
          </p>
        </Link>
        <Link to="/keuangan" className="rounded-[22px] border border-border bg-surface p-4">
          <p className="text-xs text-text2">Tagihan</p>
          <p className="mt-0.5 text-lg font-bold whitespace-nowrap tabular-nums">
            {belum.length ? formatRupiah(totalBelum) : "Lunas"}
          </p>
          {belum[0] ? (
            <span className="mt-1 inline-block rounded-full bg-warn-soft px-2.5 py-0.5 text-xs font-bold text-warn">
              {labelPeriode(belum[0].periode).split(" ")[0]}
              {belum.length > 1 ? ` +${belum.length - 1}` : ""} · belum
            </span>
          ) : (
            <span className="mt-1 inline-block rounded-full bg-soft px-2.5 py-0.5 text-xs font-bold text-on-soft">
              Terima kasih
            </span>
          )}
        </Link>
      </div>

      <section className="rounded-[22px] border border-border bg-surface px-4 pt-4 pb-1">
        <h2 className="font-bold">Perlu perhatian</h2>
        {perhatian.length === 0 ? (
          <p className="flex items-center gap-2 py-4 text-sm text-text2">
            <Sparkles size={18} className="text-primary" /> Tidak ada yang perlu diperhatikan saat
            ini.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {perhatian.map(({ id, icon: Icon, cls, judul, ket, to }) => (
              <li key={id}>
                <Link to={to} className="flex min-h-14 items-center gap-3 py-2.5">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-full ${cls}`}>
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{judul}</span>
                    <span className="block truncate text-xs text-text2">{ket}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
