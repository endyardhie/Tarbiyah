import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CalendarPlus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  KEPUTUSAN,
  KEPUTUSAN_LABEL,
  type Keputusan,
  LANJUT,
  type UsulanTahunBaru,
} from "../../shared/tahun-baru";
import { Card, EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { useMe } from "../lib/auth";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, Input, inputBase } from "../ui/Field";
import { Modal } from "../ui/Modal";

type Kelas = UsulanTahunBaru["kelas"][number];
const label = (k?: Kelas) => (k ? `${k.nama} · ${k.unitKode} ${k.lokasiNama}` : "—");

function Wizard({ data }: { data: UsulanTahunBaru }) {
  const navigate = useNavigate();
  const [langkah, setLangkah] = useState(1);
  const ke = (n: number) => {
    setLangkah(n);
    window.scrollTo({ top: 0 });
  };
  const [ta, setTa] = useState(data.usulan.tahunAjaran);
  const [sem, setSem] = useState(data.usulan.semester);
  const [putusan, setPutusan] = useState(
    () =>
      new Map(
        data.santri.map(
          (s) => [s.santriId, { status: s.status, kelasId: s.kelasTujuanId }] as const,
        ),
      ),
  );
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [error, setError] = useState("");
  const kelasById = useMemo(() => new Map(data.kelas.map((k) => [k.id, k])), [data.kelas]);

  const set = (santriId: string, v: { status: Keputusan; kelasId: string | null }) =>
    setPutusan((m) => new Map(m).set(santriId, v));
  const ubahStatus = (santriId: string, kelasAsal: string, status: Keputusan) => {
    const awal = data.santri.find((s) => s.santriId === santriId);
    const kelasId =
      status === "tinggal"
        ? kelasAsal
        : status === "naik"
          ? (awal?.kelasTujuanId ?? null)
          : LANJUT.includes(status)
            ? (putusan.get(santriId)?.kelasId ?? null)
            : null;
    set(santriId, { status, kelasId });
  };

  const jalan = useMutation({
    mutationFn: () =>
      api<{ kelas: number; tarif: number; keputusan: Record<string, number> }>("/tahun-baru", {
        body: {
          tahunAjaran: ta,
          semester: sem,
          keputusan: [...putusan].map(([santriId, v]) => ({ santriId, ...v })),
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      navigate({ to: "/sekolah" });
    },
    onError: (e) => {
      setKonfirmasi(false);
      setError(errorMessage(e));
    },
  });

  const kurang = [...putusan.values()].filter(
    (v) => LANJUT.includes(v.status) && !v.kelasId,
  ).length;
  const ringkas = KEPUTUSAN.map((k) => ({
    k,
    n: [...putusan.values()].filter((v) => v.status === k).length,
  }));
  const perKelas = data.kelas
    .map((k) => ({
      k,
      n: [...putusan.values()].filter((v) => LANJUT.includes(v.status) && v.kelasId === k.id)
        .length,
    }))
    .filter((x) => x.n);

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm font-semibold" aria-label="Langkah">
        {["Tahun ajaran", "Keputusan santri", "Pratinjau"].map((l, i) => (
          <li
            key={l}
            aria-current={langkah === i + 1 ? "step" : undefined}
            className="rounded-full border border-border px-4 py-2 text-text2 aria-[current=step]:border-transparent aria-[current=step]:bg-soft aria-[current=step]:text-on-soft"
          >
            {i + 1}. {l}
          </li>
        ))}
      </ol>

      {langkah === 1 && (
        <Card className="space-y-4">
          <p className="text-text2">
            Tahun aktif sekarang <strong>{data.taLama.nama}</strong>. Struktur kelas dan tarif SPP
            disalin ke tahun baru; tahun lama menjadi arsip baca-saja.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Nama tahun ajaran">
              {(id) => (
                <Input
                  id={id}
                  value={ta.nama}
                  onChange={(e) => setTa({ ...ta, nama: e.target.value })}
                />
              )}
            </Field>
            <Field label="Mulai">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={ta.mulai}
                  onChange={(e) => setTa({ ...ta, mulai: e.target.value })}
                />
              )}
            </Field>
            <Field label="Selesai">
              {(id) => (
                <Input
                  id={id}
                  type="date"
                  value={ta.selesai}
                  onChange={(e) => setTa({ ...ta, selesai: e.target.value })}
                />
              )}
            </Field>
          </div>
          {sem.map((s, i) => (
            <div key={s.nomor} className="grid gap-4 sm:grid-cols-3">
              <p className="self-end pb-3 font-semibold">Semester {s.nomor}</p>
              <Field label="Mulai">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={s.mulai}
                    onChange={(e) =>
                      setSem(sem.map((x, j) => (j === i ? { ...x, mulai: e.target.value } : x)))
                    }
                  />
                )}
              </Field>
              <Field label="Selesai">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={s.selesai}
                    onChange={(e) =>
                      setSem(sem.map((x, j) => (j === i ? { ...x, selesai: e.target.value } : x)))
                    }
                  />
                )}
              </Field>
            </div>
          ))}
          <Button onClick={() => ke(2)} disabled={!ta.nama || !ta.mulai || !ta.selesai}>
            Lanjut
          </Button>
        </Card>
      )}

      {langkah === 2 && (
        <>
          <p className="text-text2">
            Usulan otomatis: naik ke tingkat berikutnya; kelas tertinggi diusulkan lulus. Ubah per
            santri bila perlu.
          </p>
          {data.kelas.map((asal) => {
            const anggota = data.santri.filter((s) => s.kelasId === asal.id);
            if (!anggota.length) return null;
            return (
              <Card key={asal.id} className="p-0 md:p-0">
                <h2 className="px-5 pt-4 font-semibold md:px-6">
                  {label(asal)}{" "}
                  <span className="font-normal text-text2">· {anggota.length} santri</span>
                </h2>
                <ul className="divide-y divide-border">
                  {anggota.map((s) => {
                    const v = putusan.get(s.santriId) ?? {
                      status: "naik" as Keputusan,
                      kelasId: null,
                    };
                    return (
                      <li
                        key={s.santriId}
                        className="flex flex-col gap-2 px-5 py-3 md:flex-row md:items-center md:px-6"
                      >
                        <span className="min-w-0 flex-1">
                          {s.nama} <span className="text-sm text-text2">· {s.nis}</span>
                        </span>
                        <select
                          aria-label={`Keputusan ${s.nama}`}
                          className={`${inputBase} w-full md:w-44`}
                          value={v.status}
                          onChange={(e) =>
                            ubahStatus(s.santriId, asal.id, e.target.value as Keputusan)
                          }
                        >
                          {KEPUTUSAN.map((k) => (
                            <option key={k} value={k}>
                              {KEPUTUSAN_LABEL[k]}
                            </option>
                          ))}
                        </select>
                        {LANJUT.includes(v.status) && (
                          <select
                            aria-label={`Kelas tujuan ${s.nama}`}
                            className={`${inputBase} w-full md:w-64 ${v.kelasId ? "" : "border-danger"}`}
                            value={v.kelasId ?? ""}
                            onChange={(e) =>
                              set(s.santriId, { ...v, kelasId: e.target.value || null })
                            }
                          >
                            <option value="">Pilih kelas tujuan…</option>
                            {data.kelas.map((k) => (
                              <option key={k.id} value={k.id}>
                                {label(k)}
                              </option>
                            ))}
                          </select>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
          {data.santri.length === 0 && (
            <EmptyState icon={CalendarPlus} title="Tidak ada santri aktif">
              Tahun baru tetap bisa dibuat; struktur kelas dan tarif tetap disalin.
            </EmptyState>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => ke(1)}>
              Kembali
            </Button>
            <Button onClick={() => ke(3)} disabled={kurang > 0}>
              {kurang > 0 ? `${kurang} santri belum punya kelas tujuan` : "Lihat pratinjau"}
            </Button>
          </div>
        </>
      )}

      {langkah === 3 && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">
            {data.taLama.nama} → {ta.nama}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {ringkas.map(({ k, n }) => (
              <li key={k} className="rounded-2xl bg-surface-muted px-3 py-2">
                <span className="block text-sm text-text2">{KEPUTUSAN_LABEL[k]}</span>
                <span className="text-xl font-bold">{n}</span>
              </li>
            ))}
          </ul>
          <div>
            <h3 className="mb-1 font-semibold">Isi kelas di tahun baru</h3>
            <ul className="divide-y divide-border text-sm">
              {perKelas.map(({ k, n }) => (
                <li key={k.id} className="flex justify-between py-1.5">
                  <span>{label(kelasById.get(k.id))}</span>
                  <span className="font-semibold">{n} santri</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn">
            {data.potongan > 0 &&
              `Potongan/beasiswa santri yang tetap belajar ikut disalin (${data.potongan} data tahun ini). `}
            Setelah dijalankan, tahun {ta.nama} langsung aktif dan tahun {data.taLama.nama} hanya
            bisa dibaca. Santri pindah/lulus tidak lagi ditagih. Pengajaran guru diatur ulang di
            Data Sekolah › Pengajaran.
          </p>
          <ErrorAlert>{error}</ErrorAlert>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => ke(2)}>
              Kembali
            </Button>
            <Button onClick={() => setKonfirmasi(true)}>Jalankan</Button>
          </div>
        </Card>
      )}

      <Modal open={konfirmasi} onOpenChange={setKonfirmasi} title="Mulai tahun ajaran baru?">
        <p className="mb-4">
          {ta.nama} dibuat dan diaktifkan. Langkah ini tidak bisa dibatalkan dari aplikasi (gunakan
          restore backup bila keliru).
        </p>
        <Button className="w-full" loading={jalan.isPending} onClick={() => jalan.mutate()}>
          Ya, jalankan
        </Button>
      </Modal>
    </div>
  );
}

export function TahunBaruPage() {
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ["tahun-baru"],
    queryFn: () => api<UsulanTahunBaru>("/tahun-baru"),
    enabled: !!me?.isAdmin,
  });
  if (!me?.isAdmin) {
    return (
      <EmptyState icon={CalendarPlus} title="Tidak punya akses">
        Wizard tahun ajaran baru hanya untuk admin.
      </EmptyState>
    );
  }
  return (
    <>
      <PageHeader
        title="Tahun ajaran baru"
        subtitle="Naik kelas massal dan salin struktur kelas."
      />
      {q.isError && <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>}
      {q.isPending ? (
        <div className="h-48 animate-pulse rounded-card bg-surface-muted" />
      ) : (
        q.data && <Wizard data={q.data} />
      )}
    </>
  );
}
