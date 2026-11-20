import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Plus, Search, ShieldAlert, UserRound } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { Role, UserDetail } from "../../shared/types";
import { Card, EmptyState, ListRow, PageHeader } from "../components/Page";
import { emptyPhone, PhonesEditor, phonesPayload, toDraft } from "../components/PhonesEditor";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatPhone, formatWaktu } from "../lib/format";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input, inputClass, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";

export function TempPassword({ value, nama }: { value: string; nama: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 rounded-2xl bg-soft p-4 text-on-soft">
      <p className="font-semibold">Password sementara untuk {nama}:</p>
      <p className="rounded-xl bg-surface-raised px-4 py-3 text-center font-mono text-xl font-bold tracking-widest text-text">
        {value}
      </p>
      <p className="text-sm">
        Berikan langsung ke pemilik akun. Password ini hanya ditampilkan sekali dan wajib diganti
        saat masuk pertama.
      </p>
      <Button
        variant="secondary"
        onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}
      >
        <Copy size={18} /> {copied ? "Tersalin" : "Salin"}
      </Button>
    </div>
  );
}

function UserForm({
  user,
  roles,
  isAdmin,
  myPermissions,
  onClose,
}: {
  user: UserDetail | null;
  roles: Role[];
  isAdmin: boolean;
  myPermissions: string[];
  onClose: () => void;
}) {
  // Sama dengan aturan server: non-admin hanya memberi jabatan yang izinnya ia punya.
  const grantable = (r: Role) =>
    isAdmin ||
    (!r.admin && r.izin.every((p) => myPermissions.includes(p))) ||
    !!user?.roles.some((x) => x.id === r.id);
  const [nama, setNama] = useState(user?.nama ?? "");
  const [namaPanggilan, setNamaPanggilan] = useState(user?.namaPanggilan ?? "");
  const [alamat, setAlamat] = useState(user?.alamat ?? "");
  const [phones, setPhones] = useState(user ? toDraft(user.phones) : [emptyPhone()]);
  const [roleIds, setRoleIds] = useState(user?.roles.map((r) => r.id) ?? []);
  const [status, setStatus] = useState(user?.status ?? "aktif");
  const [error, setError] = useState("");
  const [temp, setTemp] = useState<string | null>(null);
  const lockedAdmin = !isAdmin && !!user?.roles.some((r) => r.admin);

  const done = () => queryClient.invalidateQueries({ queryKey: ["users"] });
  const body = () => ({
    nama,
    namaPanggilan,
    alamat,
    phones: phonesPayload(phones),
    roleIds,
    ...(user ? { status } : {}),
  });
  const save = useMutation({
    // Akun baru → password sementara; ubah akun → null.
    mutationFn: async () => {
      if (user) {
        await api(`/users/${user.id}`, { method: "PATCH", body: body() });
        return null;
      }
      return (await api<{ passwordSementara: string }>("/users", { body: body() }))
        .passwordSementara;
    },
    onSuccess: async (passwordSementara) => {
      await done();
      if (passwordSementara) setTemp(passwordSementara);
      else onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const reset = useMutation({
    mutationFn: () =>
      api<{ passwordSementara: string }>(`/users/${user?.id}/reset-password`, { method: "POST" }),
    onSuccess: (data) => setTemp(data.passwordSementara),
    onError: (e) => setError(errorMessage(e)),
  });

  if (temp) {
    return (
      <div className="space-y-4">
        <TempPassword value={temp} nama={nama} />
        <Button className="w-full" onClick={onClose}>
          Selesai
        </Button>
      </div>
    );
  }

  if (lockedAdmin) {
    return <ErrorAlert>Hanya admin yang boleh mengubah akun admin.</ErrorAlert>;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nama lengkap">
        {(id) => <Input id={id} value={nama} onChange={(e) => setNama(e.target.value)} required />}
      </Field>
      <Field label="Nama panggilan">
        {(id) => (
          <Input id={id} value={namaPanggilan} onChange={(e) => setNamaPanggilan(e.target.value)} />
        )}
      </Field>
      <Field label="Alamat">
        {(id) => <Textarea id={id} value={alamat} onChange={(e) => setAlamat(e.target.value)} />}
      </Field>
      <PhonesEditor value={phones} onChange={setPhones} />
      <fieldset>
        <legend className="mb-1 text-sm font-semibold">Jabatan</legend>
        <p className="mb-1 text-sm text-text2">
          Wali kelas, pengajar, dan wali santri tidak dipilih di sini; diatur dari data kelas &
          santri.
        </p>
        {roles.map((r) => (
          <Checkbox
            key={r.id}
            label={r.nama}
            description={r.admin ? "Akses penuh" : r.keterangan}
            checked={roleIds.includes(r.id)}
            disabled={!grantable(r)}
            onChange={(e) =>
              setRoleIds((ids) =>
                e.target.checked ? [...ids, r.id] : ids.filter((x) => x !== r.id),
              )
            }
          />
        ))}
      </fieldset>
      {user && (
        <Field label="Status">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as "aktif" | "nonaktif")}
            >
              <option value="aktif">Aktif</option>
              <option value="nonaktif">Nonaktif (tidak bisa masuk)</option>
            </select>
          )}
        </Field>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {user ? (
          <Button
            variant="secondary"
            loading={reset.isPending}
            onClick={() => {
              if (confirm(`Reset password ${user.nama}? Semua perangkatnya akan dikeluarkan.`)) {
                reset.mutate();
              }
            }}
          >
            <KeyRound size={18} /> Reset password
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={save.isPending}>
          {user ? "Simpan" : "Buat akun"}
        </Button>
      </div>
    </form>
  );
}

const FILTERS = [
  { value: "semua", label: "Semua" },
  { value: "aktif", label: "Aktif" },
  { value: "nonaktif", label: "Nonaktif" },
] as const;

export function PenggunaPage() {
  const { data: me } = useMe();
  const allowed = hasPermission(me, "pengguna.kelola");
  const users = useQuery({
    queryKey: ["users"],
    queryFn: () => api<UserDetail[]>("/users"),
    enabled: allowed,
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<Role[]>("/roles"),
    enabled: allowed,
  });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("aktif");
  const [editing, setEditing] = useState<UserDetail | "baru" | null>(null);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, "").replace(/^0/, "");
    return (users.data ?? []).filter(
      (u) =>
        (filter === "semua" || u.status === filter) &&
        (!term ||
          u.nama.toLowerCase().includes(term) ||
          (digits.length >= 3 && u.phones.some((p) => p.nomor.includes(digits)))),
    );
  }, [users.data, q, filter]);

  if (!allowed) {
    return (
      <EmptyState icon={ShieldAlert} title="Tidak punya akses">
        Halaman ini hanya untuk pengelola pengguna.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <PageHeader title="Pengguna" subtitle="Akun guru, staf, dan wali santri." />
        <Button onClick={() => setEditing("baru")} className="mb-6">
          <Plus size={18} /> Tambah pengguna
        </Button>
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text2"
          />
          <input
            aria-label="Cari nama atau nomor HP"
            placeholder="Cari nama atau nomor HP"
            className={`${inputClass} pl-11`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-2" role="group" aria-label="Filter status">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="min-h-11 rounded-full border border-border px-4 font-semibold text-text2 aria-pressed:border-transparent aria-pressed:bg-soft aria-pressed:text-on-soft"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {users.isPending ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-card bg-surface-muted" />
          ))}
        </div>
      ) : users.isError ? (
        <ErrorAlert>{errorMessage(users.error)}</ErrorAlert>
      ) : shown.length === 0 ? (
        <EmptyState icon={UserRound} title="Tidak ada pengguna">
          {q ? "Tidak ada yang cocok dengan pencarian." : "Belum ada pengguna dengan status ini."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((u) => (
            <li key={u.id}>
              <ListRow
                nama={u.nama}
                ket={u.phones.map((p) => formatPhone(p.nomor)).join(" · ")}
                sub={
                  u.loginTerakhir
                    ? `Masuk terakhir ${formatWaktu(u.loginTerakhir)}`
                    : "Belum pernah masuk"
                }
                badge={
                  u.status === "nonaktif" ? (
                    <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-text2">
                      Nonaktif
                    </span>
                  ) : (
                    u.roles[0] && (
                      <span className="max-w-24 shrink-0 truncate rounded-full bg-soft px-2.5 py-0.5 text-xs font-bold text-on-soft">
                        {u.roles[0].nama}
                        {u.roles.length > 1 && ` +${u.roles.length - 1}`}
                      </span>
                    )
                  )
                }
                onClick={() => setEditing(u)}
              />
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "baru" ? "Tambah pengguna" : "Ubah pengguna"}
      >
        {editing !== null && (
          <UserForm
            key={editing === "baru" ? "baru" : editing.id}
            user={editing === "baru" ? null : editing}
            roles={roles.data ?? []}
            isAdmin={!!me?.isAdmin}
            myPermissions={me?.permissions ?? []}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}
