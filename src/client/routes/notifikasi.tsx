import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bell, BellOff, BellRing, CheckCheck, Smartphone } from "lucide-react";
import { useState } from "react";
import { ListSkeleton } from "../components/MasterList";
import { Card, EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { formatWaktu } from "../lib/format";
import { disablePush, enablePush, usePushState } from "../lib/push";
import { Button } from "../ui/Button";
import { ErrorAlert } from "../ui/Field";

type Notif = {
  id: string;
  jenis: string;
  judul: string;
  isi: string;
  url: string | null;
  dibacaAt: string | null;
  dibuatAt: string;
  pengirimNama: string | null;
};

const refresh = () => queryClient.invalidateQueries({ queryKey: ["notifikasi"] });

function AktifkanBanner() {
  const state = usePushState();
  if (!state.data || state.data === "aktif" || state.data === "tidak-didukung") return null;
  return (
    <Link
      to="/notifikasi/aktifkan"
      className="mb-4 flex items-center gap-3 rounded-2xl bg-info-soft px-4 py-3 font-medium text-info"
    >
      <BellRing size={20} className="shrink-0" />
      Aktifkan notifikasi di perangkat ini agar tidak ketinggalan pengumuman.
    </Link>
  );
}

export function NotifikasiPage() {
  const [filter, setFilter] = useState<"belum" | "semua">("belum");
  const navigate = useNavigate();
  const list = useQuery({
    queryKey: ["notifikasi", filter],
    queryFn: () => api<Notif[]>(`/notifikasi${filter === "belum" ? "?status=belum" : ""}`),
  });
  const bacaSemua = useMutation({
    mutationFn: () => api("/notifikasi/baca-semua", { method: "POST" }),
    onSuccess: refresh,
  });
  async function open(n: Notif) {
    if (!n.dibacaAt) await api(`/notifikasi/${n.id}/baca`, { method: "POST" }).catch(() => {});
    await refresh();
    if (n.url?.startsWith("/")) {
      const [path, hash] = n.url.split("#");
      navigate({ to: path as "/", hash });
    }
  }

  return (
    <>
      <PageHeader title="Notifikasi" subtitle="Pemberitahuan dari sekolah dan sistem." />
      <AktifkanBanner />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["belum", "semua"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className="min-h-11 rounded-full border border-border px-4 font-semibold text-text2 aria-pressed:border-transparent aria-pressed:bg-soft aria-pressed:text-on-soft"
          >
            {f === "belum" ? "Belum dibaca" : "Semua"}
          </button>
        ))}
        <Button
          variant="ghost"
          className="ml-auto"
          loading={bacaSemua.isPending}
          onClick={() => bacaSemua.mutate()}
        >
          <CheckCheck size={18} /> Tandai semua dibaca
        </Button>
      </div>
      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
      ) : list.data.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={filter === "belum" ? "Tidak ada notifikasi baru" : "Belum ada notifikasi"}
        >
          Pemberitahuan dari sekolah akan muncul di sini.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {list.data.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => open(n)}
                className={`flex w-full gap-3 rounded-2xl border px-4 py-3 text-left transition-colors hover:border-primary ${
                  n.dibacaAt ? "border-border bg-surface" : "border-transparent bg-soft"
                }`}
              >
                <span
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${n.dibacaAt ? "bg-transparent" : "bg-primary"}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className={`block ${n.dibacaAt ? "font-medium" : "font-bold"}`}>
                    {n.judul}
                  </span>
                  <span className="line-clamp-2 block text-sm text-text2">{n.isi}</span>
                  <span className="mt-1 block text-xs text-text2">
                    {n.pengirimNama ?? "Sistem"} · {formatWaktu(n.dibuatAt)}
                    {!n.dibacaAt && <span className="sr-only"> · belum dibaca</span>}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function AktifkanNotifikasiPage() {
  const state = usePushState();
  const [msg, setMsg] = useState("");
  const done = () => queryClient.invalidateQueries({ queryKey: ["push-state"] });
  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: done,
    onError: (e) => setMsg(errorMessage(e)),
  });
  const disable = useMutation({ mutationFn: disablePush, onSuccess: done });
  const uji = useMutation({
    mutationFn: () => api("/push/uji", { method: "POST" }),
    onSuccess: () => {
      setMsg("Notifikasi uji dikirim. Seharusnya muncul dalam beberapa detik.");
      refresh();
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  const s = state.data;

  return (
    <>
      <PageHeader
        title="Aktifkan notifikasi"
        subtitle="Terima pemberitahuan PR, nilai, dan pengumuman di HP ini."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          {state.isPending ? (
            <ListSkeleton rows={2} />
          ) : s === "aktif" ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-primary">
                <BellRing /> Notifikasi aktif di perangkat ini
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" loading={uji.isPending} onClick={() => uji.mutate()}>
                  Kirim notifikasi uji
                </Button>
                <Button
                  variant="ghost"
                  loading={disable.isPending}
                  onClick={() => disable.mutate()}
                >
                  <BellOff size={18} /> Matikan
                </Button>
              </div>
            </>
          ) : s === "nonaktif" ? (
            <>
              <p>
                Browser akan menanyakan izin. Pilih <strong>Izinkan</strong>.
              </p>
              <Button loading={enable.isPending} onClick={() => enable.mutate()}>
                <Bell size={18} /> Aktifkan notifikasi
              </Button>
            </>
          ) : s === "ditolak" ? (
            <p>
              Izin notifikasi sudah ditolak. Buka pengaturan situs di browser (ikon gembok di
              samping alamat), ubah
              <strong> Notifikasi</strong> menjadi <strong>Izinkan</strong>, lalu muat ulang halaman
              ini.
            </p>
          ) : s === "perlu-install" ? (
            <p className="flex gap-2">
              <Smartphone className="shrink-0 text-primary" />
              Di iPhone/iPad, notifikasi hanya bisa diterima setelah aplikasi di-install ke layar
              utama (iOS 16.4 ke atas). Ikuti langkah di samping, lalu buka aplikasi dari ikon di
              layar utama dan kembali ke halaman ini.
            </p>
          ) : (
            <p>
              Browser ini tidak mendukung notifikasi. Pakai Chrome, Edge, Firefox, atau Safari versi
              terbaru.
            </p>
          )}
          {msg && (
            <p role="status" className="rounded-2xl bg-surface-muted px-4 py-3 text-sm">
              {msg}
            </p>
          )}
        </Card>
        <Card className="space-y-3 text-sm">
          <h2 className="text-base font-semibold">Untuk pengguna iPhone</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Buka aplikasi ini di <strong>Safari</strong>.
            </li>
            <li>
              Ketuk tombol <strong>Bagikan</strong> (kotak dengan panah ke atas).
            </li>
            <li>
              Pilih <strong>Tambah ke Layar Utama</strong>, lalu <strong>Tambah</strong>.
            </li>
            <li>
              Buka aplikasi dari ikon baru di layar utama, masuk, lalu buka halaman ini dan ketuk{" "}
              <strong>Aktifkan</strong>.
            </li>
          </ol>
          <p className="text-text2">
            Bila notifikasi tidak muncul di HP, semua pemberitahuan tetap tersimpan di halaman
            Notifikasi.
          </p>
        </Card>
      </div>
    </>
  );
}
