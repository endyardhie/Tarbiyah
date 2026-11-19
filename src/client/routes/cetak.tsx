import { useQuery } from "@tanstack/react-query";
import { Navigate } from "@tanstack/react-router";
import type { Laporan } from "../../shared/types";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatTanggal } from "../lib/format";
import { STATUS, tglDate } from "../lib/presensi";
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
