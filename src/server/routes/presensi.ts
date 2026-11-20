import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { simpanPresensiSchema } from "../../shared/presensi";
import { kelas, lokasi, presensiSesi, units } from "../db/schema";
import { can } from "../lib/can";
import { type AppDeps, type AppEnv, currentUser, fail, parseBody, queryId } from "../lib/context";
import { requireUser } from "../lib/guards";
import { monthBounds, schoolToday } from "../lib/tanggal";
import { schoolTimeZone } from "../services/pengaturan";
import {
  bisaUbah,
  getKelas,
  getPresensiKelas,
  isHariLibur,
  laporan,
  liburKelas,
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
          .select({
            id: kelas.id,
            nama: kelas.nama,
            unitId: kelas.unitId,
            lokasiId: kelas.lokasiId,
            unitKode: units.kode,
            lokasiNama: lokasi.nama,
          })
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
        const libur = await liburKelas(db, list, tanggal);
        const out = [];
        for (const { unitId: _u, lokasiId: _l, ...k } of list) {
          out.push({
            ...k,
            sudah: sudah.has(k.id),
            ...(libur.get(k.id) ?? { libur: false, alasan: null }),
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
          bisaUbah: !libur.libur && (await bisaUbah(user, k, tanggal, hariIni)),
          bisaKoreksi: await can(user, "presensi.koreksi"),
          ...data,
        });
      })
      /** Dashboard kepsek/admin: rekap kehadiran bulan ini per unit (tahun ajaran aktif). */
      .get("/rekap-unit", async (c) => {
        if (!(await can(currentUser(c), "presensi.lihat_semua"))) {
          throw fail(403, "Anda tidak punya akses");
        }
        const { dari, sampai } = monthBounds(await today());
        const { rows } = await db.execute(sql`
          select u.id, u.kode, u.nama,
            count(*) filter (where pr.status = 'H')::int "H",
            count(*) filter (where pr.status = 'S')::int "S",
            count(*) filter (where pr.status = 'I')::int "I",
            count(*) filter (where pr.status = 'A')::int "A"
          from presensi pr
          join pendaftaran pd on pd.id = pr.pendaftaran_id
          join kelas k on k.id = pd.kelas_id
          join tahun_ajaran ta on ta.id = k.tahun_ajaran_id and ta.aktif
          join units u on u.id = k.unit_id
          where pr.tanggal between ${dari} and ${sampai}
          group by u.id order by u.urutan, u.kode`);
        return c.json(rows);
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
        const hari = (Date.parse(sampai) - Date.parse(dari)) / 86_400_000;
        if (hari < 0 || hari > 366) throw fail(400, "Rentang tanggal tidak valid (maks 1 tahun)");
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
