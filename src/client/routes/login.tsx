import { useMutation } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import type { Me } from "../../shared/types";
import { PasswordInput } from "../components/PasswordForm";
import { ThemeToggle } from "../components/ThemeToggle";
import { Turnstile } from "../components/Turnstile";
import { api, errorMessage, queryClient } from "../lib/api";
import { useMe } from "../lib/auth";
import { isIos, useInstall } from "../lib/install";
import { disablePush } from "../lib/push";
import { usePublicConfig } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, Input } from "../ui/Field";

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
  const config = usePublicConfig();
  const logo = config.data?.logoUrl;
  return (
    <div className="mb-6 text-center">
      {logo ? (
        <img
          src={logo}
          alt=""
          className="mx-auto mb-4 size-20 rounded-[22px] bg-white object-contain p-1 shadow-soft"
        />
      ) : (
        // Logo bawaan TARBIYAH selama lembaga belum mengunggah logo sendiri.
        <img
          src="/icons/icon-192.png"
          alt=""
          className="mx-auto mb-4 size-20 shadow-soft rounded-[22px]"
        />
      )}
      <p className="text-sm font-bold tracking-[0.2em] text-primary uppercase">
        {config.data?.nama ?? "TARBIYAH"}
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-text2">{subtitle}</p>
    </div>
  );
}

export function LoginPage() {
  const me = useMe();
  const navigate = useNavigate();
  const config = usePublicConfig();
  const [nomor, setNomor] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState("");

  const login = useMutation({
    mutationFn: () => api<Me>("/auth/login", { body: { nomor, password, turnstileToken: token } }),
    onSuccess: async (data) => {
      await disablePush();
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
        <NomorField value={nomor} onChange={setNomor} />
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
        <InstallSection />
      </form>
    </AuthLayout>
  );
}

function NomorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
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
            value={value}
            onChange={(e) => onChange(e.target.value)}
            required
          />
        </div>
      )}
    </Field>
  );
}

/** Lupa password: kode 6 digit via WhatsApp → password baru. Admin tetap bisa reset manual. */
export function LupaPasswordPage() {
  const config = usePublicConfig();
  const navigate = useNavigate();
  const [tahap, setTahap] = useState<"nomor" | "kode" | "selesai">("nomor");
  const [nomor, setNomor] = useState("");
  const [kode, setKode] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState("");

  const minta = useMutation({
    mutationFn: () => api("/auth/otp/minta", { body: { nomor, turnstileToken: token } }),
    onSuccess: () => {
      setTahap("kode");
      setError("");
    },
    onError: (e) => setError(errorMessage(e)),
    onSettled: () => setResetKey((k) => k + 1),
  });
  const reset = useMutation({
    mutationFn: () => api("/auth/otp/reset", { body: { nomor, kode, passwordBaru: password } }),
    onSuccess: () => setTahap("selesai"),
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (tahap === "nomor") {
      if (!token) return setError("Tunggu verifikasi keamanan selesai");
      minta.mutate();
    } else reset.mutate();
  }

  const kartu = "space-y-4 rounded-[28px] border border-border bg-surface p-5 shadow-soft sm:p-7";
  if (tahap === "selesai") {
    return (
      <AuthLayout>
        <BrandHeader title="Password diganti" subtitle="Silakan masuk dengan password baru." />
        <div className={kartu}>
          <Button className="w-full" onClick={() => navigate({ to: "/login" })}>
            Masuk
          </Button>
        </div>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <BrandHeader
        title="Lupa password"
        subtitle={
          tahap === "nomor"
            ? "Kode reset dikirim lewat WhatsApp ke nomor yang terdaftar."
            : "Masukkan kode 6 angka dari WhatsApp dan password baru."
        }
      />
      <form onSubmit={submit} className={kartu}>
        {tahap === "nomor" ? (
          <>
            <NomorField value={nomor} onChange={setNomor} />
            {config.data && (
              <Turnstile
                siteKey={config.data.turnstileSiteKey}
                onToken={setToken}
                resetKey={resetKey}
              />
            )}
          </>
        ) : (
          <>
            <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm text-on-soft">
              Bila nomor terdaftar dan aktif di WhatsApp, kode sudah dikirim. Berlaku 5 menit.
            </p>
            <Field label="Kode dari WhatsApp">
              {(id) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={kode}
                  onChange={(e) => setKode(e.target.value.replace(/\D/g, ""))}
                  required
                />
              )}
            </Field>
            <Field label="Password baru" hint="Minimal 8 karakter.">
              {(id) => (
                <PasswordInput
                  id={id}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              )}
            </Field>
          </>
        )}
        <ErrorAlert>{error}</ErrorAlert>
        <Button type="submit" className="w-full" loading={minta.isPending || reset.isPending}>
          {tahap === "nomor" ? "Kirim kode" : "Simpan password baru"}
        </Button>
        {tahap === "kode" && (
          <Button variant="ghost" className="w-full" onClick={() => setTahap("nomor")}>
            Minta kode lagi
          </Button>
        )}
        <p className="text-sm text-text2">
          Tidak punya WhatsApp atau kode tidak datang? Hubungi admin sekolah untuk password
          sementara.
        </p>
        <Link
          to="/login"
          className="inline-flex min-h-11 w-full items-center justify-center font-semibold text-primary hover:underline"
        >
          Kembali ke halaman masuk
        </Link>
      </form>
    </AuthLayout>
  );
}

/** Tombol install PWA yang benar-benar bekerja; panduan manual bila browser tidak memberi prompt. */
function InstallSection() {
  const { canPrompt, standalone, installed, prompt } = useInstall();
  const [help, setHelp] = useState(false);
  const [status, setStatus] = useState("");
  if (standalone) return null;
  if (installed) {
    return (
      <p role="status" className="border-t border-border pt-4 text-center text-sm text-text2">
        Aplikasi terpasang. Buka dari layar utama HP Anda.
      </p>
    );
  }

  async function onClick() {
    setStatus("");
    if (!canPrompt) return setHelp((h) => !h);
    const outcome = await prompt();
    setStatus(
      outcome === "accepted"
        ? "Aplikasi sedang dipasang. Lihat layar utama atau notifikasi browser."
        : "Pemasangan dibatalkan. Anda tetap bisa memakai aplikasi di browser.",
    );
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Button
        variant="secondary"
        className="w-full"
        onClick={onClick}
        aria-expanded={canPrompt ? undefined : help}
      >
        <Download size={18} /> {canPrompt ? "Install Aplikasi" : "Cara Install Aplikasi"}
      </Button>
      {help && !canPrompt && (
        <div role="status" className="rounded-2xl bg-surface-muted p-4 text-sm">
          {isIos() ? (
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Buka halaman ini di <strong>Safari</strong>.
              </li>
              <li>
                Ketuk tombol <strong>Bagikan</strong> (kotak dengan panah ke atas).
              </li>
              <li>
                Pilih <strong>Tambah ke Layar Utama</strong>, lalu ketuk <strong>Tambah</strong>.
              </li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-5">
              <li>Buka menu browser (ikon titik tiga ⋮).</li>
              <li>
                Pilih <strong>Instal aplikasi</strong> atau{" "}
                <strong>Tambahkan ke layar utama</strong>.
              </li>
              <li>Bila tidak ada, pakai Chrome atau Edge versi terbaru.</li>
            </ol>
          )}
        </div>
      )}
      <p aria-live="polite" className="text-center text-sm text-text2">
        {status}
      </p>
    </div>
  );
}
