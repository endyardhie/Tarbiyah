import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { api, errorMessage, queryClient } from "../lib/api";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input, inputClass, Textarea } from "../ui/Field";

export type Option = { value: string; label: string };
export type FieldDef = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "checkbox" | "date" | "time" | "hidden";
  options?: Option[];
  /** Pilihan kosong pada select (mis. "Semua unit"). */
  empty?: string;
  required?: boolean;
  hint?: string;
  placeholder?: string;
  dir?: "rtl" | "auto";
};

type Values = Record<string, string | boolean>;

/** Form data master: POST ke `endpoint` (baru) atau PATCH `endpoint/id` (ubah). */
export function EntityForm({
  fields,
  endpoint,
  id,
  initial,
  invalidate,
  onDone,
  submitLabel = "Simpan",
  extraAction,
}: {
  fields: FieldDef[];
  endpoint: string;
  id?: string;
  initial?: Record<string, unknown>;
  invalidate: unknown[][];
  onDone: (result: unknown) => void;
  submitLabel?: string;
  extraAction?: React.ReactNode;
}) {
  const [values, setValues] = useState<Values>(() =>
    Object.fromEntries(
      fields.map((f) => {
        const v = initial?.[f.name];
        if (f.type === "checkbox") return [f.name, v === undefined ? true : !!v];
        return [f.name, v == null ? "" : String(v)];
      }),
    ),
  );
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      id
        ? api(`${endpoint}/${id}`, { method: "PATCH", body: values })
        : api(endpoint, { body: values }),
    onSuccess: async (data) => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onDone(data);
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }));

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {fields.map((f) => {
        const v = values[f.name];
        if (f.type === "hidden") return null;
        if (f.type === "checkbox") {
          return (
            <Checkbox
              key={f.name}
              label={f.label}
              description={f.hint}
              checked={!!v}
              onChange={(e) => set(f.name, e.target.checked)}
            />
          );
        }
        return (
          <Field key={f.name} label={f.label} hint={f.hint}>
            {(htmlId) =>
              f.type === "select" ? (
                <select
                  id={htmlId}
                  className={inputClass}
                  value={String(v)}
                  required={f.required}
                  onChange={(e) => set(f.name, e.target.value)}
                >
                  <option value="">{f.empty ?? "Pilih…"}</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <Textarea
                  id={htmlId}
                  value={String(v)}
                  dir={f.dir}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              ) : (
                <Input
                  id={htmlId}
                  type={f.type ?? "text"}
                  value={String(v)}
                  required={f.required}
                  placeholder={f.placeholder}
                  dir={f.dir}
                  inputMode={f.type === "number" ? "numeric" : undefined}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )
            }
          </Field>
        );
      })}
      <ErrorAlert>{error}</ErrorAlert>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {extraAction ?? <span />}
        <Button type="submit" loading={save.isPending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
