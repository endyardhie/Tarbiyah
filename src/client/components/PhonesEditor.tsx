import { Plus, Trash2 } from "lucide-react";
import type { Phone } from "../../shared/types";
import { formatPhone } from "../lib/format";
import { Button } from "../ui/Button";
import { inputClass } from "../ui/Field";

export type PhoneDraft = Omit<Phone, "label"> & { label: string };

export const toDraft = (phones: Phone[]): PhoneDraft[] =>
  phones.map((p) => ({ ...p, nomor: formatPhone(p.nomor), label: p.label ?? "" }));

export const emptyPhone = (): PhoneDraft => ({
  nomor: "",
  label: "",
  punyaWa: true,
  untukLogin: true,
});

const LABELS = ["Pribadi", "Ayah", "Ibu", "Wali", "Kantor"];

export function PhonesEditor({
  value,
  onChange,
}: {
  value: PhoneDraft[];
  onChange: (v: PhoneDraft[]) => void;
}) {
  const set = (i: number, patch: Partial<PhoneDraft>) =>
    onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <fieldset className="space-y-3">
      <legend className="mb-1.5 text-sm font-semibold">Nomor HP</legend>
      {value.map((p, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-border bg-surface p-3">
          <input
            aria-label={`Nomor HP ${i + 1}`}
            className={inputClass}
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="0812-3456-7890"
            value={p.nomor}
            onChange={(e) => set(i, { nomor: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-x-4">
            <select
              aria-label={`Label nomor ${i + 1}`}
              className="min-h-11 rounded-full border border-border bg-surface-raised px-4 font-medium text-text focus:border-primary focus:outline-none"
              value={p.label}
              onChange={(e) => set(i, { label: e.target.value })}
            >
              <option value="">Label</option>
              {LABELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={p.punyaWa}
                onChange={(e) => set(i, { punyaWa: e.target.checked })}
              />
              Punya WA
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-5 accent-[var(--primary)]"
                checked={p.untukLogin}
                onChange={(e) => set(i, { untukLogin: e.target.checked })}
              />
              Untuk login
            </label>
            {value.length > 1 && (
              <button
                type="button"
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                className="ml-auto grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
                aria-label={`Hapus nomor ${i + 1}`}
              >
                <Trash2 size={18} />
              </button>
            )}
          </div>
        </div>
      ))}
      {value.length < 5 && (
        <Button variant="secondary" onClick={() => onChange([...value, emptyPhone()])}>
          <Plus size={18} /> Tambah nomor
        </Button>
      )}
    </fieldset>
  );
}

export const phonesPayload = (value: PhoneDraft[]) =>
  value.map((p) => ({ ...p, label: p.label || null }));
