import { useQuery as useQ, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, CheckCircle2, XCircle } from "lucide-react";
import { formatRupiah, labelPeriode, METODE_LABEL } from "../../shared/keuangan";
import type { Agenda } from "../../shared/types";
import { Card, PageHeader } from "../components/Page";
import { api } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatTanggal, formatWaktu, hariIniSekolah } from "../lib/format";
import { isPureWali } from "../lib/nav";
import { useHariIni } from "../lib/presensi";
import { usePublicConfig } from "../lib/sekolah";
import { useRingkasanBackup } from "./backup";
import { useTagihanAnak } from "./keuangan-wali";

type Health = { ok: boolean; versi: string; waktuSekolah: string; db: boolean; boss: boolean };

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-2xl bg-surface-muted px-4 py-3">
      <span className="font-medium">{label}</span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${ok ? "bg-soft text-on-soft" : "bg-danger-soft text-danger"}`}
      >
        {ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        {ok ? "Normal" : "Bermasalah"}
      </span>
    </li>
  );
}

function SystemStatus() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: async (): Promise<Health> => {
      const res = await fetch("/api/health");
      if (!res.ok && res.status !== 503) throw new Error(String(res.status));
      return res.json();
    },
  });

  return (
    <Card className="lg:col-span-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-soft text-on-soft">
          <Activity size={20} />
        </span>
        <h2 className="text-lg font-semibold">Status sistem</h2>
      </div>
      {isPending ? (
        <ul className="space-y-2" aria-busy="true" aria-label="Memuat status">
          {[0, 1].map((i) => (
            <li key={i} className="h-12 animate-pulse rounded-2xl bg-surface-muted" />
          ))}
        </ul>
      ) : isError ? (
        <div className="rounded-2xl bg-danger-soft p-4 text-danger">
          <p className="font-semibold">Server tidak bisa dihubungi.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 min-h-11 rounded-full bg-surface-raised px-4 font-semibold text-text"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            <StatusRow label="Database" ok={data.db} />
            <StatusRow label="Antrean & jadwal" ok={data.boss} />
          </ul>
          <p className="mt-4 text-sm text-text2">
            Waktu sekolah {data.waktuSekolah} WIT · versi {data.versi.slice(0, 7)}
          </p>
        </>
      )}
    </Card>
  );
}

function KartuPresensiStaf() {
  const { data: me } = useMe();
  const hari = useHariIni();
  if (!hari.data || !me) return null;
  const lihatSemua = me.isAdmin || me.permissions.includes("presensi.lihat_semua");
  const kelasSaya = hari.data.kelas.filter((k) => me.relasi.kelasWali.includes(k.id));
  const belum = hari.data.kelas.filter((k) => !k.sudah && !k.libur);
  return (
    <>
      {kelasSaya.map((k) => (
        <Card key={k.id} className="lg:col-span-6">
          <p className="text-sm text-text2">Presensi hari ini</p>
          <p className="text-lg font-semibold">
            {k.nama} · {k.unitKode} {k.lokasiNama}
          </p>
          <p
            className={`mt-2 font-semibold ${k.libur ? "text-text2" : k.sudah ? "text-primary" : "text-warn"}`}
          >
            {k.libur ? `Hari libur: ${k.alasan}` : k.sudah ? "Sudah diabsen" : "Belum diabsen"}
          </p>
          {!k.libur && (
            <Link
              to="/presensi"
              className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-on-primary hover:bg-primary-hover"
            >
              {k.sudah ? "Lihat / ubah" : "Absen sekarang"}
            </Link>
          )}
        </Card>
      ))}
      {lihatSemua && (
        <Card className="lg:col-span-6">
          <p className="text-sm text-text2">Kelas belum absen hari ini</p>
          <p className="text-3xl font-bold tabular-nums">{belum.length}</p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-sm">
            {belum.map((k) => (
              <li key={k.id}>
                {k.nama} · {k.unitKode} {k.lokasiNama}
              </li>
            ))}
            {belum.length === 0 && <li className="text-primary">Semua kelas sudah diabsen.</li>}
          </ul>
        </Card>
      )}
    </>
  );
}

function KartuKehadiranAnak() {
  const q = useQuery({
    queryKey: ["presensi", "ringkasan-anak"],
    queryFn: () =>
      api<{
        anak: {
          santriId: string;
          nama: string;
          kelasNama: string;
          total: Record<"H" | "S" | "I" | "A", number>;
          persen: number | null;
        }[];
      }>("/presensi/ringkasan-anak"),
  });
  return (
    <>
      {q.data?.anak.map((a) => (
        <Card key={a.santriId} className="lg:col-span-6">
          <p className="text-sm text-text2">Kehadiran bulan ini</p>
          <p className="text-lg font-semibold">{a.nama}</p>
          <p className="text-sm text-text2">{a.kelasNama}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums">
            {a.persen == null ? "—" : `${a.persen.toLocaleString("id-ID")}%`}
          </p>
          <p className="text-sm text-text2">
            Hadir {a.total.H} · Sakit {a.total.S} · Izin {a.total.I} · Alpa {a.total.A}
          </p>
          <Link
            to="/presensi"
            className="mt-3 inline-flex min-h-11 items-center font-semibold text-primary"
          >
            Lihat rincian
          </Link>
        </Card>
      ))}
    </>
  );
}

/** Wali: tagihan belum lunas + tombol Bayar. */
function KartuTagihanAnak() {
  const q = useTagihanAnak();
  const belum = q.data?.anak.flatMap((a) =>
    a.tagihan.filter((t) => t.status === "belum").map((t) => ({ ...t, anak: a.nama })),
  );
  if (!belum) return null;
  const total = belum.reduce((a, t) => a + t.total, 0);
  return (
    <Card className="lg:col-span-6">
      <p className="text-sm text-text2">Tagihan belum lunas</p>
      <p className="text-3xl font-bold tabular-nums">{formatRupiah(total)}</p>
      {belum.length === 0 ? (
        <p className="mt-1 font-medium text-primary">Semua tagihan sudah lunas. Terima kasih.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {belum.slice(0, 4).map((t) => (
            <li key={t.id} className="flex justify-between gap-2">
              <span>
                {t.anak} · {labelPeriode(t.periode)}
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {formatRupiah(t.total)}
              </span>
            </li>
          ))}
          {belum.length > 4 && <li className="text-text2">+{belum.length - 4} lainnya</li>}
        </ul>
      )}
      {belum.length > 0 && (
        <Link
          to="/keuangan"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-primary px-5 font-semibold text-on-primary hover:bg-primary-hover"
        >
          {q.data?.online ? "Bayar" : "Lihat tagihan"}
        </Link>
      )}
    </Card>
  );
}

type Ringkasan = {
  periode: string;
  tagihan: number;
  nTagihan: number;
  terbayar: number;
  nLunas: number;
  tunggakan: number;
  nTunggak: number;
  penerimaan: number;
  terbaru: {
    id: string;
    santriNama: string;
    periode: string;
    jumlah: number;
    metode: keyof typeof METODE_LABEL;
    dibayarAt: string;
  }[];
};

/** Bendahara/admin: ringkasan keuangan bulan berjalan. */
function RingkasanKeuangan() {
  const q = useQuery({
    queryKey: ["keuangan", "ringkasan"],
    queryFn: () => api<Ringkasan>("/keuangan/ringkasan"),
  });
  const d = q.data;
  if (!d) return null;
  const stat = (label: string, nilai: number, ket: string) => (
    <div className="rounded-2xl bg-surface-muted p-3">
      <p className="text-sm text-text2">{label}</p>
      <p className="text-xl font-bold tabular-nums">{formatRupiah(nilai)}</p>
      <p className="text-sm text-text2">{ket}</p>
    </div>
  );
  return (
    <Card className="lg:col-span-12">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Keuangan {labelPeriode(d.periode)}</h2>
        <Link
          to="/keuangan"
          className="inline-flex min-h-11 items-center font-semibold text-primary"
        >
          Buka keuangan
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat("Tagihan bulan ini", d.tagihan, `${d.nTagihan} tagihan`)}
        {stat("Sudah dibayar", d.terbayar, `${d.nLunas} lunas`)}
        {stat("Tunggakan", d.tunggakan, `${d.nTunggak} santri lewat jatuh tempo`)}
        {stat("Penerimaan bulan ini", d.penerimaan, "semua periode")}
      </div>
      {d.terbaru.length > 0 && (
        <ul className="mt-3 divide-y divide-border text-sm">
          {d.terbaru.map((p) => (
            <li key={p.id} className="flex justify-between gap-2 py-2">
              <span>
                {p.santriNama} · {labelPeriode(p.periode)} · {METODE_LABEL[p.metode]}
              </span>
              <span className="shrink-0 whitespace-nowrap tabular-nums">
                {formatRupiah(p.jumlah)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const tgl = (t: string) => formatTanggal(new Date(`${t}T00:00:00Z`), "UTC").replace(/^\w+, /, "");
const tambahHari = (t: string, n: number) =>
  new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function KartuDaftar({
  judul,
  ke,
  kosong,
  items,
}: {
  judul: string;
  ke: "/akademik" | "/informasi" | "/informasi/kalender" | "/informasi/pengumuman";
  kosong: string;
  items: { id: string; utama: string; ket: string }[] | undefined;
}) {
  if (!items) return null;
  return (
    <Card className="lg:col-span-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{judul}</h2>
        <Link
          to={ke}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary"
        >
          Semua
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-text2">{kosong}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id}>
              <p className="font-medium">{i.utama}</p>
              <p className="text-sm text-text2">{i.ket}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Guru: PR/tugas mapelnya; wali santri: PR kelas anaknya (tenggat terdekat). */
function KartuTugasAktif() {
  const q = useQuery({
    queryKey: ["akademik", "tugas-aktif"],
    queryFn: () =>
      api<{ id: string; judul: string; tenggat: string; mapelNama: string; kelasNama: string }[]>(
        "/akademik/tugas-aktif",
      ),
  });
  return (
    <KartuDaftar
      judul="PR & tugas aktif"
      ke="/akademik"
      kosong="Tidak ada tugas yang tenggatnya belum lewat."
      items={q.data?.map((t) => ({
        id: t.id,
        utama: t.judul,
        ket: `${t.mapelNama} · ${t.kelasNama} · tenggat ${tgl(t.tenggat)}`,
      }))}
    />
  );
}

function KartuAgenda() {
  const today = hariIniSekolah();
  const q = useQuery({
    queryKey: ["agenda", "beranda", today],
    queryFn: () => api<Agenda[]>(`/agenda?dari=${today}&sampai=${tambahHari(today, 60)}`),
  });
  return (
    <KartuDaftar
      judul="Agenda terdekat"
      ke="/informasi/kalender"
      kosong="Belum ada agenda 60 hari ke depan."
      items={q.data?.slice(0, 3).map((a) => ({
        id: a.id,
        utama: a.judul,
        ket: a.mulai === a.selesai ? tgl(a.mulai) : `${tgl(a.mulai)} – ${tgl(a.selesai)}`,
      }))}
    />
  );
}

function KartuPengumuman() {
  const q = useQuery({
    queryKey: ["pengumuman"],
    queryFn: () =>
      api<{ id: string; judul: string; dikirimAt: string; pengirimNama: string }[]>("/pengumuman"),
  });
  return (
    <KartuDaftar
      judul="Pengumuman terbaru"
      ke="/informasi/pengumuman"
      kosong="Belum ada pengumuman."
      items={q.data?.slice(0, 3).map((p) => ({
        id: p.id,
        utama: p.judul,
        ket: `${p.pengirimNama} · ${formatWaktu(p.dikirimAt)}`,
      }))}
    />
  );
}

/** Kepsek/admin: kehadiran bulan ini per unit. */
function KartuRekapUnit() {
  const q = useQuery({
    queryKey: ["presensi", "rekap-unit"],
    queryFn: () =>
      api<{ id: string; kode: string; nama: string; H: number; S: number; I: number; A: number }[]>(
        "/presensi/rekap-unit",
      ),
  });
  if (!q.data) return null;
  return (
    <Card className="lg:col-span-6">
      <h2 className="mb-2 font-semibold">Kehadiran bulan ini per unit</h2>
      {q.data.length === 0 ? (
        <p className="text-sm text-text2">Belum ada presensi bulan ini.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((u) => {
            const total = u.H + u.S + u.I + u.A;
            const persen = total ? Math.round((u.H / total) * 1000) / 10 : null;
            return (
              <li key={u.id} className="flex items-center justify-between gap-3">
                <span>
                  <span className="font-medium">{u.kode}</span>
                  <span className="block text-sm text-text2">
                    S {u.S} · I {u.I} · A {u.A}
                  </span>
                </span>
                <span className="text-xl font-bold tabular-nums">
                  {persen == null ? "—" : `${persen.toLocaleString("id-ID")}%`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** Admin: backup terakhir yang berhasil & berkas yang belum tersalin ke B2. */
function KartuBackup() {
  const q = useRingkasanBackup();
  const d = q.data;
  if (!d) return null;
  const lama =
    !d.terakhir || Date.now() - Date.parse(d.terakhir.dibuatAt) > (d.intervalHari + 1) * 86_400_000;
  return (
    <Card className="lg:col-span-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Backup</h2>
        <Link
          to="/sistem/backup"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-primary"
        >
          Buka
        </Link>
      </div>
      <p className={`font-semibold ${lama ? "text-warn" : "text-primary"}`}>
        {d.terakhir
          ? `Terakhir berhasil ${formatWaktu(d.terakhir.dibuatAt)}`
          : "Belum pernah backup"}
      </p>
      <p className="text-sm text-text2">
        {d.b2Aktif
          ? `${d.berkasBelumTersalin} berkas belum tersalin ke B2`
          : "B2 belum aktif: backup hanya ada di server"}
      </p>
    </Card>
  );
}

export function BerandaPage() {
  const { data: me } = useMe();
  const config = usePublicConfig();
  const nama = me?.user.namaPanggilan || me?.user.nama;
  return (
    <>
      <PageHeader
        title={`Assalamu'alaikum${nama ? `, ${nama}` : ""}`}
        subtitle={formatTanggal(new Date())}
      />
      {config.data?.dataContoh && (
        <p
          role="status"
          className="mb-4 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn"
        >
          Aplikasi ini berisi DATA CONTOH untuk uji coba, bukan data santri sungguhan.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <section className="rounded-card bg-primary p-5 text-on-primary shadow-soft dark:bg-soft dark:text-on-soft md:p-6 lg:col-span-7">
          <h2 className="text-xl font-bold">Selamat datang di {config.data?.nama ?? "TARBIYAH"}</h2>
          <p className="mt-2 max-w-prose opacity-90">
            Sistem informasi sekolah, pondok pesantren, dan madrasah: presensi, akademik, keuangan,
            dan informasi dalam satu aplikasi.
          </p>
        </section>
        {me && !isPureWali(me) && <KartuPresensiStaf />}
        {me && me.relasi.anak.length > 0 && <KartuKehadiranAnak />}
        {me && me.relasi.anak.length > 0 && <KartuTagihanAnak />}
        {(hasPermission(me, "keuangan.lihat") || hasPermission(me, "keuangan.kelola")) && (
          <RingkasanKeuangan />
        )}
        {me && (me.relasi.pengajaran.length > 0 || me.relasi.anak.length > 0) && (
          <KartuTugasAktif />
        )}
        {me && <KartuAgenda />}
        {me && <KartuPengumuman />}
        {hasPermission(me, "presensi.lihat_semua") && <KartuRekapUnit />}
        {me?.isAdmin && <KartuBackup />}
        {me?.isAdmin && <SystemStatus />}
      </div>
    </>
  );
}
