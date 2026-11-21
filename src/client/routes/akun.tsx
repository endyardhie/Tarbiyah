import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import { type FormEvent, useState } from "react";
import type { Me, SessionInfo } from "../../shared/types";
import { Card, PageHeader } from "../components/Page";
import { PasswordForm } from "../components/PasswordForm";
import { PhonesEditor, phonesPayload, toDraft } from "../components/PhonesEditor";
import { api, errorMessage, queryClient } from "../lib/api";
import { useLogout, useMe } from "../lib/auth";
import { formatWaktu } from "../lib/format";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input, Textarea } from "../ui/Field";
import { AuthLayout, BrandHeader } from "./login";

function ProfileForm({ me }: { me: Me }) {
  const u = me.user;
  const [nama, setNama] = useState(u.nama);
  const [namaPanggilan, setNamaPanggilan] = useState(u.namaPanggilan ?? "");
  const [alamat, setAlamat] = useState(u.alamat ?? "");
  const [phones, setPhones] = useState(toDraft(u.phones));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api<Me>("/me", {
        method: "PATCH",
        body: { nama, namaPanggilan, alamat, phones: phonesPayload(phones) },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
      setPhones(toDraft(data.user.phones));
      setSaved(true);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
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
      <ErrorAlert>{error}</ErrorAlert>
      {saved && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium text-on-soft">
          Profil tersimpan.
        </p>
      )}
      <Button type="submit" loading={save.isPending} className="w-full sm:w-auto">
        Simpan profil
      </Button>
    </form>
  );
}

export function ProfilPage() {
  const { data: me } = useMe();
  const logout = useLogout();
  if (!me) return null;
  return (
    <>
      <PageHeader
        title="Profil"
        subtitle={me.user.roles.map((r) => r.nama).join(", ") || "Belum ada jabatan"}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <Card className="lg:col-span-7">
          <h2 className="mb-4 text-lg font-semibold">Data diri</h2>
          <ProfileForm me={me} />
        </Card>
        <div className="space-y-4 lg:col-span-5 lg:space-y-6">
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Ganti password</h2>
            <PasswordForm />
          </Card>
          <Card className="space-y-3">
            <Link
              to="/perangkat"
              className="flex min-h-12 items-center gap-3 rounded-2xl bg-surface-muted px-4 font-semibold hover:bg-soft hover:text-on-soft"
            >
              <MonitorSmartphone size={20} /> Perangkat aktif
            </Link>
            <Button
              variant="danger"
              className="w-full"
              loading={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOut size={18} /> Keluar
            </Button>
          </Card>
        </div>
      </div>
    </>
  );
}

export function PerangkatPage() {
  const sessions = useQuery({
    queryKey: ["me", "sessions"],
    queryFn: () => api<SessionInfo[]>("/me/sessions"),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/me/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => sessions.refetch(),
  });

  return (
    <>
      <PageHeader
        title="Perangkat aktif"
        subtitle="Perangkat yang sedang masuk dengan akun Anda. Keluarkan yang tidak Anda kenali."
      />
      <Card>
        {sessions.isPending ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1].map((i) => (
              <li key={i} className="h-16 animate-pulse rounded-2xl bg-surface-muted" />
            ))}
          </ul>
        ) : sessions.isError ? (
          <ErrorAlert>{errorMessage(sessions.error)}</ErrorAlert>
        ) : (
          <ul className="space-y-2">
            {sessions.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-muted px-4 py-3"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-soft text-on-soft">
                  <Smartphone size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {s.perangkat ?? "Perangkat"}
                    {s.ini && (
                      <span className="ml-2 rounded-full bg-soft px-2.5 py-0.5 text-xs font-bold text-on-soft">
                        Perangkat ini
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-text2">
                    Aktif {formatWaktu(s.terakhirAktif)} · masuk {formatWaktu(s.dibuatAt)}
                  </p>
                </div>
                {!s.ini && (
                  <Button
                    variant="danger"
                    loading={revoke.isPending && revoke.variables === s.id}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    Keluarkan
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorAlert>{revoke.isError ? errorMessage(revoke.error) : ""}</ErrorAlert>
      </Card>
    </>
  );
}

/** Ditampilkan sebagai ganti seluruh aplikasi selama wajib_ganti_password. */
export function WajibGantiPasswordPage() {
  const logout = useLogout();
  return (
    <AuthLayout>
      <BrandHeader
        title="Buat password baru"
        subtitle="Anda masuk dengan password sementara. Ganti dulu sebelum melanjutkan."
      />
      <div className="rounded-[28px] border border-border bg-surface p-5 shadow-soft sm:p-7">
        <PasswordForm />
        <Button variant="ghost" className="mt-3 w-full" onClick={() => logout.mutate()}>
          Keluar
        </Button>
      </div>
    </AuthLayout>
  );
}

/** Persetujuan pemrosesan data: wali santri saat login pertama (teks diatur admin). */
export function PersetujuanPage() {
  const logout = useLogout();
  const [setuju, setSetuju] = useState(false);
  const teks = useQuery({
    queryKey: ["persetujuan"],
    queryFn: () => api<{ teks: string }>("/me/persetujuan"),
  });
  const simpan = useMutation({
    mutationFn: () => api("/me/persetujuan", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });
  return (
    <AuthLayout>
      <BrandHeader title="Persetujuan data" subtitle="Mohon dibaca sebelum memakai aplikasi." />
      <div className="space-y-4 rounded-[28px] border border-border bg-surface p-5 shadow-soft sm:p-7">
        {teks.isPending ? (
          <div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />
        ) : teks.isError ? (
          <ErrorAlert>{errorMessage(teks.error)}</ErrorAlert>
        ) : (
          <div className="max-h-[50dvh] overflow-y-auto whitespace-pre-line rounded-2xl bg-surface-muted p-4 text-sm leading-relaxed">
            {teks.data.teks}
          </div>
        )}
        <Checkbox
          label="Saya sudah membaca dan menyetujui pemrosesan data di atas"
          checked={setuju}
          onChange={(e) => setSetuju(e.target.checked)}
        />
        <ErrorAlert>{simpan.isError ? errorMessage(simpan.error) : ""}</ErrorAlert>
        <Button
          className="w-full"
          disabled={!setuju}
          loading={simpan.isPending}
          onClick={() => simpan.mutate()}
        >
          Setuju & lanjutkan
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => logout.mutate()}>
          Tidak setuju, keluar
        </Button>
      </div>
    </AuthLayout>
  );
}
