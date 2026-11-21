import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import {
  BULAN,
  type PengaturanKeuangan,
  type PengaturanPembayaranView,
  type PengaturanWaView,
  TEMPLATE_BUKTI_PLACEHOLDER,
} from "../../shared/keuangan";
import { Card } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input, inputClass, Textarea } from "../ui/Field";

function Simpan({
  ok,
  error,
  loading,
  label,
}: {
  ok: boolean;
  error: string;
  loading: boolean;
  label: string;
}) {
  return (
    <>
      <ErrorAlert>{error}</ErrorAlert>
      {ok && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium text-on-soft">
          Tersimpan.
        </p>
      )}
      <Button type="submit" loading={loading}>
        {label}
      </Button>
    </>
  );
}

/** Form pengaturan generik: muat → ubah → PUT. Secret dikirim hanya bila diisi. */
function useSettingForm<V, B>(path: string, toBody: (v: V) => B) {
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const save = useMutation({
    mutationFn: (v: V) => api(`/pengaturan/${path}`, { method: "PUT", body: toBody(v) }),
    onSuccess: () => {
      setOk(true);
      queryClient.invalidateQueries({ queryKey: ["pengaturan", path] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = (v: V) => (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setOk(false);
    save.mutate(v);
  };
  return { error, ok, loading: save.isPending, submit };
}

function Loader<T>({ path, children }: { path: string; children: (d: T) => ReactNode }) {
  const q = useQuery({
    queryKey: ["pengaturan", path],
    queryFn: () => api<T>(`/pengaturan/${path}`),
  });
  if (q.isError) return <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>;
  if (!q.data) return <div className="h-32 animate-pulse rounded-2xl bg-surface-muted" />;
  return <>{children(q.data)}</>;
}

const secretHint = (terisi: boolean) =>
  terisi ? "Sudah tersimpan. Kosongkan bila tidak ingin mengganti." : "Belum diisi.";

function KeuanganForm({ data }: { data: PengaturanKeuangan }) {
  const [v, setV] = useState(data);
  const f = useSettingForm("keuangan", (x: PengaturanKeuangan) => x);
  return (
    <form onSubmit={f.submit(v)} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Bulan yang ditagih</legend>
        <div className="grid grid-cols-2 gap-x-2 sm:grid-cols-3">
          {BULAN.map((b, i) => (
            <Checkbox
              key={b}
              label={b}
              checked={v.bulanDitagih.includes(i + 1)}
              onChange={(e) =>
                setV({
                  ...v,
                  bulanDitagih: e.target.checked
                    ? [...v.bulanDitagih, i + 1].sort((a, c) => a - c)
                    : v.bulanDitagih.filter((m) => m !== i + 1),
                })
              }
            />
          ))}
        </div>
      </fieldset>
      <Field label="Tanggal jatuh tempo" hint="Tanggal 1–28 pada bulan tagihan.">
        {(id) => (
          <Input
            id={id}
            type="number"
            min={1}
            max={28}
            value={v.tanggalJatuhTempo}
            onChange={(e) => setV({ ...v, tanggalJatuhTempo: Number(e.target.value) })}
          />
        )}
      </Field>
      <Field
        label="Template pesan bukti bayar (WhatsApp)"
        hint={`Placeholder: ${TEMPLATE_BUKTI_PLACEHOLDER.map((p) => `{{${p}}}`).join(" ")}`}
      >
        {(id) => (
          <Textarea
            id={id}
            rows={9}
            value={v.templateBukti}
            onChange={(e) => setV({ ...v, templateBukti: e.target.value })}
          />
        )}
      </Field>
      <Simpan {...f} label="Simpan pengaturan keuangan" />
    </form>
  );
}

function WaForm({ data }: { data: PengaturanWaView }) {
  const [v, setV] = useState({ ...data, password: "" });
  const f = useSettingForm("wa", (x: typeof v) => x);
  const [cek, setCek] = useState<{ ok: boolean; pesan: string } | null>(null);
  const tes = useMutation({
    mutationFn: () => api<{ ok: boolean; pesan: string }>("/pengaturan/wa/cek", { method: "POST" }),
    onSuccess: setCek,
    onError: (e) => setCek({ ok: false, pesan: errorMessage(e) }),
  });
  return (
    <form onSubmit={f.submit(v)} className="space-y-4">
      <Checkbox
        label="Aktifkan WA gateway"
        description="Nonaktif: pesan tetap tercatat di antrean dengan status “dilewati”."
        checked={v.aktif}
        onChange={(e) => setV({ ...v, aktif: e.target.checked })}
      />
      <Field
        label="URL GOWA (jaringan internal)"
        hint="Mis. http://gowa:3000 — jangan dibuka ke internet."
      >
        {(id) => (
          <Input
            id={id}
            autoComplete="off"
            value={v.url}
            onChange={(e) => setV({ ...v, url: e.target.value })}
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="User basic auth">
          {(id) => (
            <Input
              id={id}
              autoComplete="off"
              value={v.user}
              onChange={(e) => setV({ ...v, user: e.target.value })}
            />
          )}
        </Field>
        <Field label="Password basic auth" hint={secretHint(data.password.terisi)}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={v.password}
              onChange={(e) => setV({ ...v, password: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Device ID (opsional)" hint="Diisi bila GOWA memegang lebih dari satu nomor.">
          {(id) => (
            <Input
              id={id}
              value={v.deviceId}
              onChange={(e) => setV({ ...v, deviceId: e.target.value })}
            />
          )}
        </Field>
        <Field label="Jeda antar-pesan (detik)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={120}
              value={v.jedaDetik}
              onChange={(e) => setV({ ...v, jedaDetik: Number(e.target.value) })}
            />
          )}
        </Field>
      </div>
      <Simpan {...f} label="Simpan WA gateway" />
      <Button
        variant="secondary"
        className="ml-2"
        loading={tes.isPending}
        onClick={() => tes.mutate()}
      >
        Cek koneksi
      </Button>
      {cek && (
        <p
          role="status"
          className={`rounded-2xl px-4 py-3 text-sm font-medium ${cek.ok ? "bg-soft text-on-soft" : "bg-warn-soft text-warn"}`}
        >
          {cek.pesan}
        </p>
      )}
    </form>
  );
}

function PembayaranForm({ data }: { data: PengaturanPembayaranView }) {
  const [v, setV] = useState({ ...data, apiKey: "", webhookSecret: "" });
  const f = useSettingForm("pembayaran", (x: typeof v) => x);
  return (
    <form onSubmit={f.submit(v)} className="space-y-4">
      <Checkbox
        label="Aktifkan pembayaran online (QRIS)"
        description="Nonaktif: wali hanya bisa membayar ke bendahara."
        checked={v.aktif}
        onChange={(e) => setV({ ...v, aktif: e.target.checked })}
      />
      <Field label="Provider">
        {(id) => (
          <select id={id} className={inputClass} value={v.provider} disabled>
            <option value="noken-pay">noken-pay</option>
          </select>
        )}
      </Field>
      <Field label="URL provider (jaringan internal)" hint="Mis. http://noken-pay:3000">
        {(id) => (
          <Input
            id={id}
            autoComplete="off"
            value={v.url}
            onChange={(e) => setV({ ...v, url: e.target.value })}
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="API key" hint={secretHint(data.apiKey.terisi)}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={v.apiKey}
              onChange={(e) => setV({ ...v, apiKey: e.target.value })}
            />
          )}
        </Field>
        <Field label="Secret webhook" hint={secretHint(data.webhookSecret.terisi)}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={v.webhookSecret}
              onChange={(e) => setV({ ...v, webhookSecret: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field
        label="URL webhook (opsional)"
        hint="Alamat yang dipanggil provider. Kosong = APP_URL/api/webhooks/noken-pay. Bisa diisi alamat internal, mis. http://tarbiyah:3000/api/webhooks/noken-pay."
      >
        {(id) => (
          <Input
            id={id}
            value={v.urlWebhook}
            onChange={(e) => setV({ ...v, urlWebhook: e.target.value })}
          />
        )}
      </Field>
      <Field label="Masa berlaku QRIS (menit)">
        {(id) => (
          <Input
            id={id}
            type="number"
            min={5}
            max={120}
            value={v.kedaluwarsaMenit}
            onChange={(e) => setV({ ...v, kedaluwarsaMenit: Number(e.target.value) })}
          />
        )}
      </Field>
      <Simpan {...f} label="Simpan payment gateway" />
    </form>
  );
}

function PersetujuanForm({ data }: { data: { teks: string } }) {
  const [teks, setTeks] = useState(data.teks);
  const f = useSettingForm("persetujuan", (x: { teks: string }) => x);
  return (
    <form onSubmit={f.submit({ teks })} className="space-y-4">
      <Field
        label="Teks persetujuan pemrosesan data"
        hint="Ditampilkan kepada wali santri saat pertama kali masuk. Mengubah teks tidak meminta ulang persetujuan yang sudah diberikan."
      >
        {(id) => (
          <Textarea id={id} rows={10} value={teks} onChange={(e) => setTeks(e.target.value)} />
        )}
      </Field>
      <Simpan {...f} label="Simpan teks persetujuan" />
    </form>
  );
}

export function PengaturanKeuanganCards() {
  return (
    <>
      <Card className="lg:col-span-12">
        <h2 className="mb-4 text-lg font-semibold">Tagihan SPP</h2>
        <Loader<PengaturanKeuangan> path="keuangan">{(d) => <KeuanganForm data={d} />}</Loader>
      </Card>
      <Card className="lg:col-span-6">
        <h2 className="mb-4 text-lg font-semibold">WA gateway (GOWA)</h2>
        <Loader<PengaturanWaView> path="wa">{(d) => <WaForm data={d} />}</Loader>
      </Card>
      <Card className="lg:col-span-6">
        <h2 className="mb-4 text-lg font-semibold">Payment gateway</h2>
        <Loader<PengaturanPembayaranView> path="pembayaran">
          {(d) => <PembayaranForm data={d} />}
        </Loader>
      </Card>
      <Card className="lg:col-span-12">
        <h2 className="mb-4 text-lg font-semibold">Persetujuan data wali santri</h2>
        <Loader<{ teks: string }> path="persetujuan">{(d) => <PersetujuanForm data={d} />}</Loader>
      </Card>
    </>
  );
}
