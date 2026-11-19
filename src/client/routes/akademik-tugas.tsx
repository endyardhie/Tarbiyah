import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, FileText, Paperclip, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { ListSkeleton } from "../components/MasterList";
import { EmptyState } from "../components/Page";
import type { Ajar, Tugas } from "../lib/akademik";
import { api, errorMessage, queryClient } from "../lib/api";
import { formatTanggal, formatWaktu } from "../lib/format";
import { compressPhoto } from "../lib/image";
import { tglDate, useHariIni } from "../lib/presensi";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, Input, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";

export function LampiranLink({ l }: { l: { id: string; namaAsli: string } }) {
  return (
    <a
      href={`/api/files/${l.id}`}
      target="_blank"
      rel="noopener"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface-muted px-3 text-sm font-medium hover:bg-soft"
    >
      <FileText size={16} /> <span className="max-w-48 truncate">{l.namaAsli}</span>
    </a>
  );
}

function TugasForm({
  ajar,
  tugas,
  onDone,
}: {
  ajar: Ajar;
  tugas: Tugas | null;
  onDone: () => void;
}) {
  const hari = useHariIni();
  const [judul, setJudul] = useState(tugas?.judul ?? "");
  const [deskripsi, setDeskripsi] = useState(tugas?.deskripsi ?? "");
  const [tanggalDiberi, setTanggal] = useState(tugas?.tanggalDiberi ?? hari.data?.tanggal ?? "");
  const [tenggat, setTenggat] = useState(tugas?.tenggat ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const body = { pengajaranId: ajar.id, judul, deskripsi, tanggalDiberi, tenggat };
      const saved = tugas
        ? await api<Tugas>(`/tugas/${tugas.id}`, { method: "PATCH", body })
        : await api<Tugas>("/tugas", { body });
      for (const [i, f] of files.entries()) {
        setProgress(`Mengunggah lampiran ${i + 1}/${files.length}…`);
        const small = await compressPhoto(f);
        if (small.size > (small.type === "application/pdf" ? 5 : 2) * 1024 * 1024) {
          throw new Error(`${f.name} terlalu besar (gambar maks 2 MB, PDF maks 5 MB)`);
        }
        const form = new FormData();
        form.set("berkas", small, small.name);
        const res = await fetch(`/api/tugas/${saved.id}/lampiran`, { method: "POST", body: form });
        if (!res.ok)
          throw new Error(
            (await res.json().catch(() => null))?.error ?? "Gagal mengunggah lampiran",
          );
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tugas"] });
      onDone();
    },
    onError: (e) => {
      setProgress("");
      setError(errorMessage(e));
      queryClient.invalidateQueries({ queryKey: ["tugas"] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    save.mutate();
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Judul">
        {(id) => (
          <Input
            id={id}
            value={judul}
            onChange={(e) => setJudul(e.target.value)}
            required
            maxLength={150}
          />
        )}
      </Field>
      <Field label="Keterangan">
        {(id) => (
          <Textarea
            id={id}
            rows={4}
            value={deskripsi}
            onChange={(e) => setDeskripsi(e.target.value)}
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Diberikan">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={tanggalDiberi}
              onChange={(e) => setTanggal(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Tenggat">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={tenggat}
              min={tanggalDiberi}
              onChange={(e) => setTenggat(e.target.value)}
            />
          )}
        </Field>
      </div>
      <label className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface-raised p-3 font-semibold hover:border-primary">
        <Paperclip size={18} className="text-primary" />
        {files.length ? `${files.length} berkas dipilih` : "Lampiran foto/PDF (opsional)"}
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="sr-only"
          onChange={(e) => setFiles([...(e.target.files ?? [])].slice(0, 5))}
        />
      </label>
      <p className="text-sm text-text2">Foto otomatis dikecilkan (±300 KB). PDF maks 5 MB.</p>
      {progress && (
        <p role="status" className="text-sm text-text2">
          {progress}
        </p>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      <Button type="submit" loading={save.isPending} className="w-full sm:w-auto">
        Simpan tugas
      </Button>
    </form>
  );
}

export function TugasTab({ ajar }: { ajar: Ajar }) {
  const list = useQuery({
    queryKey: ["tugas", ajar.id],
    queryFn: () => api<Tugas[]>(`/tugas?pengajaranId=${ajar.id}`),
  });
  const [editing, setEditing] = useState<Tugas | "baru" | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["tugas"] });
  const kirim = useMutation({
    mutationFn: (id: string) =>
      api<{ penerima: number }>(`/tugas/${id}/notifikasi`, { method: "POST" }),
    onSuccess: refresh,
  });
  const hapus = useMutation({
    mutationFn: (id: string) => api(`/tugas/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const hapusLampiran = useMutation({
    mutationFn: ({ tugasId, berkasId }: { tugasId: string; berkasId: string }) =>
      api(`/tugas/${tugasId}/lampiran/${berkasId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-3">
      {ajar.bisaIsi && (
        <Button onClick={() => setEditing("baru")}>
          <Plus size={18} /> Tugas baru
        </Button>
      )}
      <ErrorAlert>
        {kirim.isError ? errorMessage(kirim.error) : hapus.isError ? errorMessage(hapus.error) : ""}
      </ErrorAlert>
      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
      ) : list.data.length === 0 ? (
        <EmptyState icon={FileText} title="Belum ada tugas">
          Tugas/PR untuk mapel ini akan tampil di sini.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.data.map((t) => (
            <li
              key={t.id}
              className="space-y-2 rounded-card border border-border bg-surface p-4 shadow-soft"
            >
              <p className="font-semibold">{t.judul}</p>
              <p className="text-sm text-text2">
                Diberikan {formatTanggal(tglDate(t.tanggalDiberi), "UTC")}
                {t.tenggat && ` · tenggat ${formatTanggal(tglDate(t.tenggat), "UTC")}`}
              </p>
              {t.deskripsi && <p className="text-sm whitespace-pre-line">{t.deskripsi}</p>}
              <div className="flex flex-wrap gap-2">
                {t.lampiran.map((l) => (
                  <span key={l.id} className="inline-flex items-center">
                    <LampiranLink l={l} />
                    {ajar.bisaIsi && (
                      <button
                        type="button"
                        aria-label={`Hapus lampiran ${l.namaAsli}`}
                        className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
                        onClick={() =>
                          confirm(`Hapus lampiran ${l.namaAsli}?`) &&
                          hapusLampiran.mutate({ tugasId: t.id, berkasId: l.id })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </span>
                ))}
              </div>
              {ajar.bisaIsi && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    variant={t.dinotifikasiAt ? "ghost" : "secondary"}
                    loading={kirim.isPending && kirim.variables === t.id}
                    onClick={() => kirim.mutate(t.id)}
                  >
                    <BellRing size={16} />{" "}
                    {t.dinotifikasiAt
                      ? `Terkirim ${formatWaktu(t.dinotifikasiAt)}`
                      : "Kirim notifikasi"}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(t)}>
                    Ubah
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-danger"
                    onClick={() => confirm(`Hapus tugas "${t.judul}"?`) && hapus.mutate(t.id)}
                  >
                    Hapus
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing === "baru" ? "Tugas baru" : "Ubah tugas"}
      >
        {editing !== null && (
          <TugasForm
            key={editing === "baru" ? "baru" : editing.id}
            ajar={ajar}
            tugas={editing === "baru" ? null : editing}
            onDone={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}
