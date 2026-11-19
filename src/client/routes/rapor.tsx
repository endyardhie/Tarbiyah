import { useMutation, useQuery } from "@tanstack/react-query";
import { Lock, Printer, Save, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import type { Skala } from "../../shared/akademik";
import { ListSkeleton } from "../components/MasterList";
import type { Ajar, Semester } from "../lib/akademik";
import { api, errorMessage, queryClient } from "../lib/api";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, inputBase, inputClass, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { Badge } from "./sekolah";

type MapelRow = {
  pendaftaranId: string;
  nama: string;
  noAbsen: number | null;
  nilaiOtomatis: number | null;
  nilaiAkhir: number | null;
  manual: boolean;
  predikat: string | null;
  deskripsi: string;
  deskripsiManual: boolean;
  final: boolean;
};

export function RaporMapelTab({ ajar }: { ajar: Ajar }) {
  const q = useQuery({
    queryKey: ["rapor", "mapel", ajar.id],
    queryFn: () =>
      api<{ semester: Semester; santri: MapelRow[] }>(`/rapor/mapel?pengajaranId=${ajar.id}`),
  });
  const [edit, setEdit] = useState<Record<string, { nilai: string; deskripsi: string }>>({});
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (q.data) {
      setEdit(
        Object.fromEntries(
          q.data.santri.map((s) => [
            s.pendaftaranId,
            {
              nilai: s.manual && s.nilaiAkhir != null ? String(s.nilaiAkhir) : "",
              deskripsi: s.deskripsiManual ? s.deskripsi : "",
            },
          ]),
        ),
      );
    }
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api("/rapor/mapel", {
        method: "PUT",
        body: {
          pengajaranId: ajar.id,
          semesterId: q.data?.semester.id,
          items: (q.data?.santri ?? [])
            .filter((s) => !s.final)
            .map((s) => ({
              pendaftaranId: s.pendaftaranId,
              nilaiAkhir: edit[s.pendaftaranId]?.nilai
                ? Number(edit[s.pendaftaranId]?.nilai)
                : null,
              deskripsi: edit[s.pendaftaranId]?.deskripsi || null,
            })),
        },
      }),
    onSuccess: async () => {
      setMsg("Nilai rapor tersimpan.");
      await queryClient.invalidateQueries({ queryKey: ["rapor"] });
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-text2">
        Semester {q.data.semester.nomor}. Nilai otomatis = rata-rata berbobot nilai harian/UTS/UAS.
        Isi "Nilai akhir" hanya bila ingin mengubahnya (tercatat di log); kosongkan untuk memakai
        nilai otomatis.
      </p>
      <ul className="space-y-2 pb-28 md:pb-4">
        {q.data.santri.map((s) => (
          <li
            key={s.pendaftaranId}
            className="space-y-2 rounded-2xl border border-border bg-surface p-3"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <p className="min-w-[8rem] flex-1 font-semibold">{s.nama}</p>
              {s.final && (
                <Badge>
                  <Lock size={12} className="inline" /> Final
                </Badge>
              )}
              <span className="text-sm text-text2">
                Otomatis <strong className="text-text">{s.nilaiOtomatis ?? "—"}</strong>
              </span>
              <input
                aria-label={`Nilai akhir ${s.nama}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                placeholder={s.nilaiOtomatis == null ? "—" : String(s.nilaiOtomatis)}
                disabled={!ajar.bisaIsi || s.final}
                value={edit[s.pendaftaranId]?.nilai ?? ""}
                onChange={(e) =>
                  setEdit((x) => ({
                    ...x,
                    [s.pendaftaranId]: {
                      nilai: e.target.value,
                      deskripsi: x[s.pendaftaranId]?.deskripsi ?? "",
                    },
                  }))
                }
                className={`${inputBase} w-24 text-center`}
              />
              <Badge tone={s.predikat === "D" ? "warn" : "soft"}>{s.predikat ?? "—"}</Badge>
            </div>
            <textarea
              aria-label={`Deskripsi ${s.nama}`}
              rows={2}
              placeholder={s.deskripsi || "Deskripsi otomatis dari predikat"}
              disabled={!ajar.bisaIsi || s.final}
              value={edit[s.pendaftaranId]?.deskripsi ?? ""}
              onChange={(e) =>
                setEdit((x) => ({
                  ...x,
                  [s.pendaftaranId]: {
                    nilai: x[s.pendaftaranId]?.nilai ?? "",
                    deskripsi: e.target.value,
                  },
                }))
              }
              className={`${inputClass} py-2 text-sm`}
            />
          </li>
        ))}
      </ul>
      {msg && (
        <p role="status" className="rounded-2xl bg-surface-muted px-4 py-3 text-sm">
          {msg}
        </p>
      )}
      {ajar.bisaIsi && (
        <div className="fixed inset-x-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-30 md:sticky md:inset-x-auto md:bottom-6 md:flex md:justify-end">
          <Button
            className="w-full shadow-soft md:w-auto md:px-8"
            loading={save.isPending}
            onClick={() => save.mutate()}
          >
            <Save size={18} /> Simpan nilai rapor
          </Button>
        </div>
      )}
    </div>
  );
}

type KelasRow = {
  pendaftaranId: string;
  nama: string;
  status: "draft" | "final";
  catatanWali: string;
  keputusan: "naik" | "tinggal" | null;
  aspek: Record<string, string | null>;
  absensi?: { sakit: number; izin: number; alpa: number };
};
type KelasData = {
  semester: Semester;
  jumlahMapel: number;
  aspek: { id: string; kelompok: string; nama: string; tipe: "predikat" | "angka" | "teks" }[];
  skala: Skala[];
  bisaIsi: boolean;
  bisaKunci: boolean;
  santri: KelasRow[];
};

function RaporSantriForm({ d, row, onDone }: { d: KelasData; row: KelasRow; onDone: () => void }) {
  const [aspek, setAspek] = useState<Record<string, string>>(
    Object.fromEntries(d.aspek.map((a) => [a.id, row.aspek[a.id] ?? ""])),
  );
  const [catatan, setCatatan] = useState(row.catatanWali);
  const [keputusan, setKeputusan] = useState(row.keputusan ?? "");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/rapor/kelas/${row.pendaftaranId}`, {
        method: "PUT",
        body: {
          semesterId: d.semester.id,
          aspek: d.aspek.map((a) => ({ aspekId: a.id, nilai: aspek[a.id] || null })),
          catatanWali: catatan,
          keputusan: keputusan || null,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["rapor"] });
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <div className="space-y-4">
      {d.aspek.length === 0 && (
        <p className="text-sm text-text2">
          Belum ada aspek rapor untuk unit ini (diatur admin di Pengaturan akademik).
        </p>
      )}
      {d.aspek.map((a) => (
        <Field key={a.id} label={`${a.kelompok} · ${a.nama}`}>
          {(id) =>
            a.tipe === "predikat" ? (
              <select
                id={id}
                className={inputClass}
                value={aspek[a.id]}
                onChange={(e) => setAspek((x) => ({ ...x, [a.id]: e.target.value }))}
              >
                <option value="">—</option>
                {d.skala.map((s) => (
                  <option key={s.predikat}>{s.predikat}</option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                className={inputClass}
                type={a.tipe === "angka" ? "number" : "text"}
                value={aspek[a.id]}
                onChange={(e) => setAspek((x) => ({ ...x, [a.id]: e.target.value }))}
              />
            )
          }
        </Field>
      ))}
      <Field label="Catatan wali kelas">
        {(id) => (
          <Textarea
            id={id}
            rows={3}
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            maxLength={1000}
          />
        )}
      </Field>
      {d.semester.nomor === 2 && (
        <Field label="Keputusan">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={keputusan}
              onChange={(e) => setKeputusan(e.target.value)}
            >
              <option value="">Belum ditentukan</option>
              <option value="naik">Naik kelas</option>
              <option value="tinggal">Tinggal kelas</option>
            </select>
          )}
        </Field>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      <Button loading={save.isPending} onClick={() => save.mutate()}>
        Simpan
      </Button>
    </div>
  );
}

export function RaporKelasTab({ kelasId }: { kelasId: string }) {
  const q = useQuery({
    queryKey: ["rapor", "kelas", kelasId],
    queryFn: () => api<KelasData>(`/rapor/kelas?kelasId=${kelasId}`),
  });
  const [open, setOpen] = useState<KelasRow | null>(null);
  const [msg, setMsg] = useState("");
  const aksi = useMutation({
    mutationFn: ({ path, ids }: { path: "kunci" | "buka"; ids?: string[] }) =>
      api(`/rapor/${path}`, {
        body: { kelasId, semesterId: q.data?.semester.id, pendaftaranIds: ids },
      }),
    onSuccess: async (_r, v) => {
      setMsg(
        v.path === "kunci"
          ? "Rapor dikunci (final). Wali santri sekarang bisa melihatnya."
          : "Kunci rapor dibuka (draft).",
      );
      await queryClient.invalidateQueries({ queryKey: ["rapor"] });
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  const cetak = (pendaftaranId?: string) =>
    window.open(
      `/cetak/rapor?${pendaftaranId ? `pendaftaranId=${pendaftaranId}` : `kelasId=${kelasId}`}&semesterId=${q.data?.semester.id}`,
      "_blank",
      "noopener",
    );
  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>;
  const d = q.data;
  const draft = d.santri.filter((s) => s.status !== "final").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => cetak()}>
          <Printer size={18} /> Cetak satu kelas
        </Button>
        {d.bisaKunci && draft > 0 && (
          <Button
            onClick={() =>
              confirm(
                `Kunci ${draft} rapor? Setelah final, wali santri bisa melihatnya dan nilai tidak bisa diubah.`,
              ) && aksi.mutate({ path: "kunci" })
            }
          >
            <Lock size={18} /> Kunci semua ({draft})
          </Button>
        )}
      </div>
      <p className="text-sm text-text2">
        Semester {d.semester.nomor} · {d.jumlahMapel} mapel · draft {draft} dari {d.santri.length}
      </p>
      {msg && (
        <p role="status" className="rounded-2xl bg-surface-muted px-4 py-3 text-sm">
          {msg}
        </p>
      )}
      <ul className="grid gap-2 md:grid-cols-2">
        {d.santri.map((s) => (
          <li
            key={s.pendaftaranId}
            className="space-y-2 rounded-2xl border border-border bg-surface p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="min-w-0 truncate font-semibold">{s.nama}</p>
              {s.status === "final" ? <Badge tone="soft">Final</Badge> : <Badge>Draft</Badge>}
            </div>
            <p className="text-sm text-text2">
              Sakit {s.absensi?.sakit ?? 0} · Izin {s.absensi?.izin ?? 0} · Alpa{" "}
              {s.absensi?.alpa ?? 0}
              {s.catatanWali ? " · ada catatan" : " · belum ada catatan"}
            </p>
            <div className="flex flex-wrap gap-2">
              {d.bisaIsi && s.status !== "final" && (
                <Button variant="secondary" onClick={() => setOpen(s)}>
                  Isi aspek & catatan
                </Button>
              )}
              <Button variant="ghost" onClick={() => cetak(s.pendaftaranId)}>
                <Printer size={16} /> Cetak
              </Button>
              {d.bisaKunci && s.status === "final" && (
                <Button
                  variant="ghost"
                  onClick={() => aksi.mutate({ path: "buka", ids: [s.pendaftaranId] })}
                >
                  <Unlock size={16} /> Buka kunci
                </Button>
              )}
              {d.bisaKunci && s.status !== "final" && (
                <Button
                  variant="ghost"
                  onClick={() => aksi.mutate({ path: "kunci", ids: [s.pendaftaranId] })}
                >
                  <Lock size={16} /> Kunci
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Modal
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.nama ?? ""}
      >
        {open && <RaporSantriForm d={d} row={open} onDone={() => setOpen(null)} />}
      </Modal>
    </div>
  );
}
