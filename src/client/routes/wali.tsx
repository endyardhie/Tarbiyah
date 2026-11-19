import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Link2, Plus, Search, ShieldAlert, Unlink, Users } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { HUBUNGAN } from "../../shared/sekolah";
import type { SantriRow, WaliRow } from "../../shared/types";
import { ListSkeleton } from "../components/MasterList";
import { EmptyState, PageHeader } from "../components/Page";
import { emptyPhone, PhonesEditor, phonesPayload, toDraft } from "../components/PhonesEditor";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatPhone } from "../lib/format";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input, inputClass, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { TempPassword } from "./pengguna";

type Hubungan = (typeof HUBUNGAN)[number];
export const hubunganLabel: Record<Hubungan, string> = { ayah: "Ayah", ibu: "Ibu", wali: "Wali" };

const refresh = () =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: ["wali"] }),
    queryClient.invalidateQueries({ queryKey: ["santri"] }),
  ]);

export const useWaliList = (enabled = true) =>
  useQuery({ queryKey: ["wali"], queryFn: () => api<WaliRow[]>("/wali"), enabled });

/** Cocokkan nama atau nomor HP (0812…/62812…). */
export function matches(term: string, nama: string, nomor: string[] = []) {
  const t = term.trim().toLowerCase();
  if (!t) return true;
  const digits = t.replace(/\D/g, "").replace(/^0/, "");
  return (
    nama.toLowerCase().includes(t) || (digits.length >= 3 && nomor.some((n) => n.includes(digits)))
  );
}

/** Hubungkan satu santri dan satu wali (dipakai dari halaman santri maupun wali). */
export function LinkForm({
  santriId,
  userId,
  picker,
  onDone,
  initial,
}: {
  santriId?: string;
  userId?: string;
  picker: { label: string; options: { id: string; label: string; search: string[] }[] };
  onDone: () => void;
  initial?: { hubungan: Hubungan; penerimaTagihan: boolean };
}) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState(santriId && userId ? (picker.options[0]?.id ?? "") : "");
  const [hubungan, setHubungan] = useState<Hubungan>(initial?.hubungan ?? "wali");
  const [penerima, setPenerima] = useState(initial?.penerimaTagihan ?? true);
  const [error, setError] = useState("");
  const fixed = !!(santriId && userId);
  const save = useMutation({
    mutationFn: () =>
      api("/santri-wali", {
        method: "PUT",
        body: {
          santriId: santriId ?? chosen,
          userId: userId ?? chosen,
          hubungan,
          penerimaTagihan: penerima,
        },
      }),
    onSuccess: async () => {
      await refresh();
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const shown = picker.options.filter((o) => matches(q, o.label, o.search)).slice(0, 30);

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!fixed && !chosen) return setError(`Pilih ${picker.label.toLowerCase()} dulu`);
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {!fixed && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-semibold">{picker.label}</legend>
          <input
            aria-label={`Cari ${picker.label.toLowerCase()}`}
            placeholder="Cari nama atau nomor"
            className={inputClass}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="max-h-60 space-y-1 overflow-y-auto rounded-2xl border border-border p-1">
            {shown.map((o) => (
              <li key={o.id}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 has-checked:bg-soft has-checked:text-on-soft">
                  <input
                    type="radio"
                    name="pilih"
                    className="size-5 accent-[var(--primary)]"
                    checked={chosen === o.id}
                    onChange={() => setChosen(o.id)}
                  />
                  <span className="min-w-0 truncate">{o.label}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-3 py-3 text-sm text-text2">Tidak ditemukan.</li>
            )}
          </ul>
        </fieldset>
      )}
      <Field label="Hubungan">
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={hubungan}
            onChange={(e) => setHubungan(e.target.value as Hubungan)}
          >
            {HUBUNGAN.map((h) => (
              <option key={h} value={h}>
                {hubunganLabel[h]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Checkbox
        label="Penerima tagihan"
        description="Bukti bayar & tagihan dikirim ke nomor WA wali ini."
        checked={penerima}
        onChange={(e) => setPenerima(e.target.checked)}
      />
      <ErrorAlert>{error}</ErrorAlert>
      <Button type="submit" loading={save.isPending} className="w-full sm:w-auto">
        <Link2 size={18} /> Simpan hubungan
      </Button>
    </form>
  );
}

export function unlinkSantriWali(santriId: string, userId: string) {
  return api(`/santri-wali/${santriId}/${userId}`, { method: "DELETE" }).then(refresh);
}

/** Akun wali baru (password sementara) — opsional langsung dihubungkan ke satu santri. */
export function NewWaliForm({ santriId, onDone }: { santriId?: string; onDone: () => void }) {
  const [nama, setNama] = useState("");
  const [alamat, setAlamat] = useState("");
  const [phones, setPhones] = useState([emptyPhone()]);
  const [hubungan, setHubungan] = useState<Hubungan>("wali");
  const [error, setError] = useState("");
  const [temp, setTemp] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      const r = await api<{ id: string; passwordSementara: string }>("/wali", {
        body: { nama, alamat, phones: phonesPayload(phones) },
      });
      if (santriId) {
        await api("/santri-wali", {
          method: "PUT",
          body: { santriId, userId: r.id, hubungan, penerimaTagihan: true },
        });
      }
      return r;
    },
    onSuccess: async (r) => {
      await refresh();
      setTemp(r.passwordSementara);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (temp) {
    return (
      <div className="space-y-4">
        <TempPassword value={temp} nama={nama} />
        <Button className="w-full" onClick={onDone}>
          Selesai
        </Button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        save.mutate();
      }}
      className="space-y-4"
    >
      <Field label="Nama wali">
        {(id) => <Input id={id} value={nama} onChange={(e) => setNama(e.target.value)} required />}
      </Field>
      <Field label="Alamat">
        {(id) => <Textarea id={id} value={alamat} onChange={(e) => setAlamat(e.target.value)} />}
      </Field>
      <PhonesEditor value={phones} onChange={setPhones} />
      {santriId && (
        <Field label="Hubungan dengan santri">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={hubungan}
              onChange={(e) => setHubungan(e.target.value as Hubungan)}
            >
              {HUBUNGAN.map((h) => (
                <option key={h} value={h}>
                  {hubunganLabel[h]}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      <Button type="submit" loading={save.isPending} className="w-full sm:w-auto">
        Buat akun wali
      </Button>
    </form>
  );
}

function WaliEdit({ wali, onClose }: { wali: WaliRow; onClose: () => void }) {
  const [nama, setNama] = useState(wali.nama);
  const [phones, setPhones] = useState(toDraft(wali.phones));
  const [status, setStatus] = useState(wali.status);
  const [error, setError] = useState("");
  const [temp, setTemp] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const santri = useQuery({
    queryKey: ["santri", ""],
    queryFn: () => api<SantriRow[]>("/santri"),
    enabled: adding,
  });
  const save = useMutation({
    mutationFn: () =>
      api(`/wali/${wali.id}`, {
        method: "PATCH",
        body: { nama, phones: phonesPayload(phones), status },
      }),
    onSuccess: async () => {
      await refresh();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () =>
      api<{ passwordSementara: string }>(`/wali/${wali.id}/reset-password`, { method: "POST" }),
    onSuccess: (r) => setTemp(r.passwordSementara),
    onError: (e) => setError(errorMessage(e)),
  });
  const unlink = useMutation({
    mutationFn: (santriId: string) => unlinkSantriWali(santriId, wali.id),
    onError: (e) => setError(errorMessage(e)),
  });

  if (temp) {
    return (
      <div className="space-y-4">
        <TempPassword value={temp} nama={wali.nama} />
        <Button className="w-full" onClick={onClose}>
          Selesai
        </Button>
      </div>
    );
  }
  if (adding) {
    return santri.isPending ? (
      <ListSkeleton />
    ) : (
      <LinkForm
        userId={wali.id}
        picker={{
          label: "Santri",
          options: (santri.data ?? [])
            .filter((s) => !wali.anak.some((a) => a.santriId === s.id))
            .map((s) => ({
              id: s.id,
              label: `${s.nama} · ${s.nis}${s.kelasNama ? ` · ${s.kelasNama}` : ""}`,
              search: [s.nis],
            })),
        }}
        onDone={() => setAdding(false)}
      />
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Anak</h3>
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Hubungkan santri
          </Button>
        </div>
        {wali.anak.length === 0 && <p className="text-sm text-text2">Belum terhubung ke santri.</p>}
        <ul className="space-y-1">
          {wali.anak.map((a) => (
            <li
              key={a.santriId}
              className="flex items-center gap-2 rounded-2xl bg-surface-muted py-1 pr-1 pl-4"
            >
              <span className="min-w-0 flex-1 truncate">
                {a.nama} <span className="text-text2">· {hubunganLabel[a.hubungan]}</span>
              </span>
              <button
                type="button"
                aria-label={`Lepas ${a.nama}`}
                className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
                onClick={() =>
                  confirm(`Lepas hubungan dengan ${a.nama}?`) && unlink.mutate(a.santriId)
                }
              >
                <Unlink size={18} />
              </button>
            </li>
          ))}
        </ul>
      </section>
      <form
        className="space-y-4 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          save.mutate();
        }}
      >
        <Field label="Nama wali">
          {(id) => (
            <Input id={id} value={nama} onChange={(e) => setNama(e.target.value)} required />
          )}
        </Field>
        <PhonesEditor value={phones} onChange={setPhones} />
        <Field label="Status akun">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as WaliRow["status"])}
            >
              <option value="aktif">Aktif</option>
              <option value="nonaktif">Nonaktif (tidak bisa masuk)</option>
            </select>
          )}
        </Field>
        <ErrorAlert>{error}</ErrorAlert>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="secondary"
            loading={reset.isPending}
            onClick={() => confirm(`Reset password ${wali.nama}?`) && reset.mutate()}
          >
            <KeyRound size={18} /> Reset password
          </Button>
          <Button type="submit" loading={save.isPending}>
            Simpan
          </Button>
        </div>
      </form>
    </div>
  );
}

export function WaliPage() {
  const { data: me } = useMe();
  const allowed = hasPermission(me, "wali.kelola");
  const list = useWaliList(allowed);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<WaliRow | "baru" | null>(null);
  const shown = useMemo(
    () =>
      (list.data ?? []).filter((w) =>
        matches(
          q,
          w.nama,
          w.phones.map((p) => p.nomor),
        ),
      ),
    [list.data, q],
  );

  if (!allowed) {
    return (
      <EmptyState icon={ShieldAlert} title="Tidak punya akses">
        Halaman ini untuk pengelola wali santri.
      </EmptyState>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <PageHeader
          title="Wali santri"
          subtitle="Satu akun per orang; ayah & ibu sebaiknya terpisah."
        />
        <Button onClick={() => setEditing("baru")} className="mb-6">
          <Plus size={18} /> Tambah wali
        </Button>
      </div>
      <div className="relative mb-4">
        <Search
          size={18}
          className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text2"
        />
        <input
          aria-label="Cari wali"
          placeholder="Cari nama atau nomor HP"
          className={`${inputClass} pl-11`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
      ) : shown.length === 0 ? (
        <EmptyState icon={Users} title="Tidak ada wali">
          {q
            ? "Tidak ada yang cocok dengan pencarian."
            : "Belum ada wali. Tambah satu per satu atau lewat Impor CSV."}
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-text2">{shown.length} wali</p>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shown.slice(0, 300).map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => setEditing(w)}
                  className="h-full w-full rounded-card border border-border bg-surface p-4 text-left shadow-soft transition-colors hover:border-primary"
                >
                  <p className="font-semibold">
                    {w.nama}
                    {w.status === "nonaktif" && (
                      <span className="ml-2 text-xs font-bold text-text2">Nonaktif</span>
                    )}
                  </p>
                  <p className="text-sm text-text2">
                    {w.phones.map((p) => formatPhone(p.nomor)).join(" · ")}
                  </p>
                  <p className="mt-2 text-sm">
                    {w.anak.length ? (
                      w.anak.map((a) => a.nama).join(", ")
                    ) : (
                      <span className="text-warn">Belum terhubung ke santri</span>
                    )}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {shown.length > 300 && (
            <p className="mt-3 text-sm text-text2">
              Tampil 300 pertama; persempit dengan pencarian.
            </p>
          )}
        </>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "baru" ? "Tambah wali" : (editing?.nama ?? "")}
      >
        {editing === "baru" && <NewWaliForm onDone={() => setEditing(null)} />}
        {editing && editing !== "baru" && (
          <WaliEdit
            key={editing.id}
            // Ambil versi terbaru dari daftar agar anak yang baru dihubungkan langsung tampil.
            wali={list.data?.find((w) => w.id === editing.id) ?? editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}
