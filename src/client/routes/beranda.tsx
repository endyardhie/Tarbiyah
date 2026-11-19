import { useQuery as useQ, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, CheckCircle2, XCircle } from "lucide-react";
import { Card, PageHeader } from "../components/Page";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatTanggal } from "../lib/format";
import { isPureWali } from "../lib/nav";
import { useHariIni } from "../lib/presensi";
import { usePublicConfig } from "../lib/sekolah";

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
            Sistem informasi sekolah, pondok pesantren, dan madrasah. Fitur presensi, akademik,
            keuangan, dan informasi akan muncul di sini secara bertahap.
          </p>
        </section>
        {me && !isPureWali(me) && <KartuPresensiStaf />}
        {me && me.relasi.anak.length > 0 && <KartuKehadiranAnak />}
        {me?.isAdmin && <SystemStatus />}
      </div>
    </>
  );
}
