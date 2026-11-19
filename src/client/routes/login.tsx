import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import type { Me } from "../../shared/types";
import { PasswordInput } from "../components/PasswordForm";
import { ThemeToggle } from "../components/ThemeToggle";
import { Turnstile } from "../components/Turnstile";
import { api, errorMessage, queryClient } from "../lib/api";
import { useMe } from "../lib/auth";
import { Button } from "../ui/Button";
import { ErrorAlert, Field } from "../ui/Field";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-32 size-[28rem] rounded-full bg-soft opacity-70 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -left-40 size-[26rem] rounded-full bg-lime/30 blur-3xl"
      />
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <main className="relative w-full max-w-md">{children}</main>
    </div>
  );
}

export function BrandHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6 text-center">
      <span className="mx-auto mb-4 grid size-16 place-items-center rounded-[22px] bg-primary text-2xl font-extrabold text-on-primary shadow-soft">
        T
      </span>
      <p className="text-sm font-bold tracking-[0.2em] text-primary">TARBIYAH</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-text2">{subtitle}</p>
    </div>
  );
}

export function LoginPage() {
  const me = useMe();
  const navigate = useNavigate();
  const config = useQuery({
    queryKey: ["public-config"],
    queryFn: () => api<{ turnstileSiteKey: string }>("/public-config"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [nomor, setNomor] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState("");

  const login = useMutation({
    mutationFn: () => api<Me>("/auth/login", { body: { nomor, password, turnstileToken: token } }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
      navigate({ to: "/" });
    },
    onError: (e) => {
      setError(errorMessage(e));
      setResetKey((k) => k + 1); // token Turnstile hanya sekali pakai
    },
  });

  if (me.data) return <Navigate to="/" />;

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!token) return setError("Tunggu verifikasi keamanan selesai");
    login.mutate();
  }

  return (
    <AuthLayout>
      <BrandHeader title="Masuk" subtitle="Gunakan nomor HP yang terdaftar di sekolah." />
      <form
        onSubmit={submit}
        className="space-y-4 rounded-[28px] border border-border bg-surface p-5 shadow-soft sm:p-7"
      >
        <Field label="Nomor HP">
          {(id) => (
            <div className="flex min-h-12 overflow-hidden rounded-2xl border border-border bg-surface-raised transition-colors focus-within:border-primary">
              <span className="flex items-center border-r border-border bg-surface-muted px-4 font-semibold text-text2">
                +62
              </span>
              <input
                id={id}
                className="min-w-0 flex-1 bg-transparent px-4 text-text placeholder:text-text2/70 focus:outline-none"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder="812 3456 7890"
                value={nomor}
                onChange={(e) => setNomor(e.target.value)}
                required
              />
            </div>
          )}
        </Field>
        <Field label="Password">
          {(id) => (
            <PasswordInput
              id={id}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          )}
        </Field>
        <div className="flex justify-end">
          <Link
            to="/lupa-password"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            Lupa password?
          </Link>
        </div>
        {config.data && (
          <Turnstile
            siteKey={config.data.turnstileSiteKey}
            onToken={setToken}
            resetKey={resetKey}
          />
        )}
        <ErrorAlert>{error || (config.isError ? errorMessage(config.error) : "")}</ErrorAlert>
        <Button type="submit" className="w-full" loading={login.isPending}>
          Masuk
        </Button>
        <div className="border-t border-border pt-4">
          {/* Aktif di M2 setelah manifest & ikon PWA tersedia. */}
          <Button variant="secondary" className="w-full" disabled>
            <Download size={18} /> Install Aplikasi
          </Button>
          <p className="mt-2 text-center text-sm text-text2">
            Pemasangan aplikasi segera tersedia.
          </p>
        </div>
      </form>
    </AuthLayout>
  );
}

export function LupaPasswordPage() {
  return (
    <AuthLayout>
      <BrandHeader title="Lupa password" subtitle="Reset password dilakukan oleh admin sekolah." />
      <div className="space-y-4 rounded-[28px] border border-border bg-surface p-5 shadow-soft sm:p-7">
        <p>
          Hubungi admin atau tata usaha sekolah dan sebutkan nomor HP Anda. Admin akan memberi{" "}
          <strong>password sementara</strong> yang wajib Anda ganti saat masuk.
        </p>
        <p className="text-sm text-text2">Reset lewat kode WhatsApp akan tersedia kemudian.</p>
        <Link
          to="/login"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-5 font-semibold text-on-primary hover:bg-primary-hover"
        >
          Kembali ke halaman masuk
        </Link>
      </div>
    </AuthLayout>
  );
}
