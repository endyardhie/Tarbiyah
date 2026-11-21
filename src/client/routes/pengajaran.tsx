import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Pengajaran } from "../../shared/types";
import { EntityForm } from "../components/EntityForm";
import { ListSkeleton } from "../components/MasterList";
import { EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import {
  HARI,
  hariOptions,
  kelasLabel,
  labelGuru,
  useGuru,
  useKelas,
  useMapel,
} from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, inputClass } from "../ui/Field";
import { Modal } from "../ui/Modal";

type Dialog =
  | { kind: "pengajaran"; item: Pengajaran | null }
  | { kind: "jadwal"; item: Pengajaran }
  | null;

export function PengajaranPage() {
  const { data: me } = useMe();
  const canEdit = hasPermission(me, "jadwal.kelola");
  const list = useQuery({
    queryKey: ["pengajaran"],
    queryFn: () => api<Pengajaran[]>("/pengajaran"),
  });
  const kelas = useKelas();
  const mapel = useMapel();
  const guruAll = useGuru(canEdit);
  const [mode, setMode] = useState<"kelas" | "guru">("kelas");
  const [kelasId, setKelasId] = useState("");
  const [guruId, setGuruId] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const invalidate = [["pengajaran"]];

  const remove = useMutation({
    mutationFn: ({ path }: { path: string }) => api(path, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pengajaran"] }),
  });

  // Pilihan guru dari data pengajaran sendiri (tanpa butuh izin daftar pengguna).
  const guruOptions = useMemo(() => {
    const m = new Map((list.data ?? []).map((p) => [p.guruId, p.guruNama]));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [list.data]);
  const selectedKelas = kelasId || kelas.data?.[0]?.id || "";
  const selectedGuru = guruId || guruOptions[0]?.[0] || "";
  const rows = (list.data ?? []).filter((p) =>
    mode === "kelas" ? p.kelasId === selectedKelas : p.guruId === selectedGuru,
  );
  const kelasNow = kelas.data?.find((k) => k.id === selectedKelas);

  // Tampilan per guru: slot jadwal diurutkan per hari.
  const slots = rows
    .flatMap((p) => p.jadwal.map((j) => ({ ...j, p })))
    .sort((a, b) => a.hari - b.hari || a.jamMulai.localeCompare(b.jamMulai));

  return (
    <>
      <PageHeader
        title="Pengajaran & jadwal"
        subtitle="Satu baris = satu guru mengajar satu mapel di satu kelas (tahun ajaran aktif)."
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex gap-2" role="group" aria-label="Tampilan">
          {(["kelas", "guru"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className="min-h-11 rounded-full border border-border px-4 font-semibold text-text2 aria-pressed:border-transparent aria-pressed:bg-soft aria-pressed:text-on-soft"
            >
              Per {m}
            </button>
          ))}
        </div>
        {mode === "kelas" ? (
          <select
            aria-label="Kelas"
            className={`${inputClass} sm:max-w-sm`}
            value={selectedKelas}
            onChange={(e) => setKelasId(e.target.value)}
          >
            {kelas.data?.map((k) => (
              <option key={k.id} value={k.id}>
                {kelasLabel(k)}
              </option>
            ))}
          </select>
        ) : (
          <select
            aria-label="Guru"
            className={`${inputClass} sm:max-w-sm`}
            value={selectedGuru}
            onChange={(e) => setGuruId(e.target.value)}
          >
            {guruOptions.map(([id, nama]) => (
              <option key={id} value={id}>
                {nama}
              </option>
            ))}
          </select>
        )}
        {canEdit && mode === "kelas" && selectedKelas && (
          <Button
            className="sm:ml-auto"
            onClick={() => setDialog({ kind: "pengajaran", item: null })}
          >
            <Plus size={18} /> Tambah mapel
          </Button>
        )}
      </div>
      <ErrorAlert>{remove.isError ? errorMessage(remove.error) : ""}</ErrorAlert>

      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
      ) : mode === "guru" ? (
        slots.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Belum ada jadwal">
            Guru ini belum punya jadwal mengajar.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {slots.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-border bg-surface px-4 py-3"
              >
                <span className="w-16 font-semibold">{HARI[s.hari]}</span>
                <span className="tabular-nums text-text2">
                  {s.jamMulai}–{s.jamSelesai}
                </span>
                <span className="font-medium">{s.p.mapelNama}</span>
                <span className="text-text2">{s.p.kelasNama}</span>
              </li>
            ))}
          </ul>
        )
      ) : rows.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Belum ada pengajaran">
          {kelasNow
            ? `Belum ada mapel untuk ${kelasNow.nama}.`
            : "Belum ada kelas di tahun ajaran aktif."}
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id} className="rounded-card border border-border bg-surface p-4 shadow-soft">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{p.mapelNama}</p>
                  <p className="text-sm text-text2">
                    {p.guruNama}
                    {p.kkm != null ? ` · KKM ${p.kkm}` : ""}
                  </p>
                </div>
                {p.mapelNamaArab && (
                  <p dir="rtl" lang="ar" className="shrink-0 text-lg">
                    {p.mapelNamaArab}
                  </p>
                )}
              </div>
              <ul className="mt-3 flex flex-wrap gap-2">
                {p.jadwal.map((j) => (
                  <li
                    key={j.id}
                    className="flex items-center rounded-full bg-surface-muted py-1 pr-1 pl-3 text-sm font-medium"
                  >
                    {HARI[j.hari]} {j.jamMulai}–{j.jamSelesai}
                    {canEdit && (
                      <button
                        type="button"
                        aria-label={`Hapus jadwal ${HARI[j.hari]} ${j.jamMulai}`}
                        className="ml-1 grid size-9 place-items-center rounded-full text-danger hover:bg-danger-soft"
                        onClick={() => remove.mutate({ path: `/jadwal/${j.id}` })}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                ))}
                {p.jadwal.length === 0 && <li className="text-sm text-text2">Belum ada jadwal</li>}
              </ul>
              {canEdit && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setDialog({ kind: "jadwal", item: p })}
                  >
                    <Plus size={16} /> Jadwal
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ kind: "pengajaran", item: p })}
                  >
                    Ubah
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={
          dialog?.kind === "jadwal"
            ? `Jadwal ${dialog.item.mapelNama}`
            : dialog?.item
              ? "Ubah pengajaran"
              : "Tambah mapel ke kelas"
        }
      >
        {dialog?.kind === "jadwal" && (
          <EntityForm
            endpoint="/jadwal"
            initial={{
              pengajaranId: dialog.item.id,
              hari: "1",
              jamMulai: "07:30",
              jamSelesai: "08:40",
            }}
            fields={[
              { name: "pengajaranId", label: "", type: "hidden" },
              { name: "hari", label: "Hari", type: "select", required: true, options: hariOptions },
              { name: "jamMulai", label: "Jam mulai", type: "time", required: true },
              { name: "jamSelesai", label: "Jam selesai", type: "time", required: true },
            ]}
            invalidate={invalidate}
            onDone={() => setDialog(null)}
          />
        )}
        {dialog?.kind === "pengajaran" && (
          <EntityForm
            key={dialog.item?.id ?? "baru"}
            endpoint="/pengajaran"
            id={dialog.item?.id}
            initial={dialog.item ?? { kelasId: selectedKelas, kkm: 70 }}
            fields={[
              { name: "kelasId", label: "", type: "hidden" },
              {
                name: "mapelId",
                label: "Mapel",
                type: "select",
                required: true,
                options: (mapel.data ?? [])
                  .filter((m) => m.aktif && (!m.unitId || m.unitId === kelasNow?.unitId))
                  .map((m) => ({ value: m.id, label: m.nama })),
              },
              {
                name: "guruId",
                label: "Guru pengajar",
                type: "select",
                required: true,
                options: guruAll.data?.map((g) => ({ value: g.id, label: labelGuru(g) })) ?? [],
              },
              { name: "kkm", label: "KKM", type: "number", hint: "0–100, opsional." },
            ]}
            invalidate={invalidate}
            onDone={() => setDialog(null)}
            extraAction={
              dialog.item ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    const item = dialog.item;
                    if (item && confirm(`Hapus ${item.mapelNama} dari kelas ini?`)) {
                      remove.mutate({ path: `/pengajaran/${item.id}` });
                      setDialog(null);
                    }
                  }}
                >
                  <Trash2 size={18} /> Hapus
                </Button>
              ) : undefined
            }
          />
        )}
      </Modal>
    </>
  );
}
