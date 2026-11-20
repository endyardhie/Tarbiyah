import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  FileUp,
  GraduationCap,
  type LucideIcon,
  MapPin,
  School,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import type { Permission } from "../../shared/permissions";
import { KELOMPOK } from "../../shared/sekolah";
import type { Kelas, Lokasi, Mapel, TahunAjaran, Unit } from "../../shared/types";
import { EntityForm } from "../components/EntityForm";
import { MasterList } from "../components/MasterList";
import { Card, PageHeader } from "../components/Page";
import { api, errorMessage, queryClient } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatTanggal } from "../lib/format";
import { HARI, hariOptions, useGuru, useLokasi, useTahunAjaran, useUnits } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, inputBase, inputClass } from "../ui/Field";
import { Modal } from "../ui/Modal";

type HubItem = {
  to: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  show: (me: Parameters<typeof hasPermission>[0]) => boolean;
};
const staf = (me: Parameters<typeof hasPermission>[0]) =>
  !!me &&
  (me.isAdmin ||
    me.user.roles.length > 0 ||
    me.relasi.kelasWali.length > 0 ||
    me.relasi.pengajaran.length > 0);
const perm = (p: Permission) => (me: Parameters<typeof hasPermission>[0]) => hasPermission(me, p);

const HUB: HubItem[] = [
  {
    to: "/sekolah/santri",
    icon: GraduationCap,
    title: "Santri",
    desc: "Data santri & kelasnya",
    show: staf,
  },
  {
    to: "/sekolah/wali",
    icon: Users,
    title: "Wali santri",
    desc: "Akun wali & hubungan ke santri",
    show: perm("wali.kelola"),
  },
  {
    to: "/sekolah/kelas",
    icon: School,
    title: "Kelas",
    desc: "Kelas per tahun ajaran & wali kelas",
    show: staf,
  },
  {
    to: "/sekolah/mapel",
    icon: BookOpen,
    title: "Mata pelajaran",
    desc: "Nama mapel (+ tulisan Arab)",
    show: staf,
  },
  {
    to: "/sekolah/pengajaran",
    icon: CalendarDays,
    title: "Pengajaran & jadwal",
    desc: "Guru per mapel, jadwal per kelas & guru",
    show: staf,
  },
  {
    to: "/sekolah/struktur",
    icon: MapPin,
    title: "Lokasi, unit & tahun ajaran",
    desc: "Struktur lembaga & libur mingguan",
    show: perm("pengaturan.kelola"),
  },
  {
    to: "/sekolah/tahun-baru",
    icon: CalendarPlus,
    title: "Tahun ajaran baru",
    desc: "Naik kelas massal, salin kelas & tarif",
    show: (me) => !!me?.isAdmin,
  },
  {
    to: "/sekolah/impor",
    icon: FileUp,
    title: "Impor CSV",
    desc: "Santri & wali sekaligus dari Excel/CSV",
    show: (me) => hasPermission(me, "santri.kelola") && hasPermission(me, "wali.kelola"),
  },
];

export function SekolahPage() {
  const { data: me } = useMe();
  return (
    <>
      <PageHeader
        title="Data Sekolah"
        subtitle="Struktur lembaga, kelas, mapel, santri, dan wali."
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {HUB.filter((h) => h.show(me)).map(({ to, icon: Icon, title, desc }) => (
          <Link key={to} to={to} className="group">
            <Card className="flex h-full items-center gap-4 transition-colors group-hover:border-primary">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-soft text-on-soft">
                <Icon size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-text2">{desc}</p>
              </div>
              <ChevronRight className="shrink-0 text-text2" />
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}

const Badge = ({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "soft" | "warn";
}) => (
  <span
    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${
      tone === "soft"
        ? "bg-soft text-on-soft"
        : tone === "warn"
          ? "bg-warn-soft text-warn"
          : "bg-surface-muted text-text2"
    }`}
  >
    {children}
  </span>
);

export { Badge };

function SemesterList({ ta, canEdit }: { ta: TahunAjaran; canEdit: boolean }) {
  const [adding, setAdding] = useState(false);
  const activate = useMutation({
    mutationFn: (id: string) => api(`/semester/${id}/aktifkan`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tahun-ajaran"] }),
  });
  return (
    <div className="mt-2 space-y-1">
      {ta.semester.map((s) => (
        <div key={s.id} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">Semester {s.nomor}</span>
          <span className="text-text2">
            {formatTanggal(new Date(`${s.mulai}T00:00:00`), "UTC")} –{" "}
            {formatTanggal(new Date(`${s.selesai}T00:00:00`), "UTC")}
          </span>
          {s.aktif ? (
            <Badge tone="soft">Aktif</Badge>
          ) : (
            canEdit && (
              <button
                type="button"
                className="min-h-11 px-2 font-semibold text-primary"
                onClick={() => activate.mutate(s.id)}
              >
                Aktifkan
              </button>
            )
          )}
        </div>
      ))}
      {canEdit && ta.semester.length < 2 && (
        <button
          type="button"
          className="min-h-11 text-sm font-semibold text-primary"
          onClick={() => setAdding(true)}
        >
          + Tambah semester
        </button>
      )}
      <Modal open={adding} onOpenChange={setAdding} title={`Semester · ${ta.nama}`}>
        <EntityForm
          endpoint="/semester"
          initial={{ tahunAjaranId: ta.id, nomor: ta.semester.length + 1 }}
          fields={[
            { name: "tahunAjaranId", label: "", type: "hidden" },
            {
              name: "nomor",
              label: "Semester",
              type: "select",
              options: [
                { value: "1", label: "1" },
                { value: "2", label: "2" },
              ],
              required: true,
            },
            { name: "mulai", label: "Mulai", type: "date", required: true },
            { name: "selesai", label: "Selesai", type: "date", required: true },
          ]}
          invalidate={[["tahun-ajaran"]]}
          onDone={() => setAdding(false)}
        />
      </Modal>
    </div>
  );
}

function LiburMingguan({ canEdit }: { canEdit: boolean }) {
  const units = useUnits();
  const lokasi = useLokasi();
  const list = useQuery({
    queryKey: ["libur-mingguan"],
    queryFn: () =>
      api<{ id: string; hari: number; unitId: string | null; lokasiId: string | null }[]>(
        "/libur-mingguan",
      ),
  });
  const [hari, setHari] = useState("5");
  const [unitId, setUnitId] = useState("");
  const [lokasiId, setLokasiId] = useState("");
  const done = () => queryClient.invalidateQueries({ queryKey: ["libur-mingguan"] });
  const add = useMutation({
    mutationFn: () =>
      api("/libur-mingguan", {
        body: { hari, unitId: unitId || null, lokasiId: lokasiId || null },
      }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/libur-mingguan/${id}`, { method: "DELETE" }),
    onSuccess: done,
  });
  const nama = (
    id: string | null,
    rows: { id: string; nama?: string; kode?: string }[] | undefined,
    semua: string,
  ) =>
    id
      ? (rows?.find((r) => r.id === id)?.kode ?? rows?.find((r) => r.id === id)?.nama ?? "?")
      : semua;

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Libur mingguan</h2>
        <p className="text-sm text-text2">
          Hari tanpa presensi. Bisa untuk semua, atau unit/lokasi tertentu.
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {list.data?.map((l) => (
          <li
            key={l.id}
            className="flex items-center gap-1 rounded-full border border-border bg-surface py-1 pr-1 pl-4"
          >
            <span className="font-medium">
              {HARI[l.hari]} · {nama(l.unitId, units.data, "semua unit")} ·{" "}
              {nama(l.lokasiId, lokasi.data, "semua lokasi")}
            </span>
            {canEdit && (
              <button
                type="button"
                aria-label={`Hapus libur ${HARI[l.hari]}`}
                className="grid size-11 place-items-center rounded-full text-danger hover:bg-danger-soft"
                onClick={() => remove.mutate(l.id)}
              >
                <Trash2 size={16} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Hari"
            className={`${inputBase} w-auto`}
            value={hari}
            onChange={(e) => setHari(e.target.value)}
          >
            {hariOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Unit"
            className={`${inputBase} w-auto`}
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
          >
            <option value="">Semua unit</option>
            {units.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.kode}
              </option>
            ))}
          </select>
          <select
            aria-label="Lokasi"
            className={`${inputBase} w-auto`}
            value={lokasiId}
            onChange={(e) => setLokasiId(e.target.value)}
          >
            <option value="">Semua lokasi</option>
            {lokasi.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nama}
              </option>
            ))}
          </select>
          <Button variant="secondary" loading={add.isPending} onClick={() => add.mutate()}>
            Tambah libur
          </Button>
        </div>
      )}
      <ErrorAlert>
        {add.isError ? errorMessage(add.error) : remove.isError ? errorMessage(remove.error) : ""}
      </ErrorAlert>
    </section>
  );
}

export function StrukturPage() {
  const { data: me } = useMe();
  const canEdit = hasPermission(me, "pengaturan.kelola");
  const activate = useMutation({
    mutationFn: (id: string) => api(`/tahun-ajaran/${id}/aktifkan`, { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return (
    <>
      <PageHeader
        title="Lokasi, unit & tahun ajaran"
        subtitle="Struktur lembaga. Hanya admin yang bisa mengubah."
      />
      <div className="space-y-8">
        <MasterList<TahunAjaran>
          title="Tahun ajaran"
          description="Hanya satu yang aktif. Kelas & pendaftaran santri dibuat per tahun ajaran."
          path="/tahun-ajaran"
          queryKey={["tahun-ajaran"]}
          canEdit={canEdit}
          fields={[
            { name: "nama", label: "Nama", placeholder: "2026/2027", required: true },
            { name: "mulai", label: "Mulai", type: "date", required: true },
            { name: "selesai", label: "Selesai", type: "date", required: true },
          ]}
          renderItem={(t) => (
            <>
              <p className="flex items-center gap-2 font-semibold">
                {t.nama} {t.aktif && <Badge tone="soft">Aktif</Badge>}
              </p>
              <SemesterList ta={t} canEdit={canEdit} />
            </>
          )}
          itemAction={(t) =>
            canEdit && !t.aktif ? (
              <Button variant="ghost" className="px-3" onClick={() => activate.mutate(t.id)}>
                Aktifkan
              </Button>
            ) : null
          }
        />
        <MasterList<Lokasi>
          title="Lokasi"
          path="/lokasi"
          queryKey={["lokasi"]}
          canEdit={canEdit}
          fields={[
            { name: "nama", label: "Nama lokasi", placeholder: "KOTA", required: true },
            { name: "alamat", label: "Alamat", type: "textarea" },
            { name: "aktif", label: "Aktif", type: "checkbox" },
          ]}
          renderItem={(l) => (
            <>
              <p className="font-semibold">
                {l.nama} {!l.aktif && <Badge>Nonaktif</Badge>}
              </p>
              {l.alamat && <p className="truncate text-sm text-text2">{l.alamat}</p>}
            </>
          )}
        />
        <MasterList<Unit>
          title="Unit"
          description="Mis. TA, MDTU, MDTW; bisa ditambah SD/SMP/SMA."
          path="/units"
          queryKey={["units"]}
          canEdit={canEdit}
          fields={[
            { name: "kode", label: "Kode", placeholder: "MDTU", required: true },
            { name: "nama", label: "Nama", placeholder: "MDT Ula", required: true },
            { name: "urutan", label: "Urutan tampil", type: "number" },
            { name: "aktif", label: "Aktif", type: "checkbox" },
          ]}
          renderItem={(u) => (
            <p className="font-semibold">
              {u.kode} <span className="font-normal text-text2">· {u.nama}</span>{" "}
              {!u.aktif && <Badge>Nonaktif</Badge>}
            </p>
          )}
        />
        <LiburMingguan canEdit={canEdit} />
      </div>
    </>
  );
}

export function TahunAjaranSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const ta = useTahunAjaran();
  return (
    <select
      aria-label="Tahun ajaran"
      className={`${inputClass} sm:w-48`}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Tahun ajaran aktif</option>
      {ta.data?.map((t) => (
        <option key={t.id} value={t.id}>
          {t.nama}
          {t.aktif ? " (aktif)" : ""}
        </option>
      ))}
    </select>
  );
}

export function KelasPage() {
  const { data: me } = useMe();
  const canEdit = hasPermission(me, "kelas.kelola");
  const [taId, setTaId] = useState("");
  const ta = useTahunAjaran();
  const units = useUnits();
  const lokasi = useLokasi();
  const guru = useGuru(canEdit);
  const activeTa = ta.data?.find((t) => (taId ? t.id === taId : t.aktif));
  const opt = <T,>(rows: T[] | undefined, value: (r: T) => string, label: (r: T) => string) =>
    rows?.map((r) => ({ value: value(r), label: label(r) })) ?? [];

  return (
    <>
      <PageHeader title="Kelas" subtitle="Nama bebas; tingkat dipakai untuk usulan naik kelas." />
      <div className="mb-4">
        <TahunAjaranSelect value={taId} onChange={setTaId} />
      </div>
      {!activeTa && ta.isSuccess ? (
        <ErrorAlert>
          Belum ada tahun ajaran aktif. Admin membuatnya di "Lokasi, unit & tahun ajaran".
        </ErrorAlert>
      ) : (
        <MasterList<Kelas>
          title={`Kelas ${activeTa?.nama ?? ""}`}
          path="/kelas"
          queryKey={["kelas", taId ? `tahunAjaranId=${taId}` : ""]}
          invalidate={[["kelas"]]}
          canEdit={canEdit}
          newInitial={{ tahunAjaranId: activeTa?.id, kelompok: "campur", tingkat: 1 }}
          fields={[
            {
              name: "tahunAjaranId",
              label: "Tahun ajaran",
              type: "select",
              required: true,
              options: opt(
                ta.data,
                (t) => t.id,
                (t) => t.nama,
              ),
            },
            {
              name: "unitId",
              label: "Unit",
              type: "select",
              required: true,
              options: opt(
                units.data,
                (u) => u.id,
                (u) => `${u.kode} · ${u.nama}`,
              ),
            },
            {
              name: "lokasiId",
              label: "Lokasi",
              type: "select",
              required: true,
              options: opt(
                lokasi.data,
                (l) => l.id,
                (l) => l.nama,
              ),
            },
            { name: "nama", label: "Nama kelas", placeholder: "Kelas 1 Banin", required: true },
            {
              name: "tingkat",
              label: "Tingkat",
              type: "number",
              required: true,
              hint: "Angka; naik kelas = tingkat + 1.",
            },
            {
              name: "kelompok",
              label: "Kelompok",
              type: "select",
              required: true,
              options: KELOMPOK.map((k) => ({ value: k, label: k[0]?.toUpperCase() + k.slice(1) })),
            },
            {
              name: "waliKelasId",
              label: "Wali kelas",
              type: "select",
              empty: "Belum ada",
              options: opt(
                guru.data,
                (g) => g.id,
                (g) => g.nama,
              ),
            },
            { name: "aktif", label: "Aktif", type: "checkbox" },
          ]}
          renderItem={(k) => (
            <>
              <p className="font-semibold">
                {k.nama} {!k.aktif && <Badge>Nonaktif</Badge>}
              </p>
              <p className="text-sm text-text2">
                {k.unitKode} · {k.lokasiNama} · {k.jumlahSantri} santri
              </p>
              <p className="text-sm text-text2">Wali kelas: {k.waliKelasNama ?? "—"}</p>
            </>
          )}
        />
      )}
    </>
  );
}

export function MapelPage() {
  const { data: me } = useMe();
  const units = useUnits();
  return (
    <>
      <PageHeader title="Mata pelajaran" subtitle="Nama Arab opsional, tampil di rapor." />
      <MasterList<Mapel>
        title="Mapel"
        path="/mapel"
        queryKey={["mapel"]}
        canEdit={hasPermission(me, "mapel.kelola")}
        fields={[
          { name: "nama", label: "Nama", required: true },
          { name: "namaArab", label: "Nama Arab", dir: "rtl" },
          { name: "kode", label: "Kode" },
          {
            name: "unitId",
            label: "Unit",
            type: "select",
            empty: "Semua unit",
            options: units.data?.map((u) => ({ value: u.id, label: u.kode })) ?? [],
          },
          { name: "aktif", label: "Aktif", type: "checkbox" },
        ]}
        renderItem={(m) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">
                {m.nama} {!m.aktif && <Badge>Nonaktif</Badge>}
              </p>
              <p className="text-sm text-text2">
                {units.data?.find((u) => u.id === m.unitId)?.kode ?? "Semua unit"}
                {m.kode ? ` · ${m.kode}` : ""}
              </p>
            </div>
            {m.namaArab && (
              <p dir="rtl" lang="ar" className="shrink-0 text-lg">
                {m.namaArab}
              </p>
            )}
          </div>
        )}
      />
    </>
  );
}
