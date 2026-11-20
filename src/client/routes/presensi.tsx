import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarOff, CheckCircle2, ClipboardCheck, Printer, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Laporan, PresensiKelas, SantriRow, Status } from "../../shared/types";
import { ListSkeleton } from "../components/MasterList";
import { Card, EmptyState, PageHeader, TabBar } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatTanggal, formatWaktu } from "../lib/format";
import { isPureWali } from "../lib/nav";
import { monthOf, namaPresensi, STATUS, tglDate, useHariIni } from "../lib/presensi";
import { useTahunAjaran } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, inputClass } from "../ui/Field";

type Row = PresensiKelas["santri"][number];

function StatusButtons({
  value,
  onChange,
  nama,
  disabled,
}: {
  value: Status;
  onChange: (s: Status) => void;
  nama: string;
  disabled: boolean;
}) {
  return (
    <div className="flex shrink-0 gap-1" role="group" aria-label={`Status ${nama}`}>
      {STATUS.map((s) => {
        const on = value === s.value;
        return (
          <button
            key={s.value}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            aria-label={`${s.label} — ${nama}`}
            title={s.label}
            onClick={() => onChange(s.value)}
            className={`grid size-11 place-items-center rounded-full text-base font-extrabold transition-colors disabled:cursor-not-allowed ${
              on
                ? `${s.className} text-on-status ring-2 ring-text/20`
                : "border border-border bg-surface text-text2 hover:bg-surface-muted"
            }`}
          >
            {s.value}
          </button>
        );
      })}
    </div>
  );
}

function IsiPresensi({
  kelasList,
  bisaKoreksi,
}: {
  kelasList: { id: string; label: string }[];
  bisaKoreksi: boolean;
}) {
  const [kelasId, setKelasId] = useState(kelasList[0]?.id ?? "");
  const [tanggal, setTanggal] = useState("");
  const q = useQuery({
    queryKey: ["presensi", "kelas", kelasId, tanggal],
    queryFn: () =>
      api<PresensiKelas>(`/presensi?kelasId=${kelasId}${tanggal ? `&tanggal=${tanggal}` : ""}`),
    enabled: !!kelasId,
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [stale, setStale] = useState(false);
  const loadedKey = useRef("");
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (!q.data) return;
    const key = `${q.data.kelas.id}|${q.data.tanggal}`;
    // Data kelas/tanggal yang sama dimuat ulang (mis. setelah pindah aplikasi) saat ada isian
    // belum disimpan: jangan ditimpa diam-diam, beri tahu pengguna.
    if (key === loadedKey.current && dirtyRef.current) {
      setStale(true);
      return;
    }
    loadedKey.current = key;
    setRows(q.data.santri);
    setDirty(false);
    setStale(false);
  }, [q.data]);
  // Cegah kehilangan isian bila halaman ditutup sebelum disimpan.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      api("/presensi", {
        method: "PUT",
        body: {
          kelasId,
          tanggal: q.data?.tanggal,
          items: rows.map((r) => ({
            pendaftaranId: r.pendaftaranId,
            status: r.status,
            keterangan: r.keterangan,
          })),
        },
      }),
    onSuccess: async () => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ["presensi"] });
    },
  });
  const set = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
    setSaved(false);
  };
  const count = useMemo(() => {
    const c = { H: 0, S: 0, I: 0, A: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const namaTampil = useMemo(() => namaPresensi(rows), [rows]);
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        {kelasList.length > 1 && (
          <select
            aria-label="Kelas"
            className={`${inputClass} sm:max-w-sm`}
            value={kelasId}
            onChange={(e) => {
              setKelasId(e.target.value);
              setTanggal("");
            }}
          >
            {kelasList.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        )}
        {bisaKoreksi && d && (
          <input
            type="date"
            aria-label="Tanggal (koreksi)"
            className={`${inputClass} sm:w-48`}
            max={d.hariIni}
            min={d.kelas.taMulai}
            value={tanggal || d.hariIni}
            onChange={(e) => setTanggal(e.target.value === d.hariIni ? "" : e.target.value)}
          />
        )}
      </div>

      {q.isPending ? (
        <ListSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>
      ) : (
        d && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {d.kelas.nama} · {d.kelas.unitKode} {d.kelas.lokasiNama}
                </p>
                <p className="text-sm text-text2">
                  {formatTanggal(tglDate(d.tanggal), "UTC")}
                  {d.tanggal !== d.hariIni && " · koreksi tanggal lampau (tercatat di log)"}
                </p>
              </div>
              {!d.libur && (
                <span
                  role="status"
                  className={`rounded-full px-3 py-1 text-sm font-semibold ${
                    dirty
                      ? "bg-warn-soft text-warn"
                      : d.sesi
                        ? "bg-soft text-on-soft"
                        : "bg-warn-soft text-warn"
                  }`}
                >
                  {dirty
                    ? "Belum disimpan"
                    : d.sesi
                      ? `Tersimpan ${formatWaktu(d.sesi.disimpanAt).split(" ").pop()}`
                      : "Belum diabsen"}
                </span>
              )}
            </div>

            {d.libur ? (
              <EmptyState icon={CalendarOff} title="Hari libur">
                {d.alasan}. Presensi tidak diisi hari ini.
              </EmptyState>
            ) : rows.length === 0 ? (
              <EmptyState icon={ClipboardCheck} title="Belum ada santri">
                Kelas ini belum punya santri aktif.
              </EmptyState>
            ) : (
              <>
                <div className="flex flex-wrap gap-2" aria-label="Ringkasan">
                  {STATUS.map((s) => (
                    <span
                      key={s.value}
                      className={`${s.className} rounded-full px-3 py-1 text-sm font-bold text-on-status`}
                    >
                      {s.label} {count[s.value]}
                    </span>
                  ))}
                </div>
                {stale && (
                  <p
                    role="alert"
                    className="flex flex-wrap items-center gap-3 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn"
                  >
                    Presensi kelas ini baru saja diubah dari perangkat lain. Simpan untuk menimpanya
                    dengan isian Anda, atau muat ulang untuk melihat versi terbaru.
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setDirty(false);
                        setStale(false);
                        if (q.data) setRows(q.data.santri);
                      }}
                    >
                      Muat ulang
                    </Button>
                  </p>
                )}
                {!d.bisaUbah && (
                  <ErrorAlert>
                    Presensi ini hanya bisa dilihat. Koreksi tanggal lampau butuh izin khusus.
                  </ErrorAlert>
                )}
                <ul className="space-y-1.5 pb-28 md:pb-4">
                  {rows.map((r, i) => (
                    <li
                      key={r.pendaftaranId}
                      className="rounded-2xl border border-border bg-surface py-1 pr-1 pl-4"
                    >
                      {/* Satu baris per santri: nama panggilan + tombol H S I A. */}
                      <div className="flex items-center gap-2">
                        <p
                          className="min-w-0 flex-1 truncate text-[15px] font-semibold"
                          title={r.nama}
                        >
                          {namaTampil.get(r.pendaftaranId)}
                        </p>
                        <StatusButtons
                          value={r.status}
                          nama={r.nama}
                          disabled={!d.bisaUbah}
                          onChange={(status) => set(i, { status })}
                        />
                      </div>
                      {(r.status === "S" || r.status === "I") && (
                        <input
                          aria-label={`Keterangan ${r.namaPanggilan || r.nama}`}
                          placeholder="Keterangan (opsional)"
                          className={`${inputClass} mt-1 mb-1 min-h-11`}
                          maxLength={200}
                          disabled={!d.bisaUbah}
                          value={r.keterangan ?? ""}
                          onChange={(e) => set(i, { keterangan: e.target.value })}
                        />
                      )}
                    </li>
                  ))}
                </ul>
                <ErrorAlert>{save.isError ? errorMessage(save.error) : ""}</ErrorAlert>
                {d.bisaUbah && (
                  // Melayang di atas navbar bawah (mobile); menempel di bawah konten (desktop).
                  <div className="fixed inset-x-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-30 md:sticky md:inset-x-auto md:bottom-6 md:flex md:justify-end">
                    <Button
                      className="w-full shadow-soft md:w-auto md:px-8"
                      loading={save.isPending}
                      onClick={() => save.mutate()}
                    >
                      {saved && !dirty ? <CheckCircle2 size={18} /> : <Save size={18} />}
                      {saved && !dirty ? "Tersimpan" : "Simpan presensi"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )
      )}
    </div>
  );
}

type Periode = { jenis: "bulan"; bulan: string } | { jenis: "semester"; semesterId: string };

function LaporanPresensi({
  kelasList,
  anak,
  today,
}: {
  kelasList: { id: string; label: string }[];
  anak: { id: string; label: string }[];
  /** Tanggal hari ini menurut zona waktu sekolah (dari server). */
  today: string;
}) {
  const ta = useTahunAjaran();
  const subjects = anak.length ? anak : kelasList;
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [periode, setPeriode] = useState<Periode>({ jenis: "bulan", bulan: today.slice(0, 7) });
  const [detail, setDetail] = useState(false);
  const semesters =
    ta.data?.flatMap((t) =>
      t.semester.map((s) => ({ ...s, label: `${t.nama} · Semester ${s.nomor}` })),
    ) ?? [];
  const range =
    periode.jenis === "bulan"
      ? monthOf(periode.bulan)
      : (() => {
          const s = semesters.find((x) => x.id === periode.semesterId);
          return s ? { dari: s.mulai, sampai: s.selesai } : null;
        })();
  const param = anak.length ? "santriId" : "kelasId";
  const qs =
    range && subjectId ? `${param}=${subjectId}&dari=${range.dari}&sampai=${range.sampai}` : "";
  const lap = useQuery({
    queryKey: ["presensi", "laporan", qs],
    queryFn: () => api<Laporan>(`/presensi/laporan?${qs}`),
    enabled: !!qs,
  });

  if (!subjects.length) {
    return (
      <EmptyState icon={ClipboardCheck} title="Belum ada data">
        Belum ada kelas atau santri yang bisa Anda lihat.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <select
          aria-label={anak.length ? "Santri" : "Kelas"}
          className={`${inputClass} sm:max-w-xs`}
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
        >
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Jenis periode"
          className={`${inputClass} sm:w-40`}
          value={periode.jenis}
          onChange={(e) =>
            setPeriode(
              e.target.value === "bulan"
                ? { jenis: "bulan", bulan: today.slice(0, 7) }
                : {
                    jenis: "semester",
                    semesterId: semesters.find((s) => s.aktif)?.id ?? semesters[0]?.id ?? "",
                  },
            )
          }
        >
          <option value="bulan">Per bulan</option>
          <option value="semester">Per semester</option>
        </select>
        {periode.jenis === "bulan" ? (
          <input
            type="month"
            aria-label="Bulan"
            className={`${inputClass} sm:w-48`}
            value={periode.bulan}
            onChange={(e) => setPeriode({ jenis: "bulan", bulan: e.target.value })}
          />
        ) : (
          <select
            aria-label="Semester"
            className={`${inputClass} sm:max-w-xs`}
            value={periode.semesterId}
            onChange={(e) => setPeriode({ jenis: "semester", semesterId: e.target.value })}
          >
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <Button
          variant="secondary"
          disabled={!qs}
          onClick={() => window.open(`/cetak/presensi?${qs}`, "_blank", "noopener")}
        >
          <Printer size={18} /> Cetak / PDF
        </Button>
      </div>
      {lap.isPending ? (
        <ListSkeleton />
      ) : lap.isError ? (
        <ErrorAlert>{errorMessage(lap.error)}</ErrorAlert>
      ) : (
        lap.data && (
          <>
            <p className="text-sm text-text2">
              {lap.data.tanggal.length} hari tercatat ·{" "}
              {formatTanggal(tglDate(lap.data.dari), "UTC")} –{" "}
              {formatTanggal(tglDate(lap.data.sampai), "UTC")}
            </p>
            <ul className="grid gap-2 md:grid-cols-2">
              {lap.data.rows.map((r) => (
                <li
                  key={r.pendaftaranId}
                  className="rounded-2xl border border-border bg-surface px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 truncate font-semibold">{r.nama}</p>
                    <span className="shrink-0 font-bold tabular-nums">
                      {r.persen == null ? "—" : `${r.persen.toLocaleString("id-ID")}%`}
                    </span>
                  </div>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${r.persen ?? 0}%` }}
                    />
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-3 text-sm text-text2">
                    {STATUS.map((s) => (
                      <span key={s.value}>
                        {s.label} {r.total[s.value]}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
            {lap.data.tanggal.length > 0 && (
              <>
                <Button variant="ghost" onClick={() => setDetail((x) => !x)}>
                  {detail ? "Sembunyikan" : "Tampilkan"} per tanggal
                </Button>
                {detail && (
                  <div className="overflow-x-auto rounded-2xl border border-border">
                    <table className="min-w-full text-sm">
                      <thead className="bg-surface-muted">
                        <tr>
                          <th className="sticky left-0 bg-surface-muted px-3 py-2 text-left">
                            Nama
                          </th>
                          {lap.data.tanggal.map((t) => (
                            <th key={t} className="px-1.5 py-2 tabular-nums">
                              {Number(t.slice(8))}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lap.data.rows.map((r) => (
                          <tr key={r.pendaftaranId} className="border-t border-border">
                            <td className="sticky left-0 max-w-40 truncate bg-surface px-3 py-1.5">
                              {r.namaPanggilan || r.nama}
                            </td>
                            {lap.data.tanggal.map((t) => {
                              const s = STATUS.find((x) => x.value === r.harian[t]);
                              return (
                                <td key={t} className="px-1 py-1 text-center">
                                  {s ? (
                                    <span
                                      className={`${s.className} inline-grid size-6 place-items-center rounded-full text-xs font-bold text-on-status`}
                                    >
                                      {s.value}
                                    </span>
                                  ) : (
                                    "·"
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )
      )}
    </div>
  );
}

export function PresensiPage() {
  const { data: me } = useMe();
  const wali = isPureWali(me);
  const hari = useHariIni();
  const anakList = useQuery({
    queryKey: ["santri", ""],
    queryFn: () => api<SantriRow[]>("/santri"),
    enabled: wali,
  });
  const isiList = (hari.data?.kelas ?? [])
    .filter((k) => k.bisaIsi)
    .map((k) => ({ id: k.id, label: `${k.nama} · ${k.unitKode} ${k.lokasiNama}` }));
  const lihatList = (hari.data?.kelas ?? []).map((k) => ({
    id: k.id,
    label: `${k.nama} · ${k.unitKode} ${k.lokasiNama}`,
  }));
  const bisaKoreksi = !!me?.isAdmin || !!me?.permissions.includes("presensi.koreksi");
  const [tab, setTab] = useState<"isi" | "laporan" | null>(null);
  const active = tab ?? (isiList.length ? "isi" : "laporan");

  if (hari.isPending) return <ListSkeleton rows={6} />;
  return (
    <>
      <PageHeader
        title="Presensi"
        subtitle={
          wali ? "Kehadiran anak Anda." : "Sekali sehari per santri; bisa diubah sampai 23.59."
        }
      />
      {isiList.length > 0 && (
        <TabBar
          tabs={["isi", "laporan"] as const}
          value={active}
          onChange={setTab}
          label={(t) => (t === "isi" ? "Isi presensi" : "Laporan")}
        />
      )}
      <ErrorAlert>{hari.isError ? errorMessage(hari.error) : ""}</ErrorAlert>
      {active === "isi" && isiList.length > 0 ? (
        <IsiPresensi kelasList={isiList} bisaKoreksi={bisaKoreksi} />
      ) : wali && anakList.isPending ? (
        <ListSkeleton />
      ) : (
        <Card>
          <LaporanPresensi
            kelasList={lihatList}
            anak={wali ? (anakList.data ?? []).map((s) => ({ id: s.id, label: s.nama })) : []}
            today={hari.data?.tanggal ?? new Date().toISOString().slice(0, 10)}
          />
        </Card>
      )}
    </>
  );
}
