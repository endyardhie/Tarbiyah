import { Plus, Trash2 } from "lucide-react";
import { kelasLabel, useKelas, useLokasi, useUnits } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { inputBase, inputClass } from "../ui/Field";

export type Tipe = "semua" | "unit" | "lokasi" | "kelas";
export type SasaranDraft = { tipe: Tipe; id: string };
type Sasaran = { unitId: string | null; lokasiId: string | null; kelasId: string | null };

const LABEL: Record<Tipe, string> = {
  semua: "Seluruh sekolah",
  unit: "Unit",
  lokasi: "Lokasi",
  kelas: "Kelas",
};

export const fromSasaran = (list: Sasaran[]): SasaranDraft[] =>
  list.map((s) =>
    s.kelasId
      ? { tipe: "kelas", id: s.kelasId }
      : s.unitId
        ? { tipe: "unit", id: s.unitId }
        : s.lokasiId
          ? { tipe: "lokasi", id: s.lokasiId }
          : { tipe: "semua", id: "" },
  );

export const toSasaran = (drafts: SasaranDraft[]): Sasaran[] =>
  drafts.map((t) => ({
    unitId: t.tipe === "unit" ? t.id : null,
    lokasiId: t.tipe === "lokasi" ? t.id : null,
    kelasId: t.tipe === "kelas" ? t.id : null,
  }));

export const sasaranLengkap = (drafts: SasaranDraft[]) =>
  drafts.every((t) => t.tipe === "semua" || t.id);

/** Editor daftar sasaran (seluruh sekolah / unit / lokasi / kelas). `tipe` membatasi pilihan jenis. */
export function SasaranEditor({
  value,
  onChange,
  tipe = ["semua", "unit", "lokasi", "kelas"],
  kelasBoleh,
}: {
  value: SasaranDraft[];
  onChange: (v: SasaranDraft[]) => void;
  tipe?: Tipe[];
  /** Saring pilihan kelas (mis. wali kelas hanya kelasnya). */
  kelasBoleh?: (id: string) => boolean;
}) {
  const units = useUnits();
  const lokasi = useLokasi();
  const kelas = useKelas();
  const options: Record<Tipe, { value: string; label: string }[]> = {
    semua: [],
    unit: units.data?.map((u) => ({ value: u.id, label: `${u.kode} · ${u.nama}` })) ?? [],
    lokasi: lokasi.data?.map((l) => ({ value: l.id, label: l.nama })) ?? [],
    kelas: (kelas.data ?? [])
      .filter((k) => !kelasBoleh || kelasBoleh(k.id))
      .map((k) => ({ value: k.id, label: kelasLabel(k) })),
  };
  const set = (i: number, patch: SasaranDraft) =>
    onChange(value.map((x, j) => (j === i ? patch : x)));

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-semibold">Sasaran</legend>
      {value.map((t, i) => (
        <div key={i} className="flex flex-wrap gap-2">
          {tipe.length > 1 && (
            <select
              aria-label={`Jenis sasaran ${i + 1}`}
              className={`${inputBase} w-auto`}
              value={t.tipe}
              onChange={(e) => set(i, { tipe: e.target.value as Tipe, id: "" })}
            >
              {tipe.map((x) => (
                <option key={x} value={x}>
                  {LABEL[x]}
                </option>
              ))}
            </select>
          )}
          {t.tipe !== "semua" && (
            <select
              aria-label={`Pilih ${LABEL[t.tipe].toLowerCase()}`}
              className={`${inputClass} min-w-0 flex-1`}
              value={t.id}
              onChange={(e) => set(i, { ...t, id: e.target.value })}
            >
              <option value="">Pilih {LABEL[t.tipe].toLowerCase()}…</option>
              {options[t.tipe].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          {value.length > 1 && (
            <button
              type="button"
              aria-label="Hapus sasaran"
              className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <Trash2 size={18} />
            </button>
          )}
        </div>
      ))}
      <Button
        variant="secondary"
        onClick={() =>
          onChange([...value, { tipe: tipe.find((x) => x !== "semua") ?? "semua", id: "" }])
        }
      >
        <Plus size={16} /> Tambah sasaran
      </Button>
    </fieldset>
  );
}
