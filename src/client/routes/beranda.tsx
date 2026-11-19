import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, XCircle } from "lucide-react";
import { Card, PageHeader } from "../components/Page";
import { useMe } from "../lib/auth";
import { formatTanggal } from "../lib/format";
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
        {me?.isAdmin && <SystemStatus />}
      </div>
    </>
  );
}
