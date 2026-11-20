import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CloudDownload,
  DatabaseBackup,
  Download,
  LoaderCircle,
  RotateCcw,
  Upload,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import type { BackupRow, PengaturanBackupView, StatusPemeliharaan } from "../../shared/backup";
import { Card, EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatWaktu } from "../lib/format";
import { usePublicConfig } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input } from "../ui/Field";
import { Modal } from "../ui/Modal";

const JENIS: Record<BackupRow["jenis"], string> = {
  otomatis: "Otomatis",
  manual: "Manual",
  pra_restore: "Sebelum restore",
  unggahan: "Unggahan",
  dari_b2: "Dari B2",
};

export const ukuran = (n: number | null) =>
  n == null
    ? "—"
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(0)} KB`
      : `${(n / 1024 ** 2).toFixed(1)} MB`;

type Ringkasan = {
  terakhir: { nama: string; dibuatAt: string; b2Key: string | null } | null;
  berkasBelumTersalin: number;
  b2Aktif: boolean;
  intervalHari: number;
};

export const useRingkasanBackup = (enabled = true) =>
  useQuery({
    queryKey: ["backup", "ringkasan"],
    queryFn: () => api<Ringkasan>("/backup/ringkasan"),
    enabled,
  });

function PengaturanForm({ data }: { data: PengaturanBackupView }) {
  const [v, setV] = useState({ ...data, appKey: "" });
  const [error, setError] = useState("");
  const [info, setInfo] = useState<{ ok: boolean; pesan: string } | null>(null);
  const simpan = useMutation({
    mutationFn: () => api("/backup/pengaturan", { method: "PUT", body: v }),
    onSuccess: () => {
      setInfo({ ok: true, pesan: "Tersimpan." });
      queryClient.invalidateQueries({ queryKey: ["backup"] });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const tes = useMutation({
    mutationFn: () => api<{ ok: boolean; pesan: string }>("/backup/tes-b2", { method: "POST" }),
    onSuccess: setInfo,
    onError: (e) => setInfo({ ok: false, pesan: errorMessage(e) }),
  });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setInfo(null);
    simpan.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Backup otomatis tiap (hari)">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={30}
              value={v.intervalHari}
              onChange={(e) => setV({ ...v, intervalHari: Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label="Simpan di server (jumlah dump)" hint="Di B2 diatur lifecycle rules bucket.">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={50}
              value={v.simpanDiServer}
              onChange={(e) => setV({ ...v, simpanDiServer: Number(e.target.value) })}
            />
          )}
        </Field>
      </div>
      <Checkbox
        label="Salin backup ke Backblaze B2"
        description="Database ke tarbiyah/db/, berkas ke tarbiyah/files/. Kunci B2 sebaiknya tanpa izin hapus."
        checked={v.b2Aktif}
        onChange={(e) => setV({ ...v, b2Aktif: e.target.checked })}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Endpoint S3" hint="Mis. https://s3.us-east-005.backblazeb2.com">
          {(id) => (
            <Input id={id} autoComplete="off" value={v.endpoint} onChange={set("endpoint")} />
          )}
        </Field>
        <Field label="Region">
          {(id) => (
            <Input id={id} value={v.region} onChange={set("region")} placeholder="us-east-005" />
          )}
        </Field>
        <Field label="Bucket">
          {(id) => <Input id={id} value={v.bucket} onChange={set("bucket")} />}
        </Field>
        <Field label="Key ID">
          {(id) => <Input id={id} autoComplete="off" value={v.keyId} onChange={set("keyId")} />}
        </Field>
        <Field
          label="Application key"
          hint={
            data.appKey.terisi ? "Sudah tersimpan. Kosongkan bila tidak diganti." : "Belum diisi."
          }
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={v.appKey}
              onChange={set("appKey")}
            />
          )}
        </Field>
      </div>
      <ErrorAlert>{error}</ErrorAlert>
      {info && (
        <p
          role="status"
          className={`rounded-2xl px-4 py-3 text-sm font-medium ${info.ok ? "bg-soft text-on-soft" : "bg-warn-soft text-warn"}`}
        >
          {info.pesan}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={simpan.isPending}>
          Simpan pengaturan
        </Button>
        <Button variant="secondary" loading={tes.isPending} onClick={() => tes.mutate()}>
          Tes koneksi B2
        </Button>
      </div>
      <p className="text-sm text-text2">Tes koneksi memakai pengaturan yang sudah disimpan.</p>
    </form>
  );
}

type Cek = {
  nama: string;
  versiDump: number | null;
  versiAplikasi: number;
  boleh: boolean;
  pesan: string;
};

function RestoreModal({
  row,
  onClose,
  onMulai,
}: {
  row: BackupRow;
  onClose: () => void;
  onMulai: () => void;
}) {
  const config = usePublicConfig();
  const [ketik, setKetik] = useState("");
  const [error, setError] = useState("");
  const cek = useQuery({
    queryKey: ["backup", "cek", row.id],
    queryFn: () => api<Cek>(`/backup/${row.id}/cek`),
  });
  const mulai = useMutation({
    mutationFn: () => api(`/backup/${row.id}/pulihkan`, { body: { konfirmasi: ketik } }),
    onSuccess: onMulai,
    onError: (e) => setError(errorMessage(e)),
  });
  const nama = config.data?.nama ?? "";
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Pulihkan dari backup">
      <div className="space-y-4">
        <p>
          <strong>{row.nama}</strong> · {formatWaktu(row.dibuatAt)}
        </p>
        {cek.isPending ? (
          <div className="h-12 animate-pulse rounded-2xl bg-surface-muted" />
        ) : cek.isError ? (
          <ErrorAlert>{errorMessage(cek.error)}</ErrorAlert>
        ) : (
          <p
            className={`rounded-2xl px-4 py-3 text-sm font-medium ${cek.data.boleh ? "bg-soft text-on-soft" : "bg-danger-soft text-danger"}`}
          >
            {cek.data.pesan} (skema backup {cek.data.versiDump ?? "?"}, aplikasi{" "}
            {cek.data.versiAplikasi})
          </p>
        )}
        {cek.data?.boleh && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              mulai.mutate();
            }}
            className="space-y-4"
          >
            <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
              Semua data sekarang diganti isi backup ini. Kondisi sekarang dibackup otomatis lebih
              dulu. Selama proses, aplikasi tidak bisa dipakai siapa pun.
            </p>
            <Field label={`Ketik nama lembaga untuk konfirmasi: ${nama}`}>
              {(id) => (
                <Input
                  id={id}
                  value={ketik}
                  onChange={(e) => setKetik(e.target.value)}
                  autoComplete="off"
                />
              )}
            </Field>
            <ErrorAlert>{error}</ErrorAlert>
            <Button
              type="submit"
              variant="danger"
              className="w-full"
              disabled={ketik.trim() !== nama.trim()}
              loading={mulai.isPending}
            >
              Pulihkan sekarang
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}

/**
 * Layar penuh selama restore (permintaan lain ditolak 503). Hasilnya tetap tampil sampai admin
 * menekan Lanjutkan — sesi ikut berganti dari backup sehingga mungkin perlu masuk lagi.
 */
function ProsesRestore({ status, selesai }: { status?: StatusPemeliharaan; selesai: boolean }) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-bg/95 p-6 text-center"
      role="alertdialog"
      aria-live="polite"
    >
      <div className="max-w-sm space-y-3">
        {selesai && status ? (
          <>
            <p className={`text-lg font-bold ${status.gagal ? "text-danger" : "text-primary"}`}>
              {status.gagal ? "Pemulihan gagal" : "Pemulihan selesai"}
            </p>
            <p className="text-text2">{status.pesan}</p>
            {!status.gagal && (
              <p className="text-sm text-text2">
                Data sesi ikut dipulihkan; bila diminta, masuk lagi dengan akun yang ada di backup.
              </p>
            )}
            <Button className="w-full" onClick={() => window.location.reload()}>
              Lanjutkan
            </Button>
          </>
        ) : status?.aktif && status.gagal ? (
          <>
            <p className="text-lg font-bold text-danger">Aplikasi dikunci</p>
            <p className="text-text2">{status.pesan}</p>
          </>
        ) : (
          <>
            <LoaderCircle size={48} className="mx-auto animate-spin text-primary" />
            <p className="text-lg font-bold">Memulihkan dari backup…</p>
            <p className="text-text2">{status?.aktif ? status.tahap : "Memulai…"}</p>
            <p className="text-sm text-text2">Jangan tutup halaman ini.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function BackupPage() {
  const { data: me } = useMe();
  const [restore, setRestore] = useState<BackupRow | null>(null);
  const [error, setError] = useState("");
  const [b2Terbuka, setB2Terbuka] = useState(false);
  /** Waktu restore dimulai dari halaman ini (ms); query lain ditahan sampai admin menekan Lanjutkan. */
  const [mulaiRestore, setMulaiRestore] = useState<number | null>(null);
  const status = useQuery({
    queryKey: ["backup", "status"],
    queryFn: () => api<StatusPemeliharaan & { sibuk: boolean }>("/backup/status"),
    refetchInterval: (q) =>
      mulaiRestore || q.state.data?.aktif || q.state.data?.sibuk ? 2000 : 15000,
  });
  const tahan = mulaiRestore !== null || !!status.data?.aktif;
  const st = status.data;
  const selesaiRestore =
    mulaiRestore !== null &&
    !!st &&
    !st.aktif &&
    !st.sibuk &&
    !!st.mulaiAt &&
    Date.parse(st.mulaiAt) >= mulaiRestore - 60_000;
  const list = useQuery({
    queryKey: ["backup", "list"],
    queryFn: () => api<BackupRow[]>("/backup"),
    enabled: !!me?.isAdmin && !tahan,
    refetchInterval: status.data?.sibuk ? 3000 : false,
  });
  const setting = useQuery({
    queryKey: ["backup", "pengaturan"],
    queryFn: () => api<PengaturanBackupView>("/backup/pengaturan"),
    enabled: !!me?.isAdmin && !tahan,
  });
  const ringkasan = useRingkasanBackup(!!me?.isAdmin && !tahan);
  const b2 = useQuery({
    queryKey: ["backup", "b2"],
    queryFn: () => api<{ key: string; size: number; lastModified: string | null }[]>("/backup/b2"),
    enabled: b2Terbuka && !tahan,
  });
  const segarkan = () => queryClient.invalidateQueries({ queryKey: ["backup"] });
  const sekarang = useMutation({
    mutationFn: () => api("/backup", { method: "POST" }),
    onSuccess: segarkan,
    onError: (e) => setError(errorMessage(e)),
  });
  const ambil = useMutation({
    mutationFn: (key: string) => api("/backup/b2/ambil", { body: { key } }),
    onSuccess: segarkan,
    onError: (e) => setError(errorMessage(e)),
  });
  const unggah = useMutation({
    mutationFn: async (file: File) => {
      // Body mentah agar server bisa menulis langsung ke disk tanpa memuatnya ke memori.
      const res = await fetch("/api/backup/unggah", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: file,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Gagal mengunggah");
    },
    onSuccess: segarkan,
    onError: (e) => setError(errorMessage(e)),
  });

  if (!me?.isAdmin) {
    return (
      <EmptyState icon={DatabaseBackup} title="Tidak punya akses">
        Backup & restore hanya untuk admin.
      </EmptyState>
    );
  }
  const s = status.data;
  const r = ringkasan.data;
  return (
    <>
      {tahan && <ProsesRestore status={st} selesai={selesaiRestore} />}
      <PageHeader
        title="Backup & restore"
        subtitle="Database penuh + berkas bertahap ke Backblaze B2."
      />
      {s && !s.aktif && s.pesan && (
        <p
          role="status"
          className={`mb-4 rounded-2xl px-4 py-3 text-sm font-medium ${s.gagal ? "bg-danger-soft text-danger" : "bg-soft text-on-soft"}`}
        >
          {s.pesan}
          {!s.gagal && " Bila Anda diminta masuk lagi, itu karena data sesi ikut dipulihkan."}
          {s.detail && (
            <span className="mt-2 block font-mono text-xs break-all whitespace-pre-wrap opacity-80">
              {s.detail}
            </span>
          )}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <Card className="lg:col-span-5">
          <h2 className="mb-3 text-lg font-semibold">Status</h2>
          {r ? (
            <ul className="space-y-2 text-sm">
              <li>
                Backup terakhir berhasil:{" "}
                <strong>{r.terakhir ? formatWaktu(r.terakhir.dibuatAt) : "belum pernah"}</strong>
                {r.terakhir && !r.terakhir.b2Key && r.b2Aktif && (
                  <span className="text-warn"> (belum di B2)</span>
                )}
              </li>
              <li>
                Berkas belum tersalin ke B2: <strong>{r.berkasBelumTersalin}</strong>
              </li>
              <li>
                Backup otomatis tiap <strong>{r.intervalHari} hari</strong>, pukul 02.00 ·{" "}
                {r.b2Aktif ? "B2 aktif" : "B2 belum aktif"}
              </li>
            </ul>
          ) : (
            <div className="h-20 animate-pulse rounded-2xl bg-surface-muted" />
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button loading={sekarang.isPending || s?.sibuk} onClick={() => sekarang.mutate()}>
              <DatabaseBackup size={18} /> Backup sekarang
            </Button>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-raised px-5 font-semibold hover:bg-surface-muted has-[:focus-visible]:ring-2">
              <Upload size={18} /> {unggah.isPending ? "Mengunggah…" : "Unggah backup"}
              <input
                type="file"
                accept=".dump"
                className="sr-only"
                disabled={unggah.isPending}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) unggah.mutate(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="mt-3">
            <ErrorAlert>{error}</ErrorAlert>
          </div>
        </Card>
        <Card className="lg:col-span-7">
          <h2 className="mb-3 text-lg font-semibold">Pengaturan</h2>
          {setting.data ? (
            <PengaturanForm key={setting.dataUpdatedAt} data={setting.data} />
          ) : (
            <div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />
          )}
        </Card>
        <Card className="p-0 md:p-0 lg:col-span-12">
          <h2 className="px-5 pt-5 text-lg font-semibold md:px-6">Daftar backup</h2>
          {list.isError && <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>}
          {list.data?.length === 0 && <p className="px-5 py-3 text-text2">Belum ada backup.</p>}
          <ul className="divide-y divide-border">
            {list.data?.map((b) => (
              <li
                key={b.id}
                className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:px-6"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold break-all">{b.nama}</p>
                  <p className="text-sm text-text2">
                    {JENIS[b.jenis]} · {formatWaktu(b.dibuatAt)} · {ukuran(b.ukuran)} ·{" "}
                    {[b.adaDiServer && "server", b.b2Key && "B2"].filter(Boolean).join(" + ") ||
                      "tidak ada salinan"}
                  </p>
                  {b.status !== "berhasil" && (
                    <p className={`text-sm ${b.status === "gagal" ? "text-danger" : "text-info"}`}>
                      {b.status === "berjalan" ? "Sedang berjalan…" : "Gagal"}
                    </p>
                  )}
                  {b.error && <p className="text-sm text-warn">{b.error}</p>}
                </div>
                {b.status === "berhasil" && b.adaDiServer && (
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`/api/backup/${b.id}/unduh`}
                      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface-raised px-4 font-semibold hover:bg-surface-muted"
                    >
                      <Download size={16} /> Unduh
                    </a>
                    <Button variant="secondary" onClick={() => setRestore(b)}>
                      <RotateCcw size={16} /> Pulihkan
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card className="lg:col-span-12">
          <details onToggle={(e) => setB2Terbuka((e.target as HTMLDetailsElement).open)}>
            <summary className="min-h-11 cursor-pointer content-center text-lg font-semibold">
              Backup di B2 (untuk server baru / dump lama)
            </summary>
            {b2.isPending && b2Terbuka && (
              <div className="mt-2 h-16 animate-pulse rounded-2xl bg-surface-muted" />
            )}
            {b2.isError && <ErrorAlert>{errorMessage(b2.error)}</ErrorAlert>}
            {b2.data?.length === 0 && <p className="mt-2 text-text2">Belum ada dump di B2.</p>}
            <ul className="mt-2 divide-y divide-border">
              {b2.data?.map((o) => (
                <li key={o.key} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 break-all text-sm">
                    {o.key.replace("tarbiyah/db/", "")} · {ukuran(o.size)}
                  </span>
                  <Button
                    variant="secondary"
                    loading={ambil.isPending && ambil.variables === o.key}
                    onClick={() => ambil.mutate(o.key)}
                  >
                    <CloudDownload size={16} /> Ambil ke server
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      </div>
      {restore && (
        <RestoreModal
          row={restore}
          onClose={() => setRestore(null)}
          onMulai={() => {
            setRestore(null);
            setMulaiRestore(Date.now());
          }}
        />
      )}
    </>
  );
}
