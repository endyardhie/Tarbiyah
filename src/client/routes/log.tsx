import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
import { Card, EmptyState, PageHeader } from "../components/Page";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatWaktu } from "../lib/format";
import { Button } from "../ui/Button";
import { ErrorAlert, Field, inputClass } from "../ui/Field";

type Baris = {
  id: string;
  dibuatAt: string;
  aksi: string;
  entitas: string;
  entitasId: string | null;
  sebelum: unknown;
  sesudah: unknown;
  ip: string | null;
  userNama: string | null;
};

const json = (v: unknown) => (v == null ? "" : JSON.stringify(v, null, 2));

/** Log aktivitas: siapa mengubah apa dan kapan (admin). */
export function LogPage() {
  const { data: me } = useMe();
  const [f, setF] = useState({ aksi: "", userId: "", dari: "", sampai: "" });
  const opsi = useQuery({
    queryKey: ["audit", "opsi"],
    queryFn: () => api<{ aksi: string[]; pelaku: { id: string; nama: string }[] }>("/audit/opsi"),
    enabled: !!me?.isAdmin,
  });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const log = useInfiniteQuery({
    queryKey: ["audit", qs],
    queryFn: ({ pageParam }) =>
      api<{ rows: Baris[]; berikutnya: string | null }>(
        `/audit?${qs}${pageParam ? `&sebelum=${pageParam}` : ""}`,
      ),
    initialPageParam: "",
    getNextPageParam: (p) => p.berikutnya ?? undefined,
    enabled: !!me?.isAdmin,
  });
  if (!me?.isAdmin) {
    return (
      <EmptyState icon={History} title="Tidak punya akses">
        Log aktivitas hanya untuk admin.
      </EmptyState>
    );
  }
  const rows = log.data?.pages.flatMap((p) => p.rows) ?? [];
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <>
      <PageHeader
        title="Log aktivitas"
        subtitle="Perubahan nilai, presensi, tagihan, pembayaran, peran, dan pengaturan."
      />
      <Card className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Aksi">
          {(id) => (
            <select id={id} className={inputClass} value={f.aksi} onChange={set("aksi")}>
              <option value="">Semua aksi</option>
              {opsi.data?.aksi.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Pelaku">
          {(id) => (
            <select id={id} className={inputClass} value={f.userId} onChange={set("userId")}>
              <option value="">Semua pengguna</option>
              {opsi.data?.pelaku.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nama}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Dari">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={f.dari}
              onChange={set("dari")}
            />
          )}
        </Field>
        <Field label="Sampai">
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={f.sampai}
              onChange={set("sampai")}
            />
          )}
        </Field>
      </Card>
      {log.isError && <ErrorAlert>{errorMessage(log.error)}</ErrorAlert>}
      {log.isPending ? (
        <div className="h-48 animate-pulse rounded-card bg-surface-muted" aria-busy="true" />
      ) : rows.length === 0 ? (
        <EmptyState icon={History} title="Tidak ada aktivitas">
          Tidak ada catatan untuk filter ini.
        </EmptyState>
      ) : (
        <Card className="p-0 md:p-0">
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="px-5 py-3 md:px-6">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{r.aksi}</span>
                  <span className="text-sm text-text2">
                    {r.userNama ?? "Sistem"} · {formatWaktu(r.dibuatAt)}
                    {r.ip ? ` · ${r.ip}` : ""}
                  </span>
                </div>
                {(r.sebelum != null || r.sesudah != null) && (
                  <details className="mt-1">
                    <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-text2">
                      Rincian {r.entitas}
                    </summary>
                    <div className="grid gap-2 md:grid-cols-2">
                      {r.sebelum != null && (
                        <pre className="overflow-x-auto rounded-2xl bg-surface-muted p-3 text-xs">
                          Sebelum:{"\n"}
                          {json(r.sebelum)}
                        </pre>
                      )}
                      {r.sesudah != null && (
                        <pre className="overflow-x-auto rounded-2xl bg-surface-muted p-3 text-xs">
                          Sesudah:{"\n"}
                          {json(r.sesudah)}
                        </pre>
                      )}
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {log.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            loading={log.isFetchingNextPage}
            onClick={() => log.fetchNextPage()}
          >
            Muat lebih banyak
          </Button>
        </div>
      )}
    </>
  );
}
