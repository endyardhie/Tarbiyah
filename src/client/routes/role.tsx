import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { type GrantablePermission, PERMISSIONS } from "../../shared/permissions";
import type { Role } from "../../shared/types";
import { EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input } from "../ui/Field";
import { Modal } from "../ui/Modal";

const GROUPS: { label: string; prefix: string[] }[] = [
  { label: "Data sekolah", prefix: ["santri", "wali", "guru", "kelas", "mapel", "jadwal"] },
  { label: "Presensi & akademik", prefix: ["presensi", "akademik", "rapor"] },
  { label: "Informasi", prefix: ["pengumuman", "kalender"] },
  { label: "Keuangan", prefix: ["keuangan"] },
  { label: "Sistem", prefix: ["pengguna"] },
];
const ALL = Object.keys(PERMISSIONS) as GrantablePermission[];

function RoleForm({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const { data: me } = useMe();
  // Non-admin hanya boleh memberi izin yang juga ia miliki (dicek ulang di server).
  const canGive = (p: string) => !!me?.isAdmin || !!me?.permissions.includes(p);
  const [nama, setNama] = useState(role?.nama ?? "");
  const [keterangan, setKeterangan] = useState(role?.keterangan ?? "");
  const [izin, setIzin] = useState<string[]>(role?.izin ?? []);
  const [error, setError] = useState("");
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: ["roles"] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { nama, keterangan, izin };
      return role ? api(`/roles/${role.id}`, { method: "PATCH", body }) : api("/roles", { body });
    },
    onSuccess: done,
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/roles/${role?.id}`, { method: "DELETE" }),
    onSuccess: done,
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Nama jabatan">
        {(id) => <Input id={id} value={nama} onChange={(e) => setNama(e.target.value)} required />}
      </Field>
      <Field label="Keterangan">
        {(id) => (
          <Input id={id} value={keterangan} onChange={(e) => setKeterangan(e.target.value)} />
        )}
      </Field>
      {GROUPS.map((g) => (
        <fieldset key={g.label}>
          <legend className="mb-1 text-sm font-semibold text-text2">{g.label}</legend>
          {ALL.filter((p) => g.prefix.includes(p.split(".")[0] ?? "")).map((p) => (
            <Checkbox
              key={p}
              label={PERMISSIONS[p]}
              description={p}
              checked={izin.includes(p)}
              disabled={!canGive(p) && !izin.includes(p)}
              onChange={(e) =>
                setIzin((list) => (e.target.checked ? [...list, p] : list.filter((x) => x !== p)))
              }
            />
          ))}
        </fieldset>
      ))}
      <p className="text-sm text-text2">
        Pengaturan & backup hanya untuk Admin dan tidak bisa diberikan ke jabatan lain.
      </p>
      <ErrorAlert>{error}</ErrorAlert>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        {role ? (
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => {
              const n = role.jumlahPengguna;
              if (
                confirm(
                  `Hapus jabatan ${role.nama}?${n ? ` ${n} pengguna akan kehilangan izinnya.` : ""}`,
                )
              ) {
                remove.mutate();
              }
            }}
          >
            <Trash2 size={18} /> Hapus
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={save.isPending}>
          Simpan
        </Button>
      </div>
    </form>
  );
}

export function RolePage() {
  const { data: me } = useMe();
  const allowed = hasPermission(me, "pengguna.kelola");
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<Role[]>("/roles"),
    enabled: allowed,
  });
  const [editing, setEditing] = useState<Role | "baru" | null>(null);

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
        <PageHeader
          title="Role & hak akses"
          subtitle="Jabatan berlaku untuk semua unit & lokasi. Wali kelas, pengajar, dan wali santri otomatis dari data."
        />
        <Button onClick={() => setEditing("baru")} className="mb-6">
          <Plus size={18} /> Tambah jabatan
        </Button>
      </div>
      {roles.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-card bg-surface-muted" />
          ))}
        </div>
      ) : roles.isError ? (
        <ErrorAlert>{errorMessage(roles.error)}</ErrorAlert>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {roles.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={r.admin}
                onClick={() => setEditing(r)}
                className="h-full w-full rounded-card border border-border bg-surface p-5 text-left shadow-soft transition-colors enabled:hover:border-primary disabled:cursor-default"
              >
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-soft text-on-soft">
                    <ShieldCheck size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold">{r.nama}</p>
                    <p className="text-sm text-text2">{r.jumlahPengguna} pengguna</p>
                  </div>
                </div>
                {r.keterangan && <p className="mt-3 text-sm text-text2">{r.keterangan}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {r.admin ? (
                    <span className="rounded-full bg-soft px-2.5 py-0.5 text-xs font-bold text-on-soft">
                      Semua izin, termasuk pengaturan & backup
                    </span>
                  ) : r.izin.length === 0 ? (
                    <span className="text-sm text-text2">Belum ada izin</span>
                  ) : (
                    r.izin.map((p) => (
                      <span
                        key={p}
                        className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-text2"
                      >
                        {PERMISSIONS[p as GrantablePermission] ?? p}
                      </span>
                    ))
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "baru" ? "Tambah jabatan" : "Ubah jabatan"}
      >
        {editing !== null && (
          <RoleForm
            key={editing === "baru" ? "baru" : editing.id}
            role={editing === "baru" ? null : editing}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </>
  );
}
