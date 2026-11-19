import { useMutation, useQuery } from "@tanstack/react-query";
import { Megaphone, Plus } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { Agenda } from "../../shared/types";
import { ListSkeleton } from "../components/MasterList";
import { Card, EmptyState, PageHeader } from "../components/Page";
import {
  type SasaranDraft,
  SasaranEditor,
  sasaranLengkap,
  type Tipe,
  toSasaran,
} from "../components/SasaranEditor";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatWaktu } from "../lib/format";
import { useKelas, useLokasi, useUnits } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { Checkbox, ErrorAlert, Field, Input, Textarea } from "../ui/Field";
import { Modal } from "../ui/Modal";

type Pengumuman = {
  id: string;
  judul: string;
  isi: string;
  dikirimAt: string;
  pengirimNama: string;
  sasaran: Agenda["sasaran"];
};

function PengumumanForm({
  tipe,
  kelasBoleh,
  onDone,
}: {
  tipe: Tipe[];
  kelasBoleh?: (id: string) => boolean;
  onDone: (n: number) => void;
}) {
  const [judul, setJudul] = useState("");
  const [isi, setIsi] = useState("");
  const [kirim, setKirim] = useState(true);
  const [targets, setTargets] = useState<SasaranDraft[]>([{ tipe: tipe[0] ?? "kelas", id: "" }]);
  const [error, setError] = useState("");
  const [penerima, setPenerima] = useState<number | null>(null);
  const lengkap = sasaranLengkap(targets);
  const key = JSON.stringify(targets);

  // Perkiraan jumlah penerima setiap kali sasaran lengkap berubah.
  useEffect(() => {
    setPenerima(null);
    if (!lengkap) return;
    const t = setTimeout(() => {
      api<{ penerima: number }>("/pengumuman/pratinjau", {
        body: { sasaran: toSasaran(JSON.parse(key)) },
      })
        .then((r) => setPenerima(r.penerima))
        .catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [key, lengkap]);

  const save = useMutation({
    mutationFn: () =>
      api<{ penerima: number }>("/pengumuman", {
        body: { judul, isi, sasaran: toSasaran(targets), kirimNotifikasi: kirim },
      }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ["pengumuman"] });
      onDone(r.penerima);
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!lengkap) return setError("Lengkapi pilihan sasaran");
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
            maxLength={120}
          />
        )}
      </Field>
      <Field label="Isi">
        {(id) => (
          <Textarea
            id={id}
            rows={6}
            value={isi}
            onChange={(e) => setIsi(e.target.value)}
            required
            maxLength={5000}
          />
        )}
      </Field>
      <SasaranEditor value={targets} onChange={setTargets} tipe={tipe} kelasBoleh={kelasBoleh} />
      <Checkbox
        label="Kirim notifikasi"
        description="Masuk ke kotak Notifikasi dan push di HP penerima."
        checked={kirim}
        onChange={(e) => setKirim(e.target.checked)}
      />
      {penerima !== null && (
        <p role="status" className="text-sm text-text2">
          Perkiraan penerima: <strong>{penerima}</strong> orang (wali santri & guru terkait).
        </p>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      <Button type="submit" loading={save.isPending} className="w-full sm:w-auto">
        Kirim pengumuman
      </Button>
    </form>
  );
}

export function PengumumanPage() {
  const { data: me } = useMe();
  const list = useQuery({
    queryKey: ["pengumuman"],
    queryFn: () => api<Pengumuman[]>("/pengumuman"),
  });
  const units = useUnits();
  const lokasi = useLokasi();
  const kelas = useKelas();
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const semua = hasPermission(me, "pengumuman.semua");
  const pengajar = (me?.relasi.pengajaran.length ?? 0) > 0;
  const waliKelas = (me?.relasi.kelasWali.length ?? 0) > 0;
  const bisa = semua || pengajar || waliKelas;
  // Sama dengan aturan server (assertBolehKirim).
  const tipe: Tipe[] = semua
    ? ["semua", "unit", "lokasi", "kelas"]
    : pengajar
      ? ["kelas", "unit"]
      : ["kelas"];
  const kelasBoleh =
    semua || pengajar ? undefined : (id: string) => !!me?.relasi.kelasWali.includes(id);
  const label = (s: Agenda["sasaran"][number]) =>
    [
      s.unitId && units.data?.find((u) => u.id === s.unitId)?.kode,
      s.lokasiId && lokasi.data?.find((l) => l.id === s.lokasiId)?.nama,
      s.kelasId && (kelas.data?.find((k) => k.id === s.kelasId)?.nama ?? "Kelas"),
    ]
      .filter(Boolean)
      .join(" · ") || "Seluruh sekolah";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <PageHeader title="Pengumuman" subtitle="Pengumuman untuk Anda dan kelas terkait." />
        {bisa && (
          <Button className="mb-6" onClick={() => setOpen(true)}>
            <Plus size={18} /> Buat pengumuman
          </Button>
        )}
      </div>
      {sent !== null && (
        <p role="status" className="mb-4 rounded-2xl bg-soft px-4 py-3 font-medium text-on-soft">
          Pengumuman terkirim{sent ? ` ke ${sent} penerima` : ""}.
        </p>
      )}
      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
      ) : list.data.length === 0 ? (
        <EmptyState icon={Megaphone} title="Belum ada pengumuman">
          Pengumuman dari sekolah akan muncul di sini.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {list.data.map((p) => (
            <li key={p.id} id={p.id} className="scroll-mt-24">
              <Card className="p-4 md:p-5">
                <h2 className="font-semibold">{p.judul}</h2>
                <p className="mt-1 text-xs text-text2">
                  {p.pengirimNama} · {formatWaktu(p.dikirimAt)} · {p.sasaran.map(label).join(", ")}
                </p>
                <p className="mt-3 whitespace-pre-line">{p.isi}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Modal open={open} onOpenChange={setOpen} title="Buat pengumuman">
        {open && (
          <PengumumanForm
            tipe={tipe}
            kelasBoleh={kelasBoleh}
            onDone={(n) => {
              setSent(n);
              setOpen(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}
