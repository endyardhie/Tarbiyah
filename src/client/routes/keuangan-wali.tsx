import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, QrCode, Receipt } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { formatRupiah, labelPeriode, METODE_LABEL, type TagihanRow } from "../../shared/keuangan";
import { Card, EmptyState } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { formatTanggal, formatWaktu } from "../lib/format";
import { Button } from "../ui/Button";
import { ErrorAlert } from "../ui/Field";
import { Modal } from "../ui/Modal";

type Anak = { id: string; nama: string; nis: string; tagihan: TagihanRow[] };
type DataAnak = { online: boolean; anak: Anak[]; menunggu: string[] };
type Intent = {
  id: string;
  status: "menunggu" | "lunas" | "kedaluwarsa" | "batal" | "selisih";
  total: number;
  jumlahBayar: number | null;
  qris: string | null;
  kedaluwarsaAt: string | null;
  bulan: string[];
};

export const useTagihanAnak = () =>
  useQuery({ queryKey: ["keuangan", "anak"], queryFn: () => api<DataAnak>("/keuangan/anak") });

const tglDate = (t: string) => new Date(`${t}T00:00:00Z`);

export function StatusTagihan({ status }: { status: TagihanRow["status"] }) {
  const cls = {
    belum: "bg-warn-soft text-warn",
    lunas: "bg-soft text-on-soft",
    batal: "bg-surface-muted text-text2",
  }[status];
  return (
    <span className={`rounded-full px-3 py-1 text-sm font-semibold ${cls}`}>
      {{ belum: "Belum lunas", lunas: "Lunas", batal: "Dibatalkan" }[status]}
    </span>
  );
}

/** Wali: centang beberapa bulan → Bayar → QRIS; status lunas otomatis lewat webhook. */
export function TagihanWali() {
  const data = useTagihanAnak();
  const [pilih, setPilih] = useState<Set<string>>(new Set());
  const [intentId, setIntentId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const semua = useMemo(() => data.data?.anak.flatMap((a) => a.tagihan) ?? [], [data.data]);
  const total = semua.filter((t) => pilih.has(t.id)).reduce((a, t) => a + t.total, 0);

  const bayar = useMutation({
    mutationFn: () => api<Intent>("/keuangan/bayar", { body: { tagihanIds: [...pilih] } }),
    onSuccess: (i) => {
      setIntentId(i.id);
      setError("");
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (data.isPending) {
    return <div className="h-48 animate-pulse rounded-card bg-surface-muted" aria-busy="true" />;
  }
  if (data.isError) return <ErrorAlert>{errorMessage(data.error)}</ErrorAlert>;
  const { online, anak, menunggu } = data.data;
  if (!anak.length) {
    return (
      <EmptyState icon={Receipt} title="Belum ada data anak">
        Akun Anda belum terhubung dengan data santri. Hubungi admin sekolah.
      </EmptyState>
    );
  }
  const toggle = (id: string) =>
    setPilih((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-4 pb-24 md:pb-0">
      {!online && (
        <p className="rounded-2xl bg-info-soft px-4 py-3 text-sm font-medium text-info">
          Pembayaran online belum tersedia. Silakan bayar langsung ke bendahara sekolah.
        </p>
      )}
      {menunggu[0] && (
        <Card className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-semibold">
            <Clock size={20} className="text-warn" /> Ada pembayaran QRIS yang menunggu
          </p>
          <Button variant="secondary" onClick={() => setIntentId(menunggu[0] ?? null)}>
            <QrCode size={18} /> Lihat QRIS
          </Button>
        </Card>
      )}
      {anak.map((a) => {
        const belum = a.tagihan.filter((t) => t.status === "belum");
        const lunas = a.tagihan.filter((t) => t.status === "lunas").slice(0, 6);
        return (
          <Card key={a.id}>
            <h2 className="text-lg font-semibold">{a.nama}</h2>
            <p className="mb-3 text-sm text-text2">NIS {a.nis}</p>
            {belum.length === 0 ? (
              <p className="flex items-center gap-2 rounded-2xl bg-soft px-4 py-3 font-medium text-on-soft">
                <CheckCircle2 size={20} /> Semua tagihan sudah lunas.
              </p>
            ) : (
              <ul className="space-y-2">
                {belum.map((t) => (
                  <li key={t.id}>
                    <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-border bg-surface-raised px-4 py-2 has-[:checked]:border-primary has-[:checked]:bg-soft has-[:disabled]:cursor-default">
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-[var(--primary)]"
                        checked={pilih.has(t.id)}
                        disabled={!online}
                        onChange={() => toggle(t.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">SPP {labelPeriode(t.periode)}</span>
                        <span className="block text-sm text-text2">
                          Jatuh tempo{" "}
                          {formatTanggal(tglDate(t.jatuhTempo), "UTC").replace(/^\w+, /, "")}
                          {t.potongan > 0 && ` · potongan ${formatRupiah(t.potongan)}`}
                        </span>
                      </span>
                      <span className="font-bold tabular-nums">{formatRupiah(t.total)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {lunas.length > 0 && (
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer content-center font-semibold text-text2">
                  Riwayat lunas
                </summary>
                <ul className="mt-1 divide-y divide-border">
                  {lunas.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>
                        SPP {labelPeriode(t.periode)}
                        {t.pembayaran && (
                          <span className="block text-text2">
                            {METODE_LABEL[t.pembayaran.metode]} ·{" "}
                            {formatWaktu(t.pembayaran.dibayarAt)}
                          </span>
                        )}
                      </span>
                      <span className="font-semibold tabular-nums">{formatRupiah(t.total)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </Card>
        );
      })}
      <ErrorAlert>{error}</ErrorAlert>
      {pilih.size > 0 && (
        <div className="fixed inset-x-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-30 md:sticky md:inset-x-auto md:bottom-6 md:flex md:justify-end">
          <Button
            className="w-full shadow-soft md:w-auto"
            loading={bayar.isPending}
            onClick={() => bayar.mutate()}
          >
            Bayar {pilih.size} bulan · {formatRupiah(total)}
          </Button>
        </div>
      )}
      {intentId && (
        <QrisModal
          intentId={intentId}
          onClose={() => {
            setIntentId(null);
            setPilih(new Set());
            queryClient.invalidateQueries({ queryKey: ["keuangan"] });
          }}
        />
      )}
    </div>
  );
}

function QrisModal({ intentId, onClose }: { intentId: string; onClose: () => void }) {
  const [img, setImg] = useState("");
  const [error, setError] = useState("");
  const intent = useQuery({
    queryKey: ["keuangan", "intent", intentId],
    queryFn: () => api<Intent>(`/keuangan/intent/${intentId}`),
    // Status lunas datang dari webhook; layar cukup bertanya berkala selama menunggu.
    refetchInterval: (q) => (q.state.data?.status === "menunggu" ? 5000 : false),
  });
  const cek = useMutation({
    mutationFn: () => api<Intent>(`/keuangan/intent/${intentId}/cek`, { method: "POST" }),
    onSuccess: (d) => queryClient.setQueryData(["keuangan", "intent", intentId], d),
    onError: (e) => setError(errorMessage(e)),
  });
  const qris = intent.data?.qris;
  useEffect(() => {
    if (!qris) return setImg("");
    QRCode.toDataURL(qris, { margin: 2, width: 320, errorCorrectionLevel: "M" })
      .then(setImg)
      .catch(() => setError("QRIS gagal ditampilkan"));
  }, [qris]);
  const d = intent.data;

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Bayar dengan QRIS">
      {!d ? (
        <div className="mx-auto size-64 animate-pulse rounded-3xl bg-surface-muted" />
      ) : d.status === "lunas" ? (
        <div className="py-6 text-center">
          <CheckCircle2 size={56} className="mx-auto text-primary" />
          <p className="mt-3 text-lg font-bold">Pembayaran diterima</p>
          <p className="text-text2">Bukti bayar dikirim ke WhatsApp wali. Terima kasih.</p>
          <Button className="mt-5 w-full" onClick={onClose}>
            Selesai
          </Button>
        </div>
      ) : d.status !== "menunggu" ? (
        <div className="py-4 text-center">
          <p className="font-semibold">
            {d.status === "selisih"
              ? "Nominal yang diterima tidak sesuai. Bendahara akan memeriksa pembayaran Anda."
              : "QRIS ini sudah kedaluwarsa atau dibatalkan. Silakan buat pembayaran baru."}
          </p>
          <Button className="mt-5 w-full" variant="secondary" onClick={onClose}>
            Tutup
          </Button>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-text2">{d.bulan.join(", ")}</p>
          <div className="mx-auto w-fit rounded-3xl bg-white p-3">
            {img ? (
              <img src={img} alt="Kode QRIS pembayaran" className="size-64" />
            ) : (
              <div className="size-64 animate-pulse rounded-2xl bg-gray-100" />
            )}
          </div>
          <div>
            <p className="text-sm text-text2">Bayar tepat</p>
            <p className="text-3xl font-bold tabular-nums">
              {formatRupiah(d.jumlahBayar ?? d.total)}
            </p>
            {d.jumlahBayar && d.jumlahBayar !== d.total && (
              <p className="text-sm text-text2">
                Termasuk kode unik {formatRupiah(d.jumlahBayar - d.total)} agar pembayaran dikenali.
              </p>
            )}
            {d.kedaluwarsaAt && (
              <p className="mt-1 text-sm text-text2">
                Berlaku sampai {formatWaktu(d.kedaluwarsaAt)}
              </p>
            )}
          </div>
          <p className="text-sm text-text2">
            Scan dengan aplikasi bank atau dompet digital. Halaman ini otomatis berubah setelah
            pembayaran masuk.
          </p>
          <ErrorAlert>{error}</ErrorAlert>
          <Button
            variant="secondary"
            className="w-full"
            loading={cek.isPending}
            onClick={() => cek.mutate()}
          >
            Saya sudah bayar, cek status
          </Button>
        </div>
      )}
    </Modal>
  );
}
