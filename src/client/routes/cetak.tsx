import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import { useRef } from "react";
import type { RaporContext } from "../../shared/rapor-template";
import { renderTemplate } from "../../shared/template";
import type { Laporan } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatTanggal } from "../lib/format";
import { STATUS, tglDate } from "../lib/presensi";
import { PRINT_FONTS } from "../lib/print-fonts";
import { usePublicConfig } from "../lib/sekolah";
import { Button } from "../ui/Button";

/** Halaman cetak rekap presensi (A4 mendatar). PDF dibuat dari dialog cetak browser. */
export function CetakPresensiPage() {
  const me = useMe();
  const config = usePublicConfig();
  const qs = window.location.search.slice(1);
  const lap = useQuery({
    queryKey: ["presensi", "laporan", qs],
    queryFn: () => api<Laporan>(`/presensi/laporan?${qs}`),
    enabled: !!me.data && config.isSuccess,
  });
  if (me.isSuccess && !me.data) return <Navigate to="/login" />;
  const d = lap.data;
  const fmt = (t: string) => formatTanggal(tglDate(t), "UTC").replace(/^\w+, /, "");

  return (
    <div className="mx-auto max-w-[277mm] bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex gap-2 print:hidden">
        <Button onClick={() => window.print()} disabled={!d}>
          Cetak / Simpan PDF
        </Button>
        <Button variant="secondary" onClick={() => window.close()}>
          Tutup
        </Button>
      </div>
      {lap.isError && <p className="text-red-700">{errorMessage(lap.error)}</p>}
      {!d ? (
        <p>Memuat…</p>
      ) : (
        <>
          <header className="mb-3 flex items-center gap-4 border-b-2 border-black pb-3">
            {config.data?.logoUrl && (
              <img src={config.data.logoUrl} alt="" className="size-16 object-contain" />
            )}
            <div>
              <p className="text-lg font-bold uppercase">{config.data?.nama}</p>
              <p className="text-sm">
                Rekap Presensi{" "}
                {d.kelas
                  ? `${d.kelas.nama} · ${d.kelas.unitKode} ${d.kelas.lokasiNama}`
                  : (d.rows[0]?.nama ?? "")}
              </p>
              <p className="text-sm">
                Periode {fmt(d.dari)} – {fmt(d.sampai)}
                {d.kelas?.waliKelasNama ? ` · Wali kelas: ${d.kelas.waliKelasNama}` : ""}
              </p>
            </div>
          </header>
          <table className="w-full border-collapse text-[9pt]">
            <thead>
              <tr>
                <th className="border border-black px-1">No</th>
                <th className="border border-black px-1 text-left">Nama</th>
                {d.tanggal.map((t) => (
                  <th key={t} className="border border-black px-0.5 font-normal">
                    {Number(t.slice(8))}
                  </th>
                ))}
                {STATUS.map((s) => (
                  <th key={s.value} className="border border-black px-1">
                    {s.value}
                  </th>
                ))}
                <th className="border border-black px-1">%</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={r.pendaftaranId} className="break-inside-avoid">
                  <td className="border border-black px-1 text-center">{r.noAbsen ?? i + 1}</td>
                  <td className="border border-black px-1 whitespace-nowrap">{r.nama}</td>
                  {d.tanggal.map((t) => (
                    <td key={t} className="border border-black text-center">
                      {r.harian[t] ?? ""}
                    </td>
                  ))}
                  {STATUS.map((s) => (
                    <td key={s.value} className="border border-black px-1 text-center">
                      {r.total[s.value]}
                    </td>
                  ))}
                  <td className="border border-black px-1 text-center">{r.persen ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[8pt]">
            H = hadir, S = sakit, I = izin, A = alpa. Dicetak {formatTanggal(new Date())}.
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Cetak rapor: template HTML dari admin dirender (semua nilai di-escape) ke iframe ber-sandbox
 * tanpa izin script, satu halaman per santri. PDF dari dialog cetak browser.
 */
export function CetakRaporPage() {
  const me = useMe();
  const qs = window.location.search.slice(1);
  const q = useQuery({
    queryKey: ["rapor", "cetak", qs],
    queryFn: () =>
      api<{ template: { html: string; css: string }; data: (RaporContext & { status: string })[] }>(
        `/rapor/cetak?${qs}`,
      ),
    enabled: !!me.data,
  });
  const frame = useRef<HTMLIFrameElement>(null);
  if (me.isSuccess && !me.data) return <Navigate to="/login" />;
  let doc = "";
  let error = "";
  if (q.data) {
    try {
      const pages = q.data.data
        .map((d) => `<section class="halaman">${renderTemplate(q.data.template.html, d)}</section>`)
        .join("");
      doc = `<!doctype html><html lang="id"><head><meta charset="utf-8"><base href="${window.location.origin}/"><style>${PRINT_FONTS}${q.data.template.css}
.halaman { break-after: page; } .halaman:last-child { break-after: auto; }</style></head><body>${pages}</body></html>`;
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return (
    <div className="min-h-dvh bg-surface-muted p-4">
      <div className="mx-auto mb-3 flex max-w-[210mm] flex-wrap items-center gap-2">
        <Button disabled={!doc} onClick={() => frame.current?.contentWindow?.print()}>
          Cetak / Simpan PDF
        </Button>
        <Button variant="secondary" onClick={() => window.close()}>
          Tutup
        </Button>
        {q.data && (
          <span className="text-sm text-text2">
            {q.data.data.length} rapor
            {q.data.data.some((d) => d.status !== "final") ? " · ada yang masih DRAFT" : ""}
          </span>
        )}
      </div>
      {q.isError && <p className="text-danger">{errorMessage(q.error)}</p>}
      {error && <p className="text-danger">Template rapor bermasalah: {error}</p>}
      {!q.data && !q.isError && <p>Memuat…</p>}
      {doc && (
        <iframe
          ref={frame}
          title="Pratinjau rapor"
          sandbox="allow-same-origin allow-modals"
          srcDoc={doc}
          className="mx-auto block h-[80dvh] w-full max-w-[210mm] rounded-xl bg-white shadow-soft"
        />
      )}
    </div>
  );
}
