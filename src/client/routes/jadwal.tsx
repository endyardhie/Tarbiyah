import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { CalendarDays, Printer } from "lucide-react";
import { useState } from "react";
import type { Kelas, Pengajaran, SantriRow } from "../../shared/types";
import { ListSkeleton } from "../components/MasterList";
import { Card, EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatTanggal } from "../lib/format";
import { HARI, kelasLabel, useKelas, usePublicConfig, useTahunAjaran } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, inputClass } from "../ui/Field";

type Slot = {
  hari: number;
  jamMulai: string;
  jamSelesai: string;
  mapel: string;
  mapelArab: string | null;
  guru: string;
};

/** Slot jadwal satu kelas, urut hari lalu jam mulai. */
export function slotKelas(list: Pengajaran[], kelasId: string): Slot[] {
  return list
    .filter((p) => p.kelasId === kelasId)
    .flatMap((p) =>
      p.jadwal.map((j) => ({
        hari: j.hari,
        jamMulai: j.jamMulai,
        jamSelesai: j.jamSelesai,
        mapel: p.mapelNama,
        mapelArab: p.mapelNamaArab,
        guru: p.guruNama,
      })),
    )
    .sort((a, b) => a.hari - b.hari || a.jamMulai.localeCompare(b.jamMulai));
}

// Kunci sama dengan halaman Pengajaran agar data dipakai bersama.
const usePengajaran = () =>
  useQuery({ queryKey: ["pengajaran"], queryFn: () => api<Pengajaran[]>("/pengajaran") });

const bukaCetak = (kelasId?: string) =>
  window.open(`/cetak/jadwal${kelasId ? `?kelasId=${kelasId}` : ""}`, "_blank", "noopener");

/** Jadwal pelajaran per kelas: boleh dilihat semua pengguna. */
export function JadwalPage() {
  const { data: me } = useMe();
  const kelas = useKelas();
  const ajar = usePengajaran();
  const anak = useQuery({
    queryKey: ["santri", ""],
    queryFn: () => api<SantriRow[]>("/santri"),
    enabled: !!me?.relasi.anak.length,
  });
  const [pilih, setPilih] = useState("");
  const daftar = (kelas.data ?? []).filter((k) => k.aktif);
  // Bawaan: kelas yang diwalikan, lalu kelas anak, lalu kelas pertama.
  const usulan = [
    ...(me?.relasi.kelasWali ?? []),
    ...(anak.data ?? []).filter((s) => me?.relasi.anak.includes(s.id)).map((s) => s.kelasId ?? ""),
  ].find((id) => daftar.some((k) => k.id === id));
  const kelasId = pilih || usulan || daftar[0]?.id || "";
  const slots = slotKelas(ajar.data ?? [], kelasId);
  const hariAda = [...new Set(slots.map((s) => s.hari))];

  return (
    <>
      <PageHeader title="Jadwal pelajaran" subtitle="Jadwal semua kelas di tahun ajaran aktif." />
      {kelas.isPending || ajar.isPending ? (
        <ListSkeleton rows={4} />
      ) : kelas.isError || ajar.isError ? (
        <ErrorAlert>{errorMessage(kelas.error ?? ajar.error)}</ErrorAlert>
      ) : daftar.length === 0 ? (
        <EmptyState icon={CalendarDays} title="Belum ada kelas">
          Kelas tahun ajaran aktif belum dibuat.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              aria-label="Kelas"
              className={`${inputClass} sm:w-80`}
              value={kelasId}
              onChange={(e) => setPilih(e.target.value)}
            >
              {daftar.map((k) => (
                <option key={k.id} value={k.id}>
                  {kelasLabel(k)}
                </option>
              ))}
            </select>
            <div className="flex gap-2">
              <Button className="flex-1 sm:flex-none" onClick={() => bukaCetak(kelasId)}>
                <Printer size={18} /> Cetak / PDF
              </Button>
              <Button
                variant="secondary"
                className="flex-1 sm:flex-none"
                onClick={() => bukaCetak()}
              >
                Semua kelas
              </Button>
            </div>
          </div>
          {hariAda.length === 0 ? (
            <EmptyState icon={CalendarDays} title="Jadwal belum diisi">
              Jadwal kelas ini belum diatur di Data Sekolah → Pengajaran & jadwal.
            </EmptyState>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {hariAda.map((h) => (
                <Card key={h} className="space-y-2">
                  <h2 className="text-lg font-bold">{HARI[h]}</h2>
                  <ul className="divide-y divide-border">
                    {slots
                      .filter((s) => s.hari === h)
                      .map((s) => (
                        <li key={`${s.jamMulai}${s.mapel}`} className="flex gap-3 py-2.5">
                          <span className="w-[5.5rem] shrink-0 text-sm font-semibold text-text2 tabular-nums">
                            {s.jamMulai}–{s.jamSelesai}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-semibold">{s.mapel}</span>
                            <span className="block truncate text-sm text-text2">{s.guru}</span>
                            {s.mapelArab && (
                              <span dir="rtl" lang="ar" className="block text-text2">
                                {s.mapelArab}
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function TabelJadwal({ kelas, slots }: { kelas: Kelas; slots: Slot[] }) {
  const hari = [...new Set(slots.map((s) => s.hari))];
  const jam = [...new Set(slots.map((s) => `${s.jamMulai}–${s.jamSelesai}`))].sort();
  return (
    <>
      <p className="mb-2 text-sm">
        <strong>{kelasLabel(kelas)}</strong>
        {kelas.waliKelasNama ? ` · Wali kelas: ${kelas.waliKelasNama}` : ""}
      </p>
      <table className="w-full table-fixed border-collapse text-[9pt]">
        <thead>
          <tr>
            <th className="w-24 border border-black px-1 py-1">Jam</th>
            {hari.map((h) => (
              <th key={h} className="border border-black px-1 py-1">
                {HARI[h]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {jam.map((j) => (
            <tr key={j} className="break-inside-avoid">
              <td className="border border-black px-1 py-1 text-center tabular-nums">{j}</td>
              {hari.map((h) => (
                <td key={h} className="border border-black px-1 py-1 align-top">
                  {slots
                    .filter((s) => s.hari === h && `${s.jamMulai}–${s.jamSelesai}` === j)
                    .map((s) => (
                      <div key={s.mapel}>
                        <p className="font-bold">{s.mapel}</p>
                        <p className="text-[8pt]">{s.guru}</p>
                      </div>
                    ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Cetak jadwal (A4 mendatar): satu kelas (?kelasId=) atau semua kelas, satu kelas per halaman. */
export function CetakJadwalPage() {
  const me = useMe();
  const config = usePublicConfig();
  const ta = useTahunAjaran();
  const kelas = useKelas();
  const ajar = usePengajaran();
  if (me.isSuccess && !me.data) return <Navigate to="/login" />;
  const kelasId = new URLSearchParams(window.location.search).get("kelasId");
  const siap = kelas.data && ajar.data;
  const halaman = (kelas.data ?? [])
    .filter((k) => (kelasId ? k.id === kelasId : k.aktif))
    .map((k) => ({ k, slots: slotKelas(ajar.data ?? [], k.id) }))
    .filter((x) => kelasId || x.slots.length > 0);
  const taNama = ta.data?.find((t) => t.aktif)?.nama;

  return (
    <div className="mx-auto max-w-[277mm] bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex gap-2 print:hidden">
        <Button onClick={() => window.print()} disabled={!siap}>
          Cetak / Simpan PDF
        </Button>
        <Button variant="secondary" onClick={() => window.close()}>
          Tutup
        </Button>
      </div>
      {(kelas.isError || ajar.isError) && (
        <p className="text-red-700">{errorMessage(kelas.error ?? ajar.error)}</p>
      )}
      {!siap ? (
        <p>Memuat…</p>
      ) : halaman.length === 0 ? (
        <p>Belum ada jadwal yang bisa dicetak.</p>
      ) : (
        halaman.map(({ k, slots }) => (
          <section key={k.id} className="break-after-page last:break-after-auto">
            <header className="mb-3 flex items-center gap-4 border-b-2 border-black pb-3">
              {config.data?.logoUrl && (
                <img src={config.data.logoUrl} alt="" className="size-16 object-contain" />
              )}
              <div>
                <p className="text-lg font-bold uppercase">{config.data?.nama}</p>
                <p className="text-sm">
                  Jadwal Pelajaran{taNama ? ` · Tahun Ajaran ${taNama}` : ""}
                </p>
              </div>
            </header>
            {slots.length ? (
              <TabelJadwal kelas={k} slots={slots} />
            ) : (
              <p>{kelasLabel(k)}: jadwal belum diisi.</p>
            )}
            <p className="mt-2 text-[8pt]">Dicetak {formatTanggal(new Date())}.</p>
          </section>
        ))
      )}
    </div>
  );
}
