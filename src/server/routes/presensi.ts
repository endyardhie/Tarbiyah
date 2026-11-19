import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { simpanPresensiSchema } from "../../shared/presensi";
import { kelas, lokasi, presensiSesi, units } from "../db/schema";
import { can } from "../lib/can";
import { type AppDeps, type AppEnv, currentUser, fail, parseBody, queryId } from "../lib/context";
import { requireUser } from "../lib/guards";
import { dateRange, monthBounds, schoolToday } from "../lib/tanggal";
import { schoolTimeZone } from "../services/pengaturan";
import {
  bisaUbah,
  getKelas,
  getPresensiKelas,
  isHariLibur,
  laporan,
  simpanPresensi,
} from "../services/presensi";
import { activeTahunAjaran } from "../services/sekolah";

const tanggalQuery = z.iso.date();

export function presensiRoutes(deps: AppDeps) {
  const { db } = deps;
  const today = async () => schoolToday(await schoolTimeZone(db), deps.now?.() ?? new Date());
  const qTanggal = (v: string | undefined, label: string) => {
    if (!v || !tanggalQuery.safeParse(v).success) throw fail(400, `Parameter ${label} tidak valid`);
    return v;
  };

  return (
    new Hono<AppEnv>()
      .use(requireUser)
      /** Kelas yang relevan hari ini + status sudah/belum diabsen & libur (halaman Isi & dashboard). */
      .get("/hari-ini", async (c) => {
        const user = currentUser(c);
        const tanggal = await today();
        const ta = await activeTahunAjaran(db);
        if (!ta) return c.json({ tanggal, kelas: [] });
        const lihatSemua = await can(user, "presensi.lihat");
        const mine = [...new Set([...user.relasi.kelasWali, ...user.relasi.kelasAjar])];
        if (!lihatSemua && !mine.length) return c.json({ tanggal, kelas: [] });
        const list = await db
          .select({ id: kelas.id, nama: kelas.nama, unitKode: units.kode, lokasiNama: lokasi.nama })
          .from(kelas)
          .innerJoin(units, eq(units.id, kelas.unitId))
          .innerJoin(lokasi, eq(lokasi.id, kelas.lokasiId))
          .where(
            and(
              eq(kelas.tahunAjaranId, ta.id),
              eq(kelas.aktif, true),
              lihatSemua ? undefined : inArray(kelas.id, mine),
            ),
          )
          .orderBy(asc(units.urutan), asc(lokasi.nama), asc(kelas.tingkat), asc(kelas.nama));
        const sudah = new Set(
          (
            await db
              .select({ kelasId: presensiSesi.kelasId })
              .from(presensiSesi)
              .where(eq(presensiSesi.tanggal, tanggal))
          ).map((s) => s.kelasId),
        );
        const out = [];
        for (const k of list) {
          out.push({
            ...k,
            sudah: sudah.has(k.id),
            ...(await isHariLibur(db, k.id, tanggal)),
            bisaIsi: await can(user, "presensi.isi", { kelasId: k.id }),
          });
        }
        return c.json({ tanggal, kelas: out });
      })
      .get("/", async (c) => {
        const user = currentUser(c);
        const kelasId = queryId(c, "kelasId");
        if (!kelasId) throw fail(400, "Pilih kelas");
        if (!(await can(user, "presensi.lihat", { kelasId })))
          throw fail(403, "Anda tidak punya akses ke kelas ini");
        const hariIni = await today();
        const tanggal = c.req.query("tanggal")
          ? qTanggal(c.req.query("tanggal"), "tanggal")
          : hariIni;
        const [k, libur, data] = await Promise.all([
          getKelas(db, kelasId),
          isHariLibur(db, kelasId, tanggal),
          getPresensiKelas(db, kelasId, tanggal),
        ]);
        return c.json({
          kelas: k,
          tanggal,
          hariIni,
          ...libur,
          bisaUbah: !libur.libur && (await bisaUbah(user, kelasId, tanggal, hariIni)),
          bisaKoreksi: await can(user, "presensi.koreksi"),
          ...data,
        });
      })
      .put("/", async (c) => {
        const input = await parseBody(c, simpanPresensiSchema);
        await simpanPresensi(db, currentUser(c), input, await today(), c.get("ip"));
        return c.json({ ok: true });
      })
      .get("/laporan", async (c) => {
        const user = currentUser(c);
        const kelasId = queryId(c, "kelasId");
        const santriId = queryId(c, "santriId");
        const dari = qTanggal(c.req.query("dari"), "dari");
        const sampai = qTanggal(c.req.query("sampai"), "sampai");
        if (sampai < dari || dateRange(dari, sampai).length > 366)
          throw fail(400, "Rentang tanggal tidak valid (maks 1 tahun)");
        if (!kelasId && !santriId) throw fail(400, "Pilih kelas atau santri");
        // Wali santri hanya lewat santriId anaknya; wali kelas/pengajar lewat kelasnya.
        const scope = kelasId ? { kelasId } : { santriId };
        if (!(await can(user, "presensi.lihat", scope))) throw fail(403, "Anda tidak punya akses");
        return c.json({
          ...(kelasId ? { kelas: await getKelas(db, kelasId) } : {}),
          ...(await laporan(db, { kelasId, santriId, dari, sampai })),
        });
      })
      /** Kehadiran bulan ini per anak (kartu dashboard wali santri). */
      .get("/ringkasan-anak", async (c) => {
        const user = currentUser(c);
        const { dari, sampai } = monthBounds(await today());
        const out = [];
        for (const santriId of user.relasi.anak) {
          const r = await laporan(db, { santriId, dari, sampai });
          const total = { H: 0, S: 0, I: 0, A: 0 };
          for (const row of r.rows)
            for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += row.total[k];
          const n = total.H + total.S + total.I + total.A;
          const first = r.rows.at(-1);
          if (!first) continue;
          out.push({
            santriId,
            nama: first.nama,
            namaPanggilan: first.namaPanggilan,
            kelasNama: first.kelasNama,
            total,
            persen: n ? Math.round((total.H / n) * 1000) / 10 : null,
          });
        }
        return c.json({ dari, sampai, anak: out });
      })
  );
}
