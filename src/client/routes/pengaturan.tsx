import { useMutation, useQuery } from "@tanstack/react-query";
import { ImageUp, ShieldAlert } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { type Identitas, ZONA_WAKTU } from "../../shared/sekolah";
import { Card, EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { useMe } from "../lib/auth";
import { makeLogoSet } from "../lib/image";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, Input, inputClass, Textarea } from "../ui/Field";
import { PengaturanKeuanganCards } from "./pengaturan-keuangan";

const ZONA_LABEL: Record<string, string> = {
  "Asia/Jakarta": "WIB (Asia/Jakarta)",
  "Asia/Makassar": "WITA (Asia/Makassar)",
  "Asia/Jayapura": "WIT (Asia/Jayapura)",
};

function IdentitasForm({ data }: { data: Identitas }) {
  const [nama, setNama] = useState(data.nama);
  const [namaSingkat, setNamaSingkat] = useState(data.namaSingkat);
  const [alamat, setAlamat] = useState(data.alamat ?? "");
  const [zonaWaktu, setZonaWaktu] = useState(data.zonaWaktu);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api<Identitas>("/pengaturan/identitas", {
        method: "PUT",
        body: { nama, namaSingkat, alamat, zonaWaktu },
      }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries();
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
      <Field label="Nama lembaga">
        {(id) => <Input id={id} value={nama} onChange={(e) => setNama(e.target.value)} required />}
      </Field>
      <Field label="Nama singkat" hint="Tampil di bawah ikon aplikasi di HP (maks 12 huruf).">
        {(id) => (
          <Input
            id={id}
            value={namaSingkat}
            maxLength={12}
            onChange={(e) => setNamaSingkat(e.target.value)}
            required
          />
        )}
      </Field>
      <Field label="Alamat">
        {(id) => <Textarea id={id} value={alamat} onChange={(e) => setAlamat(e.target.value)} />}
      </Field>
      <Field
        label="Zona waktu"
        hint="Dipakai untuk menentukan 'hari ini' (presensi, tagihan, jadwal)."
      >
        {(id) => (
          <select
            id={id}
            className={inputClass}
            value={zonaWaktu}
            onChange={(e) => setZonaWaktu(e.target.value)}
          >
            {ZONA_WAKTU.map((z) => (
              <option key={z} value={z}>
                {ZONA_LABEL[z]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <ErrorAlert>{error}</ErrorAlert>
      {saved && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium text-on-soft">
          Tersimpan.
        </p>
      )}
      <Button type="submit" loading={save.isPending}>
        Simpan identitas
      </Button>
    </form>
  );
}

function LogoForm({ data }: { data: Identitas }) {
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<{ url: string; label: string }[]>([]);
  const [error, setError] = useState("");
  const [set, setSet] = useState<Awaited<ReturnType<typeof makeLogoSet>> | null>(null);

  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  async function pick(f: File | undefined) {
    setError("");
    setSet(null);
    setPreviews([]);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024)
      return setError("Gambar terlalu besar (maks 10 MB sebelum dikecilkan).");
    try {
      const s = await makeLogoSet(f);
      setFile(f);
      setSet(s);
      setPreviews([
        { url: URL.createObjectURL(s.ikon192), label: "Ikon 192" },
        { url: URL.createObjectURL(s.ikon512), label: "Ikon 512" },
        { url: URL.createObjectURL(s.ikonMaskable), label: "Maskable (Android)" },
      ]);
    } catch {
      setError("Gambar tidak bisa dibaca. Pakai PNG, JPG, atau WebP.");
    }
  }

  const upload = useMutation({
    mutationFn: async () => {
      if (!set) throw new Error("Pilih logo dulu");
      const form = new FormData();
      form.set("logo", set.logo, file?.name.replace(/\.\w+$/, ".png") ?? "logo.png");
      form.set("ikon192", set.ikon192, "ikon-192.png");
      form.set("ikon512", set.ikon512, "ikon-512.png");
      form.set("ikonMaskable", set.ikonMaskable, "ikon-maskable-512.png");
      const res = await fetch("/api/pengaturan/logo", { method: "POST", body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Gagal mengunggah");
      return body as Identitas;
    },
    onSuccess: () => {
      setSet(null);
      queryClient.invalidateQueries();
    },
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-[22px] border border-border bg-white">
          {data.logoId ? (
            <img
              src={`/api/files/${data.logoId}`}
              alt="Logo saat ini"
              className="size-full object-contain"
            />
          ) : (
            <span className="text-sm text-text2">Belum ada</span>
          )}
        </span>
        <p className="text-sm text-text2">
          Logo dipakai di halaman masuk, cetak, dan ikon aplikasi. Setelah logo diganti, pengguna
          iPhone perlu memasang ulang aplikasi agar ikonnya ikut berubah.
        </p>
      </div>
      <label className="flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface-raised p-4 font-semibold hover:border-primary">
        <ImageUp className="text-primary" /> {file ? file.name : "Pilih gambar logo"}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </label>
      {previews.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {previews.map((p) => (
            <figure key={p.label} className="text-center text-xs text-text2">
              <img
                src={p.url}
                alt={p.label}
                className="size-20 rounded-[18px] border border-border"
              />
              <figcaption className="mt-1">{p.label}</figcaption>
            </figure>
          ))}
        </div>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {upload.isSuccess && (
        <p role="status" className="rounded-2xl bg-soft px-4 py-3 text-sm font-medium text-on-soft">
          Logo & ikon tersimpan.
        </p>
      )}
      <Button disabled={!set} loading={upload.isPending} onClick={() => upload.mutate()}>
        Unggah logo
      </Button>
    </div>
  );
}

export function PengaturanPage() {
  const { data: me } = useMe();
  const ident = useQuery({
    queryKey: ["identitas"],
    queryFn: () => api<Identitas>("/pengaturan/identitas"),
  });
  if (!me?.isAdmin) {
    return (
      <EmptyState icon={ShieldAlert} title="Tidak punya akses">
        Pengaturan hanya untuk admin.
      </EmptyState>
    );
  }
  return (
    <>
      <PageHeader
        title="Pengaturan"
        subtitle="Identitas lembaga, logo, tagihan, WA gateway, dan payment gateway."
      />
      {ident.isError && <ErrorAlert>{errorMessage(ident.error)}</ErrorAlert>}
      {ident.data && (
        <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
          <Card className="lg:col-span-7">
            <h2 className="mb-4 text-lg font-semibold">Identitas</h2>
            <IdentitasForm key={ident.dataUpdatedAt} data={ident.data} />
          </Card>
          <Card className="lg:col-span-5">
            <h2 className="mb-4 text-lg font-semibold">Logo & ikon aplikasi</h2>
            <LogoForm data={ident.data} />
          </Card>
          <PengaturanKeuanganCards />
        </div>
      )}
    </>
  );
}
