import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FilePlus2, Printer, Receipt, RotateCcw, Send, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { formatRupiah, labelPeriode, METODE_LABEL, type TagihanRow } from "../../shared/keuangan";
import { Card, EmptyState, PageHeader, TabBar } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatTanggal, formatWaktu, hariIniSekolah } from "../lib/format";
import { kelasLabel, useKelas, useLokasi, useUnits } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, Input, inputBase, inputClass } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { StatusTagihan, TagihanWali } from "./keuangan-wali";

type Tab = "tagihan" | "tarif" | "laporan" | "wa" | "anak";
const TAB_LABEL: Record<Tab, string> = {
  tagihan: "Tagihan",
  tarif: "Tarif & potongan",
  laporan: "Laporan",
  wa: "Antrean WA",
  anak: "Tagihan anak",
};

export function KeuanganPage() {
  const { data: me } = useMe();
  const staf =
    hasPermission(me, "keuangan.lihat") ||
    hasPermission(me, "keuangan.kelola") ||
    hasPermission(me, "keuangan.catat_manual");
  const punyaAnak = !!me?.relasi.anak.length;
  const tabs: Tab[] = [
    ...(staf ? (["tagihan", "tarif", "laporan", "wa"] as Tab[]) : []),
    ...(punyaAnak ? (["anak"] as Tab[]) : []),
  ];
  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab ?? tabs[0];
  return (
    <>
      <PageHeader
        title={staf ? "Keuangan" : "Tagihan"}
        subtitle={staf ? "Tagihan SPP, pembayaran, dan laporan." : "Tagihan SPP dan pembayaran."}
      />
      {!active ? (
        <EmptyState icon={Receipt} title="Tidak ada tagihan">
          Menu ini untuk bendahara dan wali santri.
        </EmptyState>
      ) : (
        <>
          {tabs.length > 1 && (
            <TabBar tabs={tabs} value={active} onChange={setTab} label={(t) => TAB_LABEL[t]} />
          )}
          {active === "tagihan" && <TagihanStaf />}
          {active === "tarif" && <TarifTab />}
          {active === "laporan" && <LaporanTab />}
          {active === "wa" && <WaTab />}
          {active === "anak" && <TagihanWali />}
        </>
      )}
    </>
  );
}

const select = `${inputBase} w-full sm:w-auto`;

function TagihanStaf() {
  const { data: me } = useMe();
  const kelola = hasPermission(me, "keuangan.kelola");
  const catat = kelola || hasPermission(me, "keuangan.catat_manual");
  const [f, setF] = useState({
    periode: hariIniSekolah().slice(0, 7),
    status: "",
    lokasiId: "",
    unitId: "",
    kelasId: "",
    q: "",
  });
  const lokasi = useLokasi();
  const units = useUnits();
  const kelas = useKelas();
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const list = useQuery({
    queryKey: ["keuangan", "tagihan", qs],
    queryFn: () => api<TagihanRow[]>(`/keuangan/tagihan?${qs}`),
  });
  const [buat, setBuat] = useState(false);
  const [bayar, setBayar] = useState<TagihanRow | null>(null);
  const [batal, setBatal] = useState<TagihanRow | null>(null);
  const [info, setInfo] = useState("");
  const kirim = useMutation({
    mutationFn: (pembayaranId: string) =>
      api<{ pesan: number }>(`/keuangan/pembayaran/${pembayaranId}/kirim-bukti`, {
        method: "POST",
      }),
    onSuccess: (r) => {
      setInfo(`Bukti bayar masuk antrean WA (${r.pesan} nomor).`);
      queryClient.invalidateQueries({ queryKey: ["keuangan"] });
    },
    onError: (e) => setInfo(errorMessage(e)),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const rows = list.data ?? [];
  const sum = (s?: string) =>
    rows
      .filter((r) => (s ? r.status === s : r.status !== "batal"))
      .reduce((a, r) => a + r.total, 0);

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <input
            type="month"
            aria-label="Periode"
            className={select}
            value={f.periode}
            onChange={(e) => set("periode")(e.target.value)}
          />
          <select
            aria-label="Status"
            className={select}
            value={f.status}
            onChange={(e) => set("status")(e.target.value)}
          >
            <option value="">Semua status</option>
            <option value="belum">Belum lunas</option>
            <option value="lunas">Lunas</option>
            <option value="batal">Dibatalkan</option>
          </select>
          <select
            aria-label="Lokasi"
            className={select}
            value={f.lokasiId}
            onChange={(e) => set("lokasiId")(e.target.value)}
          >
            <option value="">Semua lokasi</option>
            {lokasi.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nama}
              </option>
            ))}
          </select>
          <select
            aria-label="Unit"
            className={select}
            value={f.unitId}
            onChange={(e) => set("unitId")(e.target.value)}
          >
            <option value="">Semua unit</option>
            {units.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.kode}
              </option>
            ))}
          </select>
          <select
            aria-label="Kelas"
            className={select}
            value={f.kelasId}
            onChange={(e) => set("kelasId")(e.target.value)}
          >
            <option value="">Semua kelas</option>
            {kelas.data?.map((k) => (
              <option key={k.id} value={k.id}>
                {kelasLabel(k)}
              </option>
            ))}
          </select>
          <input
            type="search"
            aria-label="Cari santri"
            placeholder="Cari nama / NIS"
            className={`${inputBase} w-full sm:w-56`}
            value={f.q}
            onChange={(e) => set("q")(e.target.value)}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {kelola && (
            <Button onClick={() => setBuat(true)}>
              <FilePlus2 size={18} /> Buat tagihan
            </Button>
          )}
          <a
            href={`/api/keuangan/ekspor.csv?${qs}`}
            download
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-raised px-5 font-semibold hover:bg-surface-muted"
          >
            <Download size={18} /> CSV
          </a>
        </div>
      </Card>

      {info && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium text-on-soft">
          {info}
        </p>
      )}
      {list.isError && <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>}
      {list.isPending ? (
        <div className="h-40 animate-pulse rounded-card bg-surface-muted" aria-busy="true" />
      ) : rows.length === 0 ? (
        <EmptyState icon={Receipt} title="Tidak ada tagihan">
          Belum ada tagihan untuk filter ini.{kelola && " Tekan “Buat tagihan” untuk membuatnya."}
        </EmptyState>
      ) : (
        <Card className="p-0 md:p-0">
          <p className="border-b border-border px-5 py-3 text-sm text-text2">
            {rows.length} tagihan · total {formatRupiah(sum())} · lunas {formatRupiah(sum("lunas"))}{" "}
            · belum {formatRupiah(sum("belum"))}
          </p>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-5 py-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {r.santriNama} <span className="font-normal text-text2">· {r.nis}</span>
                  </p>
                  <p className="text-sm text-text2">
                    {r.kelasNama} · {r.unitKode} {r.lokasiNama} · SPP {labelPeriode(r.periode)}
                    {r.potongan > 0 && ` · potongan ${formatRupiah(r.potongan)}`}
                  </p>
                  {r.pembayaran && (
                    <p className="text-sm text-text2">
                      {METODE_LABEL[r.pembayaran.metode]} · {formatWaktu(r.pembayaran.dibayarAt)}
                      {r.pembayaran.buktiWaDikirimAt && " · bukti WA dikirim"}
                    </p>
                  )}
                  {r.alasanBatal && <p className="text-sm text-text2">Alasan: {r.alasanBatal}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold tabular-nums">{formatRupiah(r.total)}</span>
                  <StatusTagihan status={r.status} />
                  {r.status === "belum" && catat && (
                    <Button variant="secondary" onClick={() => setBayar(r)}>
                      Catat bayar
                    </Button>
                  )}
                  {r.status === "belum" && kelola && (
                    <Button variant="ghost" onClick={() => setBatal(r)}>
                      Batalkan
                    </Button>
                  )}
                  {r.status === "lunas" && r.pembayaran && catat && (
                    <Button
                      variant="secondary"
                      loading={kirim.isPending && kirim.variables === r.pembayaran.id}
                      onClick={() => r.pembayaran && kirim.mutate(r.pembayaran.id)}
                    >
                      <Send size={16} />{" "}
                      {r.pembayaran.buktiWaDikirimAt ? "Kirim ulang bukti" : "Kirim bukti WA"}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {buat && <BuatTagihanModal periodeAwal={f.periode} onClose={() => setBuat(false)} />}
      {bayar && <BayarManualModal tagihan={bayar} onClose={() => setBayar(null)} />}
      {batal && <BatalModal tagihan={batal} onClose={() => setBatal(null)} />}
    </div>
  );
}

type Pratinjau = {
  periode: string;
  ditagih: boolean;
  tahunAjaran: { nama: string } | null;
  jatuhTempo: string;
  items: {
    santriId: string;
    nama: string;
    kelasNama: string;
    unitKode: string;
    total: number;
    status: string;
  }[];
};
const STATUS_CALON: Record<string, string> = {
  baru: "Akan dibuat",
  sudah: "Sudah ada",
  tanpa_tarif: "Tarif belum diatur",
  bebas: "Bebas (potongan 100%)",
};

function BuatTagihanModal({ periodeAwal, onClose }: { periodeAwal: string; onClose: () => void }) {
  const [periode, setPeriode] = useState(periodeAwal);
  const [error, setError] = useState("");
  const pra = useQuery({
    queryKey: ["keuangan", "pratinjau", periode],
    queryFn: () => api<Pratinjau>(`/keuangan/tagihan/pratinjau?periode=${periode}`),
    enabled: /^\d{4}-\d{2}$/.test(periode),
  });
  const simpan = useMutation({
    mutationFn: () => api<{ dibuat: number }>("/keuangan/tagihan/buat", { body: { periode } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keuangan"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const d = pra.data;
  const baru = d?.items.filter((i) => i.status === "baru") ?? [];
  const hitung = (s: string) => d?.items.filter((i) => i.status === s).length ?? 0;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Buat tagihan SPP">
      <div className="space-y-4">
        <Field label="Periode">
          {(id) => (
            <Input
              id={id}
              type="month"
              value={periode}
              onChange={(e) => setPeriode(e.target.value)}
            />
          )}
        </Field>
        {pra.isPending ? (
          <div className="h-24 animate-pulse rounded-2xl bg-surface-muted" />
        ) : pra.isError ? (
          <ErrorAlert>{errorMessage(pra.error)}</ErrorAlert>
        ) : !d?.tahunAjaran ? (
          <ErrorAlert>Tidak ada tahun ajaran yang mencakup periode ini.</ErrorAlert>
        ) : (
          <>
            {!d.ditagih && (
              <ErrorAlert>
                {labelPeriode(periode)} tidak termasuk bulan yang ditagih (Pengaturan).
              </ErrorAlert>
            )}
            <ul className="grid grid-cols-2 gap-2 text-sm">
              {Object.keys(STATUS_CALON).map((s) => (
                <li key={s} className="rounded-2xl bg-surface-muted px-3 py-2">
                  <span className="block text-text2">{STATUS_CALON[s]}</span>
                  <span className="text-lg font-bold">{hitung(s)}</span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-text2">
              Tahun ajaran {d.tahunAjaran.nama} · jatuh tempo {d.jatuhTempo} · total baru{" "}
              {formatRupiah(baru.reduce((a, i) => a + i.total, 0))}
            </p>
            {hitung("tanpa_tarif") > 0 && (
              <p className="text-sm text-warn">
                Santri tanpa tarif tidak ditagih. Atur tarif unit + lokasinya di tab Tarif.
              </p>
            )}
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-2xl border border-border text-sm">
              {d.items.map((i) => (
                <li key={i.santriId} className="flex justify-between gap-2 px-3 py-2">
                  <span>
                    {i.nama}{" "}
                    <span className="text-text2">
                      · {i.kelasNama} {i.unitKode}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {i.status === "baru" ? formatRupiah(i.total) : STATUS_CALON[i.status]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <ErrorAlert>{error}</ErrorAlert>
        <Button
          className="w-full"
          disabled={!d?.ditagih || baru.length === 0}
          loading={simpan.isPending}
          onClick={() => simpan.mutate()}
        >
          Buat {baru.length} tagihan
        </Button>
      </div>
    </Modal>
  );
}

function BayarManualModal({ tagihan, onClose }: { tagihan: TagihanRow; onClose: () => void }) {
  const [metode, setMetode] = useState<"tunai" | "transfer">("tunai");
  const [catatan, setCatatan] = useState("");
  const [error, setError] = useState("");
  const simpan = useMutation({
    mutationFn: () => api(`/keuangan/tagihan/${tagihan.id}/bayar`, { body: { metode, catatan } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keuangan"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    simpan.mutate();
  }
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Catat pembayaran">
      <form onSubmit={submit} className="space-y-4">
        <p>
          <strong>{tagihan.santriNama}</strong> · SPP {labelPeriode(tagihan.periode)}
          <span className="block text-2xl font-bold tabular-nums">
            {formatRupiah(tagihan.total)}
          </span>
        </p>
        <div className="flex gap-2" role="radiogroup" aria-label="Metode">
          {(["tunai", "transfer"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metode === m}
              onClick={() => setMetode(m)}
              className="min-h-11 flex-1 rounded-full border border-border font-semibold aria-checked:border-transparent aria-checked:bg-soft aria-checked:text-on-soft"
            >
              {METODE_LABEL[m]}
            </button>
          ))}
        </div>
        <Field label="Catatan (opsional)">
          {(id) => (
            <Input
              id={id}
              value={catatan}
              maxLength={200}
              onChange={(e) => setCatatan(e.target.value)}
            />
          )}
        </Field>
        <p className="text-sm text-text2">
          Bukti WA tidak dikirim otomatis — tekan “Kirim bukti WA” setelah tersimpan.
        </p>
        <ErrorAlert>{error}</ErrorAlert>
        <Button type="submit" className="w-full" loading={simpan.isPending}>
          Simpan pembayaran
        </Button>
      </form>
    </Modal>
  );
}

function BatalModal({ tagihan, onClose }: { tagihan: TagihanRow; onClose: () => void }) {
  const [alasan, setAlasan] = useState("");
  const [error, setError] = useState("");
  const simpan = useMutation({
    mutationFn: () => api(`/keuangan/tagihan/${tagihan.id}/batal`, { body: { alasan } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["keuangan"] });
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Batalkan tagihan">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          simpan.mutate();
        }}
        className="space-y-4"
      >
        <p>
          {tagihan.santriNama} · SPP {labelPeriode(tagihan.periode)} · {formatRupiah(tagihan.total)}
        </p>
        <Field label="Alasan pembatalan">
          {(id) => (
            <Input
              id={id}
              value={alasan}
              minLength={3}
              maxLength={200}
              onChange={(e) => setAlasan(e.target.value)}
              required
            />
          )}
        </Field>
        <ErrorAlert>{error}</ErrorAlert>
        <Button type="submit" variant="danger" className="w-full" loading={simpan.isPending}>
          Batalkan tagihan
        </Button>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ tarif & potongan

type TarifData = {
  tahunAjaran: { id: string; nama: string } | null;
  units: { id: string; kode: string; nama: string }[];
  lokasi: { id: string; nama: string }[];
  tarif: { unitId: string; lokasiId: string; nominal: number }[];
};
type Potongan = {
  id: string;
  santriId: string;
  santriNama: string;
  nis: string;
  jenis: "nominal" | "persen";
  nilai: number;
  alasan: string;
};

function TarifCell({
  unitId,
  lokasiId,
  nominal,
  disabled,
}: {
  unitId: string;
  lokasiId: string;
  nominal?: number;
  disabled: boolean;
}) {
  const [v, setV] = useState(nominal === undefined ? "" : String(nominal));
  const [msg, setMsg] = useState("");
  const simpan = useMutation({
    mutationFn: () =>
      api("/keuangan/tarif", { method: "PUT", body: { unitId, lokasiId, nominal: Number(v) } }),
    onSuccess: () => {
      setMsg("Tersimpan");
      queryClient.invalidateQueries({ queryKey: ["keuangan"] });
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg("");
        simpan.mutate();
      }}
    >
      <span className="text-text2">Rp</span>
      <input
        aria-label="Nominal SPP"
        inputMode="numeric"
        className={`${inputBase} w-36`}
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value.replace(/\D/g, ""))}
        required
      />
      {!disabled && (
        <Button
          type="submit"
          variant="secondary"
          loading={simpan.isPending}
          disabled={v === String(nominal ?? "")}
        >
          Simpan
        </Button>
      )}
      {msg && (
        <span className="text-sm text-text2" role="status">
          {msg}
        </span>
      )}
    </form>
  );
}

function TarifTab() {
  const { data: me } = useMe();
  const kelola = hasPermission(me, "keuangan.kelola");
  const data = useQuery({
    queryKey: ["keuangan", "tarif"],
    queryFn: () => api<TarifData>("/keuangan/tarif"),
  });
  const pot = useQuery({
    queryKey: ["keuangan", "potongan"],
    queryFn: () => api<Potongan[]>("/keuangan/potongan"),
  });
  const hapus = useMutation({
    mutationFn: (id: string) => api(`/keuangan/potongan/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keuangan", "potongan"] }),
  });
  if (data.isPending) return <div className="h-40 animate-pulse rounded-card bg-surface-muted" />;
  if (data.isError) return <ErrorAlert>{errorMessage(data.error)}</ErrorAlert>;
  const d = data.data;
  if (!d.tahunAjaran) {
    return (
      <EmptyState icon={Receipt} title="Belum ada tahun ajaran aktif">
        Aktifkan tahun ajaran di Data Sekolah terlebih dahulu.
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="text-lg font-semibold">Tarif SPP {d.tahunAjaran.nama}</h2>
        <p className="mb-3 text-sm text-text2">Per unit dan lokasi, per bulan.</p>
        <ul className="space-y-3">
          {d.units.flatMap((u) =>
            d.lokasi.map((l) => (
              <li key={`${u.id}-${l.id}`} className="space-y-1">
                <p className="font-semibold">
                  {u.kode} · {l.nama}
                </p>
                <TarifCell
                  unitId={u.id}
                  lokasiId={l.id}
                  nominal={d.tarif.find((t) => t.unitId === u.id && t.lokasiId === l.id)?.nominal}
                  disabled={!kelola}
                />
              </li>
            )),
          )}
        </ul>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Potongan / beasiswa</h2>
        <p className="mb-3 text-sm text-text2">
          Berlaku untuk tagihan yang dibuat setelah disimpan.
        </p>
        {kelola && <PotonganForm />}
        {pot.isError && <ErrorAlert>{errorMessage(pot.error)}</ErrorAlert>}
        <ul className="mt-3 divide-y divide-border">
          {pot.data?.map((p) => (
            <li key={p.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{p.santriNama}</span>
                <span className="block text-sm text-text2">
                  {p.jenis === "persen" ? `${p.nilai}%` : formatRupiah(p.nilai)} · {p.alasan}
                </span>
              </span>
              {kelola && (
                <button
                  type="button"
                  aria-label={`Hapus potongan ${p.santriNama}`}
                  className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
                  onClick={() => confirm(`Hapus potongan ${p.santriNama}?`) && hapus.mutate(p.id)}
                >
                  <Trash2 size={18} />
                </button>
              )}
            </li>
          ))}
          {pot.data?.length === 0 && <li className="py-2 text-text2">Belum ada potongan.</li>}
        </ul>
      </Card>
    </div>
  );
}

function PotonganForm() {
  const santri = useQuery({
    queryKey: ["keuangan", "santri"],
    queryFn: () =>
      api<{ id: string; nis: string; nama: string; kelasNama: string; unitKode: string }[]>(
        "/keuangan/santri",
      ),
  });
  const [f, setF] = useState({
    santriId: "",
    jenis: "persen" as "persen" | "nominal",
    nilai: "",
    alasan: "",
  });
  const [error, setError] = useState("");
  const simpan = useMutation({
    mutationFn: () =>
      api("/keuangan/potongan", { method: "PUT", body: { ...f, nilai: Number(f.nilai) } }),
    onSuccess: () => {
      setF({ santriId: "", jenis: "persen", nilai: "", alasan: "" });
      setError("");
      queryClient.invalidateQueries({ queryKey: ["keuangan", "potongan"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <form
      className="space-y-3 rounded-2xl bg-surface-muted p-3"
      onSubmit={(e) => {
        e.preventDefault();
        simpan.mutate();
      }}
    >
      <select
        aria-label="Santri"
        className={inputClass}
        value={f.santriId}
        onChange={(e) => setF({ ...f, santriId: e.target.value })}
        required
      >
        <option value="">Pilih santri…</option>
        {santri.data?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.nama} · {s.kelasNama} {s.unitKode}
          </option>
        ))}
      </select>
      <div className="flex gap-2">
        <select
          aria-label="Jenis potongan"
          className={`${inputBase} w-32`}
          value={f.jenis}
          onChange={(e) => setF({ ...f, jenis: e.target.value as "persen" | "nominal" })}
        >
          <option value="persen">Persen</option>
          <option value="nominal">Rupiah</option>
        </select>
        <input
          aria-label="Nilai potongan"
          inputMode="numeric"
          placeholder={f.jenis === "persen" ? "50" : "50000"}
          className={`${inputBase} min-w-0 flex-1`}
          value={f.nilai}
          onChange={(e) => setF({ ...f, nilai: e.target.value.replace(/\D/g, "") })}
          required
        />
      </div>
      <Input
        aria-label="Alasan"
        placeholder="Alasan (mis. yatim, anak guru)"
        value={f.alasan}
        onChange={(e) => setF({ ...f, alasan: e.target.value })}
        required
      />
      <ErrorAlert>{error}</ErrorAlert>
      <Button type="submit" loading={simpan.isPending}>
        Simpan potongan
      </Button>
    </form>
  );
}

// ------------------------------------------------------------------ laporan

export type LaporanKeuangan = {
  dari: string;
  sampai: string;
  hariIni: string;
  perMetode: { metode: keyof typeof METODE_LABEL; n: number; jumlah: number }[];
  pembayaran: {
    id: string;
    dibayarAt: string;
    santriNama: string;
    nis: string;
    periode: string;
    jumlah: number;
    metode: keyof typeof METODE_LABEL;
    dicatatOleh: string | null;
  }[];
  tunggakan: {
    santriId: string;
    santriNama: string;
    nis: string;
    kelasNama: string;
    unitKode: string;
    lokasiNama: string;
    bulan: number;
    jumlah: number;
    periode: string[];
  }[];
};

function LaporanTab() {
  const today = hariIniSekolah();
  const [dari, setDari] = useState(`${today.slice(0, 7)}-01`);
  const [sampai, setSampai] = useState(today);
  const qs = `dari=${dari}&sampai=${sampai}`;
  const lap = useQuery({
    queryKey: ["keuangan", "laporan", qs],
    queryFn: () => api<LaporanKeuangan>(`/keuangan/laporan?${qs}`),
    enabled: !!dari && !!sampai,
  });
  const d = lap.data;
  const total = d?.perMetode.reduce((a, m) => a + m.jumlah, 0) ?? 0;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3">
        <Field label="Dari">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputBase}
              value={dari}
              onChange={(e) => setDari(e.target.value)}
            />
          )}
        </Field>
        <Field label="Sampai">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputBase}
              value={sampai}
              onChange={(e) => setSampai(e.target.value)}
            />
          )}
        </Field>
        <Button
          variant="secondary"
          disabled={!d}
          onClick={() => window.open(`/cetak/keuangan?${qs}`, "_blank", "noopener")}
        >
          <Printer size={18} /> Cetak / PDF
        </Button>
      </Card>
      {lap.isError && <ErrorAlert>{errorMessage(lap.error)}</ErrorAlert>}
      {!d ? (
        <div className="h-40 animate-pulse rounded-card bg-surface-muted" />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <p className="text-sm text-text2">Total penerimaan</p>
              <p className="text-xl font-bold tabular-nums">{formatRupiah(total)}</p>
            </Card>
            {d.perMetode.map((m) => (
              <Card key={m.metode}>
                <p className="text-sm text-text2">
                  {METODE_LABEL[m.metode]} · {m.n} transaksi
                </p>
                <p className="text-xl font-bold tabular-nums">{formatRupiah(m.jumlah)}</p>
              </Card>
            ))}
          </div>
          <Card>
            <h2 className="mb-2 text-lg font-semibold">
              Tunggakan per {formatTanggal(new Date(`${d.hariIni}T00:00:00Z`), "UTC")}
            </h2>
            {d.tunggakan.length === 0 ? (
              <p className="text-text2">Tidak ada tunggakan lewat jatuh tempo.</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.tunggakan.map((t) => (
                  <li key={t.santriId} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-semibold">{t.santriNama}</span>
                      <span className="block text-sm text-text2">
                        {t.kelasNama} · {t.unitKode} {t.lokasiNama} ·{" "}
                        {t.periode.map(labelPeriode).join(", ")}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold tabular-nums">
                      {formatRupiah(t.jumlah)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h2 className="mb-2 text-lg font-semibold">Pembayaran masuk</h2>
            {d.pembayaran.length === 0 ? (
              <p className="text-text2">Belum ada pembayaran pada rentang ini.</p>
            ) : (
              <ul className="divide-y divide-border">
                {d.pembayaran.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block font-semibold">{p.santriNama}</span>
                      <span className="block text-sm text-text2">
                        SPP {labelPeriode(p.periode)} · {METODE_LABEL[p.metode]} ·{" "}
                        {formatWaktu(p.dibayarAt)}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold tabular-nums">
                      {formatRupiah(p.jumlah)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ antrean WA

type WaRow = {
  id: string;
  nomor: string;
  pesan: string;
  status: "antri" | "terkirim" | "gagal" | "dilewati";
  percobaan: number;
  error: string | null;
  dibuatAt: string;
  terkirimAt: string | null;
};
const WA_STATUS: Record<WaRow["status"], { label: string; cls: string }> = {
  antri: { label: "Antre", cls: "bg-info-soft text-info" },
  terkirim: { label: "Terkirim", cls: "bg-soft text-on-soft" },
  gagal: { label: "Gagal", cls: "bg-danger-soft text-danger" },
  dilewati: { label: "Dilewati", cls: "bg-surface-muted text-text2" },
};

function WaTab() {
  const { data: me } = useMe();
  const catat = hasPermission(me, "keuangan.kelola") || hasPermission(me, "keuangan.catat_manual");
  const [status, setStatus] = useState("");
  const list = useQuery({
    queryKey: ["keuangan", "wa", status],
    queryFn: () => api<WaRow[]>(`/keuangan/wa${status ? `?status=${status}` : ""}`),
    refetchInterval: 15_000,
  });
  const ulang = useMutation({
    mutationFn: (id: string) => api(`/keuangan/wa/${id}/kirim-ulang`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["keuangan", "wa"] }),
  });
  return (
    <div className="space-y-4">
      <select
        aria-label="Status pesan"
        className={select}
        value={status}
        onChange={(e) => setStatus(e.target.value)}
      >
        <option value="">Semua status</option>
        {Object.entries(WA_STATUS).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </select>
      {list.isError && <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>}
      {ulang.isError && <ErrorAlert>{errorMessage(ulang.error)}</ErrorAlert>}
      {list.data?.length === 0 ? (
        <EmptyState icon={Send} title="Belum ada pesan">
          Bukti bayar yang dikirim lewat WhatsApp tampil di sini.
        </EmptyState>
      ) : (
        <Card className="p-0 md:p-0">
          <ul className="divide-y divide-border">
            {list.data?.map((w) => (
              <li key={w.id} className="space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{w.nomor}</span>
                  <span
                    className={`rounded-full px-3 py-1 text-sm font-semibold ${WA_STATUS[w.status].cls}`}
                  >
                    {WA_STATUS[w.status].label}
                  </span>
                  <span className="text-sm text-text2">
                    {formatWaktu(w.terkirimAt ?? w.dibuatAt)}
                  </span>
                  {catat && (w.status === "gagal" || w.status === "dilewati") && (
                    <Button
                      variant="secondary"
                      className="ml-auto"
                      onClick={() => ulang.mutate(w.id)}
                    >
                      <RotateCcw size={16} /> Kirim ulang
                    </Button>
                  )}
                </div>
                <p className="line-clamp-2 whitespace-pre-line text-sm text-text2">{w.pesan}</p>
                {w.error && <p className="text-sm text-danger">{w.error}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
