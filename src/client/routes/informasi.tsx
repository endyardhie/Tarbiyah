import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Plus,
  Trash2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { Agenda } from "../../shared/types";
import { ListSkeleton } from "../components/MasterList";
import { Card, PageHeader } from "../components/Page";
import {
  fromSasaran,
  type SasaranDraft,
  SasaranEditor,
  sasaranLengkap,
  toSasaran,
} from "../components/SasaranEditor";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatTanggal, formatWaktu, hariIniSekolah } from "../lib/format";
import { monthOf, tglDate, useHariIni } from "../lib/presensi";
import { useJumlahNotif } from "../lib/push";
import { HARI, useKelas, useLokasi, useUnits } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { Badge } from "./sekolah";

/** Hub Informasi: tiap kartu menampilkan isi terbaru, bukan hanya judul menu. */
export function InformasiPage() {
  const hariIni = hariIniSekolah();
  const sampai = new Date(Date.parse(`${hariIni}T00:00:00Z`) + 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // Kunci query sama dengan beranda wali agar data dipakai bersama.
  const agenda = useQuery({
    queryKey: ["agenda", "beranda", hariIni],
    queryFn: () => api<Agenda[]>(`/agenda?dari=${hariIni}&sampai=${sampai}`),
  });
  const pengumuman = useQuery({
    queryKey: ["pengumuman"],
    queryFn: () => api<{ id: string; judul: string; dikirimAt: string }[]>("/pengumuman"),
  });
  const belum = useJumlahNotif().data?.belum ?? 0;
  const a = agenda.data?.[0];
  const p = pengumuman.data?.[0];
  const items = [
    {
      to: "/informasi/kalender" as const,
      icon: CalendarDays,
      cls: "bg-warn-soft text-warn",
      title: "Kalender",
      desc: a
        ? `${a.judul} · ${formatTanggal(tglDate(a.mulai), "UTC").replace(/^\w+, /, "")}`
        : "Agenda & hari libur",
      badge: 0,
    },
    {
      to: "/informasi/pengumuman" as const,
      icon: Megaphone,
      cls: "bg-soft text-on-soft",
      title: "Pengumuman",
      desc: p ? `${p.judul} · ${formatWaktu(p.dikirimAt)}` : "Dari sekolah & guru",
      badge: 0,
    },
    {
      to: "/notifikasi" as const,
      icon: Bell,
      cls: "bg-info-soft text-info",
      title: "Notifikasi",
      desc: belum ? `${belum} belum dibaca` : "Semua sudah dibaca",
      badge: belum,
    },
  ];
  return (
    <>
      <PageHeader title="Informasi" subtitle="Kalender, pengumuman, dan notifikasi." />
      <div className="grid gap-3 md:grid-cols-3">
        {items.map(({ to, icon: Icon, cls, title, desc, badge }) => (
          <Link
            key={to}
            to={to}
            className="flex min-h-20 items-center gap-4 rounded-[24px] border border-border bg-surface p-4 shadow-soft transition-colors hover:border-primary"
          >
            <span className={`grid size-12 shrink-0 place-items-center rounded-[18px] ${cls}`}>
              <Icon size={22} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-bold">{title}</span>
              <span className="block truncate text-sm text-text2">{desc}</span>
            </span>
            {badge > 0 && (
              <span className="grid min-w-6 place-items-center rounded-full bg-danger px-1.5 text-xs font-bold text-on-danger">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
            <ChevronRight size={20} className="shrink-0 text-text2" />
          </Link>
        ))}
      </div>
    </>
  );
}

function useSasaranLabel() {
  const units = useUnits();
  const lokasi = useLokasi();
  const kelas = useKelas();
  return (s: Agenda["sasaran"][number]) => {
    const parts = [
      s.unitId && units.data?.find((u) => u.id === s.unitId)?.kode,
      s.lokasiId && lokasi.data?.find((l) => l.id === s.lokasiId)?.nama,
      s.kelasId && (kelas.data?.find((k) => k.id === s.kelasId)?.nama ?? "Kelas"),
    ].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Seluruh sekolah";
  };
}

function AgendaForm({ agenda, onDone }: { agenda: Agenda | null; onDone: () => void }) {
  const [judul, setJudul] = useState(agenda?.judul ?? "");
  const [deskripsi, setDeskripsi] = useState(agenda?.deskripsi ?? "");
  const [mulai, setMulai] = useState(agenda?.mulai ?? "");
  const [selesai, setSelesai] = useState(agenda?.selesai ?? "");
  const [libur, setLibur] = useState(agenda?.libur ?? false);
  const [targets, setTargets] = useState<SasaranDraft[]>(
    agenda ? fromSasaran(agenda.sasaran) : [{ tipe: "semua", id: "" }],
  );
  const [error, setError] = useState("");
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["agenda"] });
    await queryClient.invalidateQueries({ queryKey: ["presensi"] });
    onDone();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        judul,
        deskripsi,
        mulai,
        selesai: selesai || mulai,
        libur,
        sasaran: toSasaran(targets),
      };
      return agenda
        ? api(`/agenda/${agenda.id}`, { method: "PATCH", body })
        : api("/agenda", { body });
    },
    onSuccess: done,
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/agenda/${agenda?.id}`, { method: "DELETE" }),
    onSuccess: done,
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!sasaranLengkap(targets)) return setError("Lengkapi pilihan sasaran");
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Judul">
        {(id) => (
          <Input id={id} value={judul} onChange={(e) => setJudul(e.target.value)} required />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mulai">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={mulai}
              onChange={(e) => setMulai(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Selesai">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={selesai}
              min={mulai}
              onChange={(e) => setSelesai(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Keterangan">
        {(id) => (
          <Textarea id={id} value={deskripsi} onChange={(e) => setDeskripsi(e.target.value)} />
        )}
      </Field>
      <Checkbox
        label="Hari libur"
        description="Presensi terkunci untuk kelas yang termasuk sasaran."
        checked={libur}
        onChange={(e) => setLibur(e.target.checked)}
      />
      <SasaranEditor value={targets} onChange={setTargets} />
      <ErrorAlert>{error}</ErrorAlert>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {agenda ? (
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => confirm(`Hapus agenda "${agenda.judul}"?`) && remove.mutate()}
          >
            <Trash2 size={18} /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={save.isPending}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

export function KalenderPage() {
  const { data: me } = useMe();
  const canEdit = hasPermission(me, "kalender.kelola");
  const hari = useHariIni();
  const today = hari.data?.tanggal ?? new Date().toISOString().slice(0, 10);
  const [bulan, setBulan] = useState<string | null>(null);
  const month = bulan ?? today.slice(0, 7);
  const { dari, sampai } = monthOf(month);
  const list = useQuery({
    queryKey: ["agenda", month],
    queryFn: () => api<Agenda[]>(`/agenda?dari=${dari}&sampai=${sampai}`),
  });
  const libur = useQuery({
    queryKey: ["libur-mingguan"],
    queryFn: () =>
      api<{ hari: number; unitId: string | null; lokasiId: string | null }[]>("/libur-mingguan"),
  });
  const label = useSasaranLabel();
  const [editing, setEditing] = useState<Agenda | "baru" | null>(null);

  const days = useMemo(() => {
    const first = tglDate(dari);
    const offset = (first.getUTCDay() + 6) % 7; // Senin = kolom pertama
    const count = Number(sampai.slice(8));
    return [
      ...Array(offset).fill(null),
      ...Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
    ];
  }, [dari, sampai, month]);
  const liburGlobal = new Set(
    (libur.data ?? []).filter((l) => !l.unitId && !l.lokasiId).map((l) => l.hari),
  );
  const agendaOn = (d: string) => (list.data ?? []).filter((a) => a.mulai <= d && a.selesai >= d);
  const shift = (n: number) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const dt = new Date(Date.UTC(y, m - 1 + n, 1));
    setBulan(dt.toISOString().slice(0, 7));
  };
  const monthLabel = new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(tglDate(dari));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <PageHeader title="Kalender" subtitle="Agenda sekolah dan hari libur." />
        {canEdit && (
          <Button className="mb-6" onClick={() => setEditing("baru")}>
            <Plus size={18} /> Tambah agenda
          </Button>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <Card className="lg:col-span-7">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Bulan sebelumnya"
              className="grid size-11 place-items-center rounded-full hover:bg-surface-muted"
              onClick={() => shift(-1)}
            >
              <ChevronLeft />
            </button>
            <p className="font-semibold capitalize">{monthLabel}</p>
            <button
              type="button"
              aria-label="Bulan berikutnya"
              className="grid size-11 place-items-center rounded-full hover:bg-surface-muted"
              onClick={() => shift(1)}
            >
              <ChevronRight />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-text2">
            {HARI.slice(1).map((h) => (
              <span key={h}>{h.slice(0, 3)}</span>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              if (!d) return <span key={`kosong-${i}`} />;
              const ag = agendaOn(d);
              const isLibur =
                ag.some((a) => a.libur) || liburGlobal.has(((tglDate(d).getUTCDay() + 6) % 7) + 1);
              return (
                <div
                  key={d}
                  className={`flex aspect-square flex-col items-center justify-center rounded-xl text-sm ${
                    d === today ? "ring-2 ring-primary" : ""
                  } ${isLibur ? "bg-danger-soft text-danger" : "bg-surface-muted"}`}
                  title={ag.map((a) => a.judul).join(", ")}
                >
                  <span className="font-semibold tabular-nums">{Number(d.slice(8))}</span>
                  {ag.length > 0 && (
                    <span
                      className="mt-0.5 size-1.5 rounded-full bg-primary"
                      aria-label={`${ag.length} agenda`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-text2">
            Merah = hari libur (libur mingguan seluruh sekolah atau agenda libur). Titik = ada
            agenda.
          </p>
        </Card>
        <div className="space-y-2 lg:col-span-5">
          {list.isPending ? (
            <ListSkeleton />
          ) : list.isError ? (
            <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
          ) : list.data.length === 0 ? (
            <p className="rounded-2xl bg-surface-muted px-4 py-6 text-center text-text2">
              Tidak ada agenda bulan ini.
            </p>
          ) : (
            list.data.map((a) => (
              <Card key={a.id} className="p-4 md:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {a.judul} {a.libur && <Badge tone="warn">Libur</Badge>}
                    </p>
                    <p className="text-sm text-text2">
                      {formatTanggal(tglDate(a.mulai), "UTC")}
                      {a.selesai !== a.mulai && ` – ${formatTanggal(tglDate(a.selesai), "UTC")}`}
                    </p>
                    <p className="mt-1 text-sm text-text2">{a.sasaran.map(label).join(", ")}</p>
                    {a.deskripsi && (
                      <p className="mt-2 text-sm whitespace-pre-line">{a.deskripsi}</p>
                    )}
                  </div>
                  {canEdit && (
                    <Button variant="ghost" className="shrink-0 px-3" onClick={() => setEditing(a)}>
                      Ubah
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
      <Modal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "baru" ? "Tambah agenda" : "Ubah agenda"}
      >
        {editing !== null && (
          <AgendaForm
            key={editing === "baru" ? "baru" : editing.id}
            agenda={editing === "baru" ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}
