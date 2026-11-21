import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen, FileCog, Plus, Printer, SlidersHorizontal, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { JENIS, JENIS_LABEL, type Jenis, type Skala } from "../../shared/akademik";
import { DEFAULT_TEMPLATE, SAMPLE_CONTEXT } from "../../shared/rapor-template";
import { checkTemplate, renderTemplate } from "../../shared/template";
import type { SantriRow } from "../../shared/types";
import { ListSkeleton } from "../components/MasterList";
import { Card, EmptyState, PageHeader, TabBar } from "../components/Page";
import { ajarLabel, type Lampiran, useAjar } from "../lib/akademik";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatTanggal } from "../lib/format";
import { isPureWali } from "../lib/nav";
import { tglDate } from "../lib/presensi";
import { PRINT_FONTS } from "../lib/print-fonts";
import { kelasLabel, useKelas, useUnits } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, inputBase, inputClass } from "../ui/Field";
import { NilaiTab } from "./akademik-nilai";
import { LampiranLink, TugasTab } from "./akademik-tugas";
import { RaporKelasTab, RaporMapelTab } from "./rapor";
import { Badge } from "./sekolah";

type Tab = "tugas" | "nilai" | "rapor-mapel" | "rapor-kelas" | "anak";
const TAB_LABEL: Record<Tab, string> = {
  tugas: "Tugas/PR",
  nilai: "Nilai",
  "rapor-mapel": "Rapor mapel",
  "rapor-kelas": "Rapor kelas",
  anak: "Anak saya",
};

function AkademikStaf() {
  const { data: me } = useMe();
  const ajar = useAjar();
  const kelas = useKelas();
  const semuaKelas = hasPermission(me, "rapor.kunci") || hasPermission(me, "akademik.lihat_semua");
  const kelasRapor = (kelas.data ?? []).filter(
    (k) => semuaKelas || me?.relasi.kelasWali.includes(k.id),
  );
  const tabs: Tab[] = [
    ...((ajar.data?.length ?? 0) > 0 ? (["tugas", "nilai", "rapor-mapel"] as Tab[]) : []),
    ...(kelasRapor.length ? (["rapor-kelas"] as Tab[]) : []),
    // Guru/wali kelas yang juga wali santri.
    ...(me?.relasi.anak.length ? (["anak"] as Tab[]) : []),
  ];
  const [tab, setTab] = useState<Tab | null>(null);
  const [ajarId, setAjarId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const active = tab ?? tabs[0];
  const pilihAjar = ajar.data?.find((p) => p.id === ajarId) ?? ajar.data?.[0];
  const pilihKelas = kelasId || kelasRapor[0]?.id || "";

  if (ajar.isPending || kelas.isPending) return <ListSkeleton rows={5} />;
  return (
    <>
      {me?.isAdmin && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            to="/akademik/pengaturan"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 font-semibold hover:bg-surface-muted"
          >
            <SlidersHorizontal size={18} /> Bobot, predikat & aspek
          </Link>
          <Link
            to="/akademik/template"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 font-semibold hover:bg-surface-muted"
          >
            <FileCog size={18} /> Template rapor
          </Link>
        </div>
      )}
      {!active ? (
        <EmptyState icon={BookOpen} title="Belum ada mapel atau kelas">
          Anda belum tercatat sebagai guru pengajar atau wali kelas di tahun ajaran aktif.
        </EmptyState>
      ) : (
        <>
          <TabBar tabs={tabs} value={active} onChange={setTab} label={(t) => TAB_LABEL[t]} />
          {active === "anak" ? (
            <AkademikAnak />
          ) : active === "rapor-kelas" ? (
            <>
              {kelasRapor.length > 1 && (
                <select
                  aria-label="Kelas"
                  className={`${inputClass} mb-4 sm:max-w-sm`}
                  value={pilihKelas}
                  onChange={(e) => setKelasId(e.target.value)}
                >
                  {kelasRapor.map((k) => (
                    <option key={k.id} value={k.id}>
                      {kelasLabel(k)}
                    </option>
                  ))}
                </select>
              )}
              {pilihKelas && <RaporKelasTab key={pilihKelas} kelasId={pilihKelas} />}
            </>
          ) : (
            pilihAjar && (
              <>
                {(ajar.data?.length ?? 0) > 1 && (
                  <select
                    aria-label="Mapel & kelas"
                    className={`${inputClass} mb-4 sm:max-w-md`}
                    value={pilihAjar.id}
                    onChange={(e) => setAjarId(e.target.value)}
                  >
                    {ajar.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {ajarLabel(p)}
                        {p.bisaIsi ? "" : " (lihat)"}
                      </option>
                    ))}
                  </select>
                )}
                {active === "tugas" && <TugasTab key={pilihAjar.id} ajar={pilihAjar} />}
                {active === "nilai" && <NilaiTab key={pilihAjar.id} ajar={pilihAjar} />}
                {active === "rapor-mapel" && <RaporMapelTab key={pilihAjar.id} ajar={pilihAjar} />}
              </>
            )
          )}
        </>
      )}
    </>
  );
}

type AnakData = {
  santri: { id: string; nama: string; kelasNama: string; pendaftaranId: string } | null;
  tugas: {
    id: string;
    judul: string;
    deskripsi: string | null;
    tenggat: string | null;
    mapelNama: string;
    lampiran: Lampiran[];
  }[];
  nilai: { mapelNama: string; judul: string; jenis: Jenis; tanggal: string; nilai: number }[];
  rapor: { semesterId: string; nomor: number; status: string }[];
};

function AkademikAnak() {
  const { data: me } = useMe();
  const semua = useQuery({ queryKey: ["santri", ""], queryFn: () => api<SantriRow[]>("/santri") });
  // Untuk guru/wali kelas, /santri juga berisi santri yang diajar; ambil anak sendiri saja.
  const daftar = semua.data?.filter((x) => me?.relasi.anak.includes(x.id)) ?? [];
  const [pilih, setPilih] = useState("");
  const santriId = pilih || daftar[0]?.id || "";
  const q = useQuery({
    queryKey: ["akademik", "anak", santriId],
    queryFn: () => api<AnakData>(`/akademik/anak/${santriId}`),
    enabled: !!santriId,
  });
  const perMapel = useMemo(() => {
    const m = new Map<string, AnakData["nilai"]>();
    for (const n of q.data?.nilai ?? []) m.set(n.mapelNama, [...(m.get(n.mapelNama) ?? []), n]);
    return [...m];
  }, [q.data]);
  if (semua.isPending) return <ListSkeleton />;
  if (!daftar.length)
    return (
      <EmptyState icon={BookOpen} title="Belum terhubung ke santri">
        Hubungi admin sekolah.
      </EmptyState>
    );
  return (
    <div className="space-y-4">
      {daftar.length > 1 && (
        <TabBar
          tabs={daftar.map((a) => a.id)}
          value={santriId}
          onChange={setPilih}
          label={(id) =>
            daftar.find((a) => a.id === id)?.namaPanggilan ||
            daftar.find((a) => a.id === id)?.nama ||
            ""
          }
        />
      )}
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">PR & tugas aktif</h2>
            {q.data.tugas.length === 0 && <p className="text-text2">Tidak ada tugas aktif.</p>}
            {q.data.tugas.map((t) => (
              <div key={t.id} className="space-y-1 rounded-2xl bg-surface-muted p-3">
                <p className="font-semibold">{t.judul}</p>
                <p className="text-sm text-text2">
                  {t.mapelNama}
                  {t.tenggat && ` · tenggat ${formatTanggal(tglDate(t.tenggat), "UTC")}`}
                </p>
                {t.deskripsi && <p className="text-sm whitespace-pre-line">{t.deskripsi}</p>}
                <div className="flex flex-wrap gap-2">
                  {t.lampiran.map((l) => (
                    <LampiranLink key={l.id} l={l} />
                  ))}
                </div>
              </div>
            ))}
          </Card>
          <div className="space-y-4">
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Rapor</h2>
              {q.data.rapor.length === 0 && (
                <p className="text-text2">Rapor tampil di sini setelah final.</p>
              )}
              {q.data.rapor.map((r) => (
                <Button
                  key={r.semesterId}
                  variant="secondary"
                  onClick={() =>
                    window.open(
                      `/cetak/rapor?pendaftaranId=${q.data.santri?.pendaftaranId}&semesterId=${r.semesterId}`,
                      "_blank",
                      "noopener",
                    )
                  }
                >
                  <Printer size={18} /> Rapor semester {r.nomor}
                </Button>
              ))}
            </Card>
            <Card className="space-y-3">
              <h2 className="text-lg font-semibold">Nilai</h2>
              {perMapel.length === 0 && <p className="text-text2">Belum ada nilai.</p>}
              {perMapel.map(([mapelNama, list]) => (
                <div key={mapelNama}>
                  <p className="font-semibold">{mapelNama}</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {list.map((n) => (
                      <li key={`${n.judul}-${n.tanggal}`} className="flex justify-between gap-3">
                        <span className="text-text2">
                          {n.judul}
                          {/* "UAS · UAS" cukup "UAS" */}
                          {![n.jenis, JENIS_LABEL[n.jenis]].some((j) =>
                            n.judul.toLowerCase().startsWith(j.toLowerCase()),
                          ) && ` · ${JENIS_LABEL[n.jenis]}`}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {n.nilai.toLocaleString("id-ID")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export function AkademikPage() {
  const { data: me } = useMe();
  const wali = isPureWali(me);
  return (
    <>
      <PageHeader
        title="Akademik"
        subtitle={wali ? "PR, nilai, dan rapor anak Anda." : "Tugas/PR, nilai, dan rapor."}
      />
      {wali ? <AkademikAnak /> : <AkademikStaf />}
    </>
  );
}

type Aspek = {
  id?: string;
  kelompok: string;
  nama: string;
  tipe: "predikat" | "angka" | "teks";
  aktif: boolean;
};
type Pengaturan = {
  bobot: Record<Jenis, number>;
  skala: Skala[];
  aspek: (Aspek & { id: string })[];
};

function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const units = useUnits();
  return (
    <select
      aria-label="Unit"
      className={`${inputClass} mb-4 sm:max-w-xs`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {units.data?.map((u) => (
        <option key={u.id} value={u.id}>
          {u.kode} · {u.nama}
        </option>
      ))}
    </select>
  );
}

function PengaturanForm({ unitId, data }: { unitId: string; data: Pengaturan }) {
  const [bobot, setBobot] = useState(data.bobot);
  const [skala, setSkala] = useState(data.skala);
  const [aspek, setAspek] = useState<Aspek[]>(data.aspek.filter((a) => a.aktif));
  const [msg, setMsg] = useState("");
  const total = Object.values(bobot).reduce((a, b) => a + b, 0);
  const save = useMutation({
    mutationFn: () =>
      api(`/akademik/pengaturan/${unitId}`, { method: "PUT", body: { bobot, skala, aspek } }),
    onSuccess: async () => {
      setMsg("Tersimpan.");
      await queryClient.invalidateQueries({ queryKey: ["akademik"] });
      await queryClient.invalidateQueries({ queryKey: ["rapor"] });
      // Aspek baru mendapat id dari server; tanpa id, simpan berikutnya membuat aspek ganda.
      const baru = queryClient.getQueryData<Pengaturan>(["akademik", "pengaturan", unitId]);
      if (baru) setAspek(baru.aspek.filter((a) => a.aktif));
    },
    onError: (e) => setMsg(errorMessage(e)),
  });
  const num = (v: string) => Math.max(0, Math.min(100, Number(v) || 0));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Bobot nilai rapor</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {JENIS.map((j) => (
            <label key={j} className="space-y-1 text-sm font-semibold">
              {JENIS_LABEL[j]} (%)
              <input
                type="number"
                min={0}
                max={100}
                className={inputClass}
                value={bobot[j]}
                onChange={(e) => setBobot((b) => ({ ...b, [j]: num(e.target.value) }))}
              />
            </label>
          ))}
        </div>
        <p className={`font-semibold ${total === 100 ? "text-primary" : "text-danger"}`}>
          Total {total}% {total !== 100 && "(harus 100%)"}
        </p>
        <h2 className="pt-2 text-lg font-semibold">Skala predikat</h2>
        <p className="text-sm text-text2">
          Predikat berlaku untuk nilai ≥ batas. Tulis {"{mapel}"} di deskripsi untuk nama mapel.
        </p>
        {skala.map((s, i) => (
          <div key={`${i}-${s.predikat}`} className="flex flex-wrap gap-2">
            <input
              aria-label="Predikat"
              className={`${inputBase} w-16`}
              value={s.predikat}
              maxLength={5}
              onChange={(e) =>
                setSkala((x) => x.map((y, j) => (j === i ? { ...y, predikat: e.target.value } : y)))
              }
            />
            <input
              aria-label="Batas bawah"
              type="number"
              className={`${inputBase} w-20`}
              value={s.min}
              onChange={(e) =>
                setSkala((x) => x.map((y, j) => (j === i ? { ...y, min: num(e.target.value) } : y)))
              }
            />
            <input
              aria-label="Deskripsi bawaan"
              className={`${inputClass} min-w-0 flex-1`}
              value={s.deskripsi}
              onChange={(e) =>
                setSkala((x) =>
                  x.map((y, j) => (j === i ? { ...y, deskripsi: e.target.value } : y)),
                )
              }
            />
            <button
              type="button"
              aria-label="Hapus predikat"
              className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
              onClick={() => setSkala((x) => x.filter((_, j) => j !== i))}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() => setSkala((x) => [...x, { predikat: "", min: 0, deskripsi: "" }])}
        >
          <Plus size={16} /> Predikat
        </Button>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Aspek rapor (non-mapel)</h2>
        <p className="text-sm text-text2">
          Mis. Sikap · Akhlak (predikat), Hafalan · Juz 30 (teks). Diisi wali kelas.
        </p>
        {aspek.map((a, i) => (
          <div key={a.id ?? `baru-${i}`} className="flex flex-wrap gap-2">
            <input
              aria-label="Kelompok"
              placeholder="Kelompok"
              className={`${inputBase} w-32`}
              value={a.kelompok}
              onChange={(e) =>
                setAspek((x) => x.map((y, j) => (j === i ? { ...y, kelompok: e.target.value } : y)))
              }
            />
            <input
              aria-label="Nama aspek"
              placeholder="Nama aspek"
              className={`${inputClass} min-w-0 flex-1`}
              value={a.nama}
              onChange={(e) =>
                setAspek((x) => x.map((y, j) => (j === i ? { ...y, nama: e.target.value } : y)))
              }
            />
            <select
              aria-label="Tipe"
              className={`${inputBase} w-32`}
              value={a.tipe}
              onChange={(e) =>
                setAspek((x) =>
                  x.map((y, j) => (j === i ? { ...y, tipe: e.target.value as Aspek["tipe"] } : y)),
                )
              }
            >
              <option value="predikat">Predikat</option>
              <option value="angka">Angka</option>
              <option value="teks">Teks</option>
            </select>
            <button
              type="button"
              aria-label="Hapus aspek"
              className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
              onClick={() => setAspek((x) => x.filter((_, j) => j !== i))}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() =>
            setAspek((x) => [...x, { kelompok: "", nama: "", tipe: "predikat", aktif: true }])
          }
        >
          <Plus size={16} /> Aspek
        </Button>
      </Card>
      <div className="space-y-2 lg:col-span-2">
        {msg && (
          <p role="status" className="rounded-2xl bg-surface-muted px-4 py-3 text-sm">
            {msg}
          </p>
        )}
        <Button disabled={total !== 100} loading={save.isPending} onClick={() => save.mutate()}>
          Simpan pengaturan
        </Button>
      </div>
    </div>
  );
}

export function PengaturanAkademikPage() {
  const units = useUnits();
  const [unit, setUnit] = useState("");
  const unitId = unit || units.data?.[0]?.id || "";
  const q = useQuery({
    queryKey: ["akademik", "pengaturan", unitId],
    queryFn: () => api<Pengaturan>(`/akademik/pengaturan/${unitId}`),
    enabled: !!unitId,
  });
  return (
    <>
      <PageHeader
        title="Bobot, predikat & aspek"
        subtitle="Per unit. Dipakai untuk nilai rapor otomatis."
      />
      <UnitSelect value={unitId} onChange={setUnit} />
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>
      ) : (
        <PengaturanForm key={unitId} unitId={unitId} data={q.data} />
      )}
    </>
  );
}

function TemplateEditor({
  unitId,
  initial,
}: {
  unitId: string;
  initial: { nama: string; html: string; css: string; bawaan: boolean };
}) {
  const [nama, setNama] = useState(initial.nama);
  const [html, setHtml] = useState(initial.html);
  const [css, setCss] = useState(initial.css);
  const [msg, setMsg] = useState("");
  const err = checkTemplate(html);
  const preview = err
    ? ""
    : `<!doctype html><html><head><meta charset="utf-8"><base href="${window.location.origin}/"><style>${PRINT_FONTS}${css}</style></head><body>${renderTemplate(html, { ...SAMPLE_CONTEXT, draft: false })}</body></html>`;
  const save = useMutation({
    mutationFn: () =>
      api(`/rapor/template/${unitId}`, { method: "PUT", body: { nama, html, css } }),
    onSuccess: () => setMsg("Template tersimpan dan dipakai untuk cetak rapor unit ini."),
    onError: (e) => setMsg(errorMessage(e)),
  });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="space-y-3">
        <input
          aria-label="Nama template"
          className={inputClass}
          value={nama}
          onChange={(e) => setNama(e.target.value)}
        />
        <label className="block text-sm font-semibold">
          HTML
          <textarea
            className={`${inputClass} mt-1 h-80 py-2 font-mono text-xs`}
            spellCheck={false}
            value={html}
            onChange={(e) => setHtml(e.target.value)}
          />
        </label>
        <label className="block text-sm font-semibold">
          CSS
          <textarea
            className={`${inputClass} mt-1 h-48 py-2 font-mono text-xs`}
            spellCheck={false}
            value={css}
            onChange={(e) => setCss(e.target.value)}
          />
        </label>
        <p className="text-xs text-text2">
          Placeholder:{" "}
          {
            "{{santri.nama}} {{santri.nis}} {{kelas.nama}} {{lembaga.nama}} {{lembaga.logo}} {{semester}} {{tahunAjaran}}"
          }
          , daftar{" "}
          {"{{#mapel}}…{{nama}} {{namaArab}} {{nilai}} {{predikat}} {{deskripsi}}…{{/mapel}}"} dan{" "}
          {"{{#aspek}}…{{/aspek}}"},
          {" {{absensi.sakit}} {{catatan}} {{keputusan}} {{tanggalCetak}}"}. Semua nilai otomatis
          di-escape.
        </p>
        <ErrorAlert>{err ? `Template tidak valid: ${err}` : ""}</ErrorAlert>
        {msg && (
          <p role="status" className="rounded-2xl bg-surface-muted px-4 py-3 text-sm">
            {msg}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!err} loading={save.isPending} onClick={() => save.mutate()}>
            Simpan template
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setNama(DEFAULT_TEMPLATE.nama);
              setHtml(DEFAULT_TEMPLATE.html);
              setCss(DEFAULT_TEMPLATE.css);
            }}
          >
            Kembalikan bawaan
          </Button>
          {initial.bawaan && <Badge>Saat ini memakai template bawaan</Badge>}
        </div>
      </Card>
      <Card className="p-2">
        <p className="px-2 pb-2 text-sm text-text2">Pratinjau (data contoh)</p>
        {preview && (
          <iframe
            title="Pratinjau template"
            sandbox=""
            srcDoc={preview}
            className="h-[75dvh] w-full rounded-xl bg-white"
          />
        )}
      </Card>
    </div>
  );
}

export function TemplateRaporPage() {
  const units = useUnits();
  const [unit, setUnit] = useState("");
  const unitId = unit || units.data?.[0]?.id || "";
  const q = useQuery({
    queryKey: ["rapor", "template", unitId],
    queryFn: () =>
      api<{ nama: string; html: string; css: string; bawaan: boolean }>(
        `/rapor/template/${unitId}`,
      ),
    enabled: !!unitId,
  });
  return (
    <>
      <PageHeader title="Template rapor" subtitle="HTML + CSS per unit. Cetak dari browser (A4)." />
      <UnitSelect value={unitId} onChange={setUnit} />
      {q.isPending ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorAlert>{errorMessage(q.error)}</ErrorAlert>
      ) : (
        <TemplateEditor key={unitId} unitId={unitId} initial={q.data} />
      )}
    </>
  );
}
