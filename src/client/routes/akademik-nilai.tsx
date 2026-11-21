import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, ChevronLeft, ClipboardList, Lock, Plus, Save } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { JENIS, JENIS_LABEL, type Jenis } from "../../shared/akademik";
import { ListSkeleton } from "../components/MasterList";
import { EmptyState } from "../components/Page";
import type { Ajar, Penilaian, Semester } from "../lib/akademik";
import { api, errorMessage, queryClient } from "../lib/api";
import { formatTanggal, formatWaktu } from "../lib/format";
import { tglDate, useHariIni } from "../lib/presensi";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, Input, inputBase, inputClass } from "../ui/Field";
import { Modal } from "../ui/Modal";

type GridRow = {
  pendaftaranId: string;
  nama: string;
  namaPanggilan: string | null;
  noAbsen: number | null;
  nilai: number | null;
  terkunci: boolean;
};
type GridData = {
  penilaian: Penilaian & { mapelNama: string; kelasNama: string };
  bisaUbah: boolean;
  santri: GridRow[];
};

function PenilaianForm({ ajar, onDone }: { ajar: Ajar; onDone: () => void }) {
  const hari = useHariIni();
  const [jenis, setJenis] = useState<Jenis>("UH");
  const [judul, setJudul] = useState("");
  const [pilihTanggal, setTanggal] = useState("");
  // "Hari ini" dari server bisa datang setelah form terbuka; pakai selama belum dipilih.
  const tanggal = pilihTanggal || hari.data?.tanggal || "";
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => api("/penilaian", { body: { pengajaranId: ajar.id, jenis, judul, tanggal } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["penilaian"] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError("");
        save.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Jenis">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={jenis}
            onChange={(e) => setJenis(e.target.value as Jenis)}
          >
            {JENIS.map((j) => (
              <option key={j} value={j}>
                {JENIS_LABEL[j]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Judul">
        {(id) => (
          <Input
            id={id}
            value={judul}
            placeholder="Ulangan Harian 1"
            onChange={(e) => setJudul(e.target.value)}
            required
            maxLength={100}
          />
        )}
      </Field>
      <Field label="Tanggal">
        {(id) => (
          <Input
            id={id}
            type="date"
            value={tanggal}
            onChange={(e) => setTanggal(e.target.value)}
            required
          />
        )}
      </Field>
      <ErrorAlert>{error}</ErrorAlert>
      <Button type="submit" loading={save.isPending}>
        Buat penilaian
      </Button>
    </form>
  );
}

/** Grid nilai: Enter/↓ ke baris berikut, ↑ ke baris sebelumnya. */
function NilaiGrid({ penilaianId, onBack }: { penilaianId: string; onBack: () => void }) {
  const q = useQuery({
    queryKey: ["penilaian", "nilai", penilaianId],
    queryFn: () => api<GridData>(`/penilaian/${penilaianId}/nilai`),
  });
  const [vals, setVals] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (q.data && !dirty)
      setVals(
        Object.fromEntries(
          q.data.santri.map((s) => [s.pendaftaranId, s.nilai == null ? "" : String(s.nilai)]),
        ),
      );
  }, [q.data, dirty]);
  const invalid = Object.values(vals).some(
    (v) => v !== "" && (Number.isNaN(Number(v)) || Number(v) < 0 || Number(v) > 100),
  );
  const save = useMutation({
    mutationFn: () =>
      api(`/penilaian/${penilaianId}/nilai`, {
        method: "PUT",
        body: {
          items: (q.data?.santri ?? [])
            .filter((s) => !s.terkunci)
            .map((s) => ({
              pendaftaranId: s.pendaftaranId,
              nilai: vals[s.pendaftaranId] === "" ? null : Number(vals[s.pendaftaranId]),
            })),
        },
      }),
    onSuccess: async () => {
      setDirty(false);
      setMsg("Nilai tersimpan.");
      await queryClient.invalidateQueries({ queryKey: ["penilaian"] });
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  const kirim = useMutation({
    mutationFn: () =>
      api<{ penerima: number }>(`/penilaian/${penilaianId}/notifikasi`, { method: "POST" }),
    onSuccess: async (r) => {
      setMsg(`Notifikasi terkirim ke ${r.penerima} wali.`);
      await queryClient.invalidateQueries({ queryKey: ["penilaian"] });
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  const move = (i: number, d: number) => inputs.current[i + d]?.focus();

  if (q.isPending) return <ListSkeleton rows={6} />;
  if (q.isError) return <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>;
  const d = q.data;
  return (
    <div className="space-y-3">
      <Button variant="ghost" onClick={onBack}>
        <ChevronLeft size={18} /> Semua penilaian
      </Button>
      <div>
        <p className="font-semibold">
          {d.penilaian.judul} · {JENIS_LABEL[d.penilaian.jenis]}
        </p>
        <p className="text-sm text-text2">
          {d.penilaian.mapelNama} · {d.penilaian.kelasNama} ·{" "}
          {formatTanggal(tglDate(d.penilaian.tanggal), "UTC")}
        </p>
      </div>
      <ol className="space-y-1.5 pb-28 md:pb-4">
        {d.santri.map((s, i) => (
          <li
            key={s.pendaftaranId}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2"
          >
            <span className="w-6 shrink-0 text-right text-sm text-text2 tabular-nums">
              {s.noAbsen ?? i + 1}
            </span>
            <label htmlFor={`n-${s.pendaftaranId}`} className="min-w-0 flex-1 truncate font-medium">
              {s.nama}
            </label>
            {s.terkunci && <Lock size={16} className="text-text2" aria-label="Rapor final" />}
            <input
              id={`n-${s.pendaftaranId}`}
              ref={(el) => {
                inputs.current[i] = el;
              }}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.5"
              disabled={!d.bisaUbah || s.terkunci}
              value={vals[s.pendaftaranId] ?? ""}
              onChange={(e) => {
                setVals((v) => ({ ...v, [s.pendaftaranId]: e.target.value }));
                setDirty(true);
                setMsg("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "ArrowDown") {
                  e.preventDefault();
                  move(i, 1);
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  move(i, -1);
                }
              }}
              className={`${inputBase} w-24 shrink-0 text-center tabular-nums`}
            />
          </li>
        ))}
      </ol>
      {invalid && <ErrorAlert>Nilai harus 0–100.</ErrorAlert>}
      {msg && (
        <p role="status" className="rounded-2xl bg-surface-muted px-4 py-3 text-sm">
          {msg}
        </p>
      )}
      {d.bisaUbah && (
        <div className="fixed inset-x-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-30 flex gap-2 md:sticky md:inset-x-auto md:bottom-6 md:justify-end">
          {!dirty && d.santri.some((s) => s.nilai != null) && (
            <Button
              variant="secondary"
              className="shadow-soft"
              loading={kirim.isPending}
              onClick={() => kirim.mutate()}
            >
              <BellRing size={18} />{" "}
              {d.penilaian.dinotifikasiAt ? "Kirim ulang" : "Kirim notifikasi"}
            </Button>
          )}
          <Button
            className="flex-1 shadow-soft md:flex-none md:px-8"
            disabled={invalid || !dirty}
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            <Save size={18} /> Simpan nilai
          </Button>
        </div>
      )}
    </div>
  );
}

export function NilaiTab({ ajar }: { ajar: Ajar }) {
  const q = useQuery({
    queryKey: ["penilaian", ajar.id],
    queryFn: () =>
      api<{ semester: Semester; jumlahSantri: number; penilaian: Penilaian[] }>(
        `/penilaian?pengajaranId=${ajar.id}`,
      ),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (open) return <NilaiGrid penilaianId={open} onBack={() => setOpen(null)} />;
  return (
    <div className="space-y-3">
      {ajar.bisaIsi && (
        <Button onClick={() => setAdding(true)}>
          <Plus size={18} /> Penilaian baru
        </Button>
      )}
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>
      ) : q.data.penilaian.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Belum ada penilaian">
          PR, tugas, UH, UTS, UAS, atau praktik untuk semester {q.data.semester.nomor}.
        </EmptyState>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {q.data.penilaian.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setOpen(p.id)}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-3 text-left hover:border-primary"
              >
                <p className="font-semibold">
                  {p.judul} <span className="font-normal text-text2">· {JENIS_LABEL[p.jenis]}</span>
                </p>
                <p className="text-sm text-text2">
                  {formatTanggal(tglDate(p.tanggal), "UTC")} · terisi {p.terisi}/
                  {q.data.jumlahSantri}
                  {p.rataRata != null && ` · rata-rata ${p.rataRata.toLocaleString("id-ID")}`}
                  {p.dinotifikasiAt && ` · notifikasi ${formatWaktu(p.dinotifikasiAt)}`}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} onOpenChange={setAdding} title="Penilaian baru">
        {adding && <PenilaianForm ajar={ajar} onDone={() => setAdding(false)} />}
      </Modal>
    </div>
  );
}
