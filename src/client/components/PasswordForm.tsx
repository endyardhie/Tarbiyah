import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api, errorMessage, queryClient } from "../lib/api";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, Input } from "../ui/Field";

export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? "text" : "password"} className="pr-14" />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Sembunyikan password" : "Tampilkan password"}
        className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full text-text2 hover:bg-surface-muted"
      >
        {show ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>
    </div>
  );
}

export function PasswordForm({ onDone }: { onDone?: () => void }) {
  const [lama, setLama] = useState("");
  const [baru, setBaru] = useState("");
  const [ulang, setUlang] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api("/me/password", { body: { passwordLama: lama, passwordBaru: baru } }),
    onSuccess: async () => {
      setLama("");
      setBaru("");
      setUlang("");
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      onDone?.();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    if (baru.length < 8) return setError("Password baru minimal 8 karakter");
    if (baru !== ulang) return setError("Ulangi password baru dengan sama persis");
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Password lama">
        {(id) => (
          <PasswordInput
            id={id}
            value={lama}
            onChange={(e) => setLama(e.target.value)}
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <Field label="Password baru" hint="Minimal 8 karakter.">
        {(id) => (
          <PasswordInput
            id={id}
            value={baru}
            onChange={(e) => setBaru(e.target.value)}
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <Field label="Ulangi password baru">
        {(id) => (
          <PasswordInput
            id={id}
            value={ulang}
            onChange={(e) => setUlang(e.target.value)}
            autoComplete="new-password"
            required
          />
        )}
      </Field>
      <ErrorAlert>{error}</ErrorAlert>
      {saved && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium text-on-soft">
          Password berhasil diganti. Perangkat lain sudah dikeluarkan.
        </p>
      )}
      <Button type="submit" loading={save.isPending} className="w-full sm:w-auto">
        Simpan password
      </Button>
    </form>
  );
}
