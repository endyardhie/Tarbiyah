import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, GraduationCap, Link2, Plus, Search, Unlink, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { RELATION_PERMISSIONS } from "../../shared/permissions";
import { STATUS_SANTRI } from "../../shared/sekolah";
import type { SantriDetail, SantriRow } from "../../shared/types";
import { EntityForm } from "../components/EntityForm";
import { ListSkeleton } from "../components/MasterList";
import { EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage } from "../lib/api";
import { hasPermission, useMe } from "../lib/auth";
import { formatPhone, formatTanggal } from "../lib/format";
import { kelasLabel, useKelas } from "../lib/sekolah";
import { Button } from "../ui/Button";
import { ErrorAlert, inputClass } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { Badge, TahunAjaranSelect } from "./sekolah";
import {
  hubunganLabel,
  LinkForm,
  matches,
  NewWaliForm,
  unlinkSantriWali,
  useWaliList,
} from "./wali";

const statusLabel = { aktif: "Aktif", lulus: "Lulus", pindah: "Pindah", keluar: "Keluar" } as const;

function SantriForm({
  santri,
  taId,
  onDone,
}: {
  santri: (SantriDetail & { kelasId?: string | null }) | null;
  taId: string;
  onDone: (peringatan: string | null) => void;
}) {
  const kelas = useKelas(taId);
  return (
    <EntityForm
      endpoint="/santri"
      id={santri?.id}
      initial={santri ?? { status: "aktif" }}
      invalidate={[["santri"], ["kelas"]]}
      onDone={(r) => onDone((r as { peringatan?: string | null }).peringatan ?? null)}
      fields={[
        { name: "nis", label: "NIS", required: true },
        { name: "nama", label: "Nama lengkap", required: true },
        { name: "namaPanggilan", label: "Nama panggilan", hint: "Dipakai di daftar presensi." },
        {
          name: "jenisKelamin",
          label: "Jenis kelamin",
          type: "select",
          empty: "—",
          options: [
            { value: "L", label: "Laki-laki" },
            { value: "P", label: "Perempuan" },
          ],
        },
        { name: "tempatLahir", label: "Tempat lahir" },
        { name: "tanggalLahir", label: "Tanggal lahir", type: "date" },
        { name: "alamat", label: "Alamat", type: "textarea" },
        {
          name: "kelasId",
          label: "Kelas (tahun ajaran terpilih)",
          type: "select",
          empty: "Belum masuk kelas",
          options: kelas.data?.map((k) => ({ value: k.id, label: kelasLabel(k) })) ?? [],
          hint: "Satu santri satu kelas per tahun ajaran; memilih kelas lain = pindah kelas.",
        },
        {
          name: "status",
          label: "Status",
          type: "select",
          required: true,
          options: STATUS_SANTRI.map((s) => ({ value: s, label: statusLabel[s] })),
        },
      ]}
    />
  );
}

type View = "detail" | "ubah" | "hubungkan" | "wali-baru";

function SantriModal({
  id,
  taId,
  kelasId,
  onClose,
  onWarning,
}: {
  id: string;
  taId: string;
  kelasId: string | null;
  onClose: () => void;
  onWarning: (w: string | null) => void;
}) {
  const { data: me } = useMe();
  const canEdit = hasPermission(me, "santri.kelola");
  const canWali = hasPermission(me, "wali.kelola");
  const [view, setView] = useState<View>("detail");
  const detail = useQuery({
    queryKey: ["santri", "detail", id],
    queryFn: () => api<SantriDetail>(`/santri/${id}`),
  });
  const waliList = useWaliList(view === "hubungkan");
  const unlink = useMutation({
    mutationFn: (userId: string) => unlinkSantriWali(id, userId),
    onSuccess: () => detail.refetch(),
  });
  const s = detail.data;
  const back = () => {
    setView("detail");
    detail.refetch();
  };

  if (detail.isPending) return <ListSkeleton rows={4} />;
  if (detail.isError || !s) return <ErrorAlert>{errorMessage(detail.error)}</ErrorAlert>;
  if (view === "ubah") {
    return (
      <SantriForm
        santri={{ ...s, kelasId }}
        taId={taId}
        onDone={(w) => {
          onWarning(w);
          back();
        }}
      />
    );
  }
  if (view === "wali-baru") return <NewWaliForm santriId={id} onDone={back} />;
  if (view === "hubungkan") {
    return waliList.isPending ? (
      <ListSkeleton />
    ) : (
      <LinkForm
        santriId={id}
        picker={{
          label: "Wali",
          options: (waliList.data ?? [])
            .filter((w) => !s.wali.some((x) => x.userId === w.id))
            .map((w) => ({
              id: w.id,
              label: `${w.nama} · ${w.phones.map((p) => formatPhone(p.nomor)).join(", ")}`,
              search: w.phones.map((p) => p.nomor),
            })),
        }}
        onDone={back}
      />
    );
  }

  const info: [string, string | null][] = [
    ["NIS", s.nis],
    ["Nama panggilan", s.namaPanggilan],
    [
      "Jenis kelamin",
      s.jenisKelamin === "L" ? "Laki-laki" : s.jenisKelamin === "P" ? "Perempuan" : null,
    ],
    [
      "Tempat, tanggal lahir",
      [
        s.tempatLahir,
        s.tanggalLahir && formatTanggal(new Date(`${s.tanggalLahir}T00:00:00Z`), "UTC"),
      ]
        .filter(Boolean)
        .join(", ") || null,
    ],
    ["Alamat", s.alamat],
    ["Status", statusLabel[s.status]],
  ];

  return (
    <div className="space-y-5">
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
        {info.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-sm text-text2">{k}</dt>
            <dd className="font-medium">{v || "—"}</dd>
          </div>
        ))}
      </dl>
      {canEdit && (
        <Button variant="secondary" onClick={() => setView("ubah")}>
          Ubah data santri
        </Button>
      )}
      <section className="space-y-2">
        <h3 className="font-semibold">Riwayat kelas</h3>
        <ul className="space-y-1 text-sm">
          {s.riwayat.map((r) => (
            <li key={r.id}>
              {r.tahunAjaran} · {r.kelasNama} <span className="text-text2">({r.status})</span>
            </li>
          ))}
          {s.riwayat.length === 0 && <li className="text-text2">Belum terdaftar di kelas.</li>}
        </ul>
      </section>
      <section className="space-y-2">
        <h3 className="font-semibold">Wali</h3>
        <ul className="space-y-1">
          {s.wali.map((w) => (
            <li
              key={w.userId}
              className="flex items-center gap-2 rounded-2xl bg-surface-muted py-2 pr-1 pl-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {w.nama} <span className="text-text2">· {hubunganLabel[w.hubungan]}</span>
                </p>
                <p className="text-sm text-text2">
                  {w.nomor.map(formatPhone).join(" · ")}
                  {w.penerimaTagihan ? " · penerima tagihan" : ""}
                </p>
              </div>
              {canWali && (
                <button
                  type="button"
                  aria-label={`Lepas ${w.nama}`}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-danger hover:bg-danger-soft"
                  onClick={() =>
                    confirm(`Lepas ${w.nama} dari santri ini?`) && unlink.mutate(w.userId)
                  }
                >
                  <Unlink size={18} />
                </button>
              )}
            </li>
          ))}
          {s.wali.length === 0 && <li className="text-sm text-warn">Belum ada wali.</li>}
        </ul>
        {canWali && (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setView("hubungkan")}>
              <Link2 size={16} /> Hubungkan wali
            </Button>
            <Button variant="secondary" onClick={() => setView("wali-baru")}>
              <UserPlus size={16} /> Wali baru
            </Button>
          </div>
        )}
        <ErrorAlert>{unlink.isError ? errorMessage(unlink.error) : ""}</ErrorAlert>
      </section>
      <Button variant="ghost" className="w-full" onClick={onClose}>
        Tutup
      </Button>
    </div>
  );
}

export function SantriPage() {
  const { data: me } = useMe();
  const canEdit = hasPermission(me, "santri.kelola");
  const [taId, setTaId] = useState("");
  const [kelasId, setKelasId] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<SantriRow | "baru" | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const kelas = useKelas(taId);
  // Saringan kelas hanya berisi kelas yang boleh dilihat (server tetap memeriksa).
  const lihatSemua =
    !!me?.isAdmin || RELATION_PERMISSIONS["santri.lihat"].some((p) => me?.permissions.includes(p));
  const bolehKelas = new Set([...(me?.relasi.kelasWali ?? []), ...(me?.relasi.kelasAjar ?? [])]);
  const kelasOptions = (kelas.data ?? []).filter((k) => lihatSemua || bolehKelas.has(k.id));
  const params = new URLSearchParams({
    ...(taId && { tahunAjaranId: taId }),
    ...(kelasId && { kelasId }),
  }).toString();
  const list = useQuery({
    queryKey: ["santri", params],
    queryFn: () => api<SantriRow[]>(`/santri?${params}`),
  });
  const shown = useMemo(
    () =>
      (list.data ?? []).filter((s) => matches(q, `${s.nama} ${s.namaPanggilan ?? ""} ${s.nis}`)),
    [list.data, q],
  );
  const kembar = shown.filter((s) => s.panggilanKembar);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4">
        <PageHeader
          title="Santri"
          subtitle="Daftar sesuai hak Anda: semua, kelas Anda, atau anak Anda."
        />
        {canEdit && (
          <Button onClick={() => setOpen("baru")} className="mb-6">
            <Plus size={18} /> Tambah santri
          </Button>
        )}
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <TahunAjaranSelect
          value={taId}
          onChange={(v) => {
            setTaId(v);
            setKelasId("");
          }}
        />
        <select
          aria-label="Kelas"
          className={`${inputClass} sm:w-64`}
          value={kelasId}
          onChange={(e) => setKelasId(e.target.value)}
        >
          <option value="">Semua kelas</option>
          {kelasOptions.map((k) => (
            <option key={k.id} value={k.id}>
              {kelasLabel(k)}
            </option>
          ))}
        </select>
        <div className="relative flex-1">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-text2"
          />
          <input
            aria-label="Cari santri"
            placeholder="Cari nama atau NIS"
            className={`${inputClass} pl-11`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {(warning || kembar.length > 0) && (
        <p
          role="status"
          className="mb-4 flex gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm font-medium text-warn"
        >
          <AlertTriangle size={18} className="shrink-0" />
          {warning ??
            `${kembar.length} santri punya nama panggilan kembar dalam satu kelas (ditandai). Bedakan agar presensi tidak tertukar.`}
        </p>
      )}
      {list.isPending ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorAlert>{errorMessage(list.error)}</ErrorAlert>
      ) : shown.length === 0 ? (
        <EmptyState icon={GraduationCap} title="Tidak ada santri">
          {q
            ? "Tidak ada yang cocok dengan pencarian."
            : "Belum ada santri yang bisa Anda lihat di sini."}
        </EmptyState>
      ) : (
        <>
          <p className="mb-2 text-sm text-text2">{shown.length} santri</p>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpen(s)}
                  className="flex h-full w-full items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.nama}</p>
                    <p className="text-sm text-text2">
                      {s.nis} ·{" "}
                      {s.kelasNama
                        ? `${s.kelasNama} · ${s.unitKode} ${s.lokasiNama}`
                        : "Belum ada kelas"}
                    </p>
                    {s.namaPanggilan && (
                      <p className="mt-1 text-sm">
                        Panggilan: {s.namaPanggilan}{" "}
                        {s.panggilanKembar && <Badge tone="warn">kembar</Badge>}
                      </p>
                    )}
                  </div>
                  {s.status !== "aktif" && <Badge>{statusLabel[s.status]}</Badge>}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <Modal
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open === "baru" ? "Tambah santri" : (open?.nama ?? "")}
      >
        {open === "baru" && (
          <SantriForm
            santri={null}
            taId={taId}
            onDone={(w) => {
              setWarning(w);
              setOpen(null);
            }}
          />
        )}
        {open && open !== "baru" && (
          <SantriModal
            key={open.id}
            id={open.id}
            taId={taId}
            kelasId={open.kelasId}
            onClose={() => setOpen(null)}
            onWarning={setWarning}
          />
        )}
      </Modal>
    </>
  );
}
