import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Download, FileUp, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { KOLOM_IMPOR } from "../../shared/sekolah";
import { Card, EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { downloadText, parseCsv, toCsv } from "../lib/csv";
import { useTahunAjaran } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, inputClass } from "../ui/Field";
import { Badge } from "./sekolah";

type Row = {
  baris: number;
  nis: string;
  nama: string;
  kelas: string | null;
  aksi: "baru" | "ubah";
  wali: { nama: string; nomor: string; hubungan: string; aksi: "baru" | "ada" }[];
  errors: string[];
  warnings: string[];
};
type Ringkasan = {
  santriBaru: number;
  santriUbah: number;
  waliBaru: number;
  waliAda: number;
  barisError: number;
};
type Preview = { rows: Row[]; ringkasan: Ringkasan };
type Hasil = {
  ringkasan: Ringkasan;
  akunBaru: { nama: string; nomor: string; passwordSementara: string }[];
};

const CONTOH = [
  "1001",
  "Ahmad Fauzi",
  "Ahmad",
  "L",
  "Jayapura",
  "2017-03-21",
  "Jl. Contoh No. 1",
  "MDTU",
  "KOTA",
  "Kelas 1 Banin",
  "Budi Santoso",
  "ayah",
  "081234567890",
  "Siti Aminah",
  "ibu",
  "081298765432",
];

export function ImporPage() {
  const { data: me } = useMe();
  const allowed = hasPermission(me, "santri.kelola") && hasPermission(me, "wali.kelola");
  const ta = useTahunAjaran();
  const [taId, setTaId] = useState("");
  const [file, setFile] = useState<{ name: string; rows: Record<string, string>[] } | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(true);
  const [error, setError] = useState("");
  const tahunAjaranId = taId || ta.data?.find((t) => t.aktif)?.id || "";

  const preview = useMutation({
    mutationFn: () =>
      api<Preview>("/impor/santri/pratinjau", { body: { tahunAjaranId, rows: file?.rows } }),
    onError: (e) => setError(errorMessage(e)),
  });
  const commit = useMutation({
    mutationFn: () => api<Hasil>("/impor/santri", { body: { tahunAjaranId, rows: file?.rows } }),
    onSuccess: () => queryClient.invalidateQueries(),
    onError: (e) => setError(errorMessage(e)),
  });

  if (!allowed) {
    return (
      <EmptyState icon={ShieldAlert} title="Tidak punya akses">
        Impor butuh izin kelola santri dan kelola wali.
      </EmptyState>
    );
  }

  async function pick(f: File | undefined) {
    setError("");
    preview.reset();
    commit.reset();
    if (!f) return setFile(null);
    const rows = parseCsv(await f.text());
    if (!rows.length) return setError("File kosong atau bukan CSV.");
    const missing = ["nis", "nama"].filter((k) => !(k in (rows[0] ?? {})));
    if (missing.length)
      return setError(`Kolom wajib tidak ada: ${missing.join(", ")}. Pakai template.`);
    setFile({ name: f.name, rows });
  }

  const r = preview.data;
  const rows = (r?.rows ?? []).filter((x) => !onlyProblems || x.errors.length || x.warnings.length);

  return (
    <>
      <PageHeader
        title="Impor CSV santri & wali"
        subtitle="Untuk input awal banyak santri. Wali dengan nomor HP yang sama digabung jadi satu akun."
      />
      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <Card className="space-y-4 lg:col-span-5">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text2">
            <li>Unduh template, isi di Excel/Google Sheets, simpan sebagai CSV.</li>
            <li>
              Kolom unit = kode unit, lokasi = nama lokasi, kelas = nama kelas di tahun ajaran
              terpilih.
            </li>
            <li>Tanggal lahir YYYY-MM-DD atau DD/MM/YYYY. Hubungan: ayah, ibu, atau wali.</li>
            <li>NIS yang sudah ada akan diperbarui, bukan digandakan.</li>
          </ol>
          <Button
            variant="secondary"
            onClick={() => downloadText("template-impor-santri.csv", toCsv(KOLOM_IMPOR, [CONTOH]))}
          >
            <Download size={18} /> Unduh template
          </Button>
          <select
            aria-label="Tahun ajaran"
            className={inputClass}
            value={taId}
            onChange={(e) => setTaId(e.target.value)}
          >
            <option value="">Tahun ajaran aktif</option>
            {ta.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nama}
              </option>
            ))}
          </select>
          <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-surface-raised p-4 text-center hover:border-primary">
            <FileUp className="text-primary" />
            <span className="font-semibold">{file ? file.name : "Pilih file CSV"}</span>
            {file && <span className="text-sm text-text2">{file.rows.length} baris</span>}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </label>
          <ErrorAlert>{error}</ErrorAlert>
          {!tahunAjaranId && ta.isSuccess && <ErrorAlert>Belum ada tahun ajaran aktif.</ErrorAlert>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!file || !tahunAjaranId}
              loading={preview.isPending}
              onClick={() => preview.mutate()}
            >
              Periksa
            </Button>
            <Button
              disabled={!r || r.ringkasan.barisError > 0 || commit.isSuccess}
              loading={commit.isPending}
              onClick={() => commit.mutate()}
            >
              Simpan impor
            </Button>
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-7">
          {commit.data && (
            <Card className="space-y-3">
              <p className="flex items-center gap-2 font-semibold text-primary">
                <CheckCircle2 /> Impor tersimpan
              </p>
              <p className="text-sm">
                {commit.data.ringkasan.santriBaru} santri baru, {commit.data.ringkasan.santriUbah}{" "}
                diperbarui, {commit.data.ringkasan.waliBaru} akun wali baru,{" "}
                {commit.data.ringkasan.waliAda} wali memakai akun lama.
              </p>
              {commit.data.akunBaru.length > 0 && (
                <>
                  <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
                    Password sementara akun wali baru hanya bisa diunduh sekarang. Simpan dengan
                    aman, bagikan ke masing-masing wali, lalu hapus filenya.
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      downloadText(
                        "password-sementara-wali.csv",
                        toCsv(
                          ["nama", "nomor", "password_sementara"],
                          commit.data.akunBaru.map((a) => [
                            a.nama,
                            `+${a.nomor}`,
                            a.passwordSementara,
                          ]),
                        ),
                      )
                    }
                  >
                    <Download size={18} /> Unduh password sementara
                  </Button>
                </>
              )}
            </Card>
          )}
          {r && (
            <Card className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="soft">{r.ringkasan.santriBaru} santri baru</Badge>
                <Badge>{r.ringkasan.santriUbah} diperbarui</Badge>
                <Badge tone="soft">{r.ringkasan.waliBaru} wali baru</Badge>
                <Badge>{r.ringkasan.waliAda} wali sudah ada</Badge>
                {r.ringkasan.barisError > 0 && (
                  <Badge tone="warn">{r.ringkasan.barisError} baris salah</Badge>
                )}
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-5 accent-[var(--primary)]"
                  checked={onlyProblems}
                  onChange={(e) => setOnlyProblems(e.target.checked)}
                />
                Hanya baris bermasalah
              </label>
              {rows.length === 0 ? (
                <p className="text-sm text-text2">Tidak ada baris bermasalah. Siap disimpan.</p>
              ) : (
                <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
                  {rows.map((x) => (
                    <li
                      key={x.baris}
                      className={`rounded-2xl border px-4 py-3 ${x.errors.length ? "border-danger bg-danger-soft" : "border-border bg-surface"}`}
                    >
                      <p className="font-semibold">
                        Baris {x.baris}: {x.nama || "—"}{" "}
                        <span className="font-normal text-text2">· {x.nis || "tanpa NIS"}</span>
                      </p>
                      <p className="text-sm text-text2">
                        {x.aksi === "baru" ? "Santri baru" : "Diperbarui"} ·{" "}
                        {x.kelas ?? "tanpa kelas"}
                        {x.wali.length > 0 &&
                          ` · wali: ${x.wali.map((w) => `${w.nama} (${w.aksi === "baru" ? "baru" : "sudah ada"})`).join(", ")}`}
                      </p>
                      {x.errors.map((e) => (
                        <p key={e} className="text-sm font-medium text-danger">
                          {e}
                        </p>
                      ))}
                      {x.warnings.map((w) => (
                        <p key={w} className="text-sm text-warn">
                          {w}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
