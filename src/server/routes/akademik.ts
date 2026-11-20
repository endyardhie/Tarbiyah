import { and, asc, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  JENIS,
  kunciSchema,
  nilaiSchema,
  pengaturanUnitSchema,
  penilaianSchema,
  predikatDari,
  raporKelasSchema,
  raporMapelSchema,
  templateSchema,
  tugasSchema,
} from "../../shared/akademik";
import { DEFAULT_TEMPLATE } from "../../shared/rapor-template";
import { checkTemplate } from "../../shared/template";
import { transactionWithClient } from "../db/client";
import {
  berkas,
  bobotNilai,
  kelas,
  mapel,
  nilai,
  pendaftaran,
  pengajaran,
  penilaian,
  rapor,
  raporAspek,
  raporAspekNilai,
  raporNilai,
  raporTemplate,
  santri,
  santriWali,
  semester,
  skalaPredikat,
  tahunAjaran,
  tugas,
  units,
} from "../db/schema";
import { audit } from "../lib/audit";
import { type AuthUser, can } from "../lib/can";
import {
  type AppDeps,
  type AppEnv,
  currentUser,
  fail,
  paramId,
  parseBody,
  queryId,
} from "../lib/context";
import { detectType } from "../lib/file-type";
import { requirePermission, requireUser } from "../lib/guards";
import { schoolToday } from "../lib/tanggal";
import {
  ensureRapor,
  finalSet,
  getPengajaran,
  getSemester,
  kunciRapor,
  nilaiOtomatis,
  nilaiRaporEfektif,
  pengaturanUnit,
  raporContexts,
  rekapAbsen,
  santriKelas,
} from "../services/akademik";
import { schoolTimeZone } from "../services/pengaturan";
import { notify } from "../services/push";

const MB = 1024 * 1024;

async function bolehIsi(user: AuthUser, p: { id: string }) {
  if (!(await can(user, "akademik.isi", { pengajaranId: p.id })))
    throw fail(403, "Anda bukan guru mapel ini");
}
async function bolehLihat(user: AuthUser, p: { id: string; kelasId: string }) {
  if (!(await can(user, "akademik.lihat", { pengajaranId: p.id, kelasId: p.kelasId })))
    throw fail(403, "Anda tidak punya akses");
}

/** Wali (user) dari santri aktif di kelas; opsional hanya santri tertentu. */
async function waliKelasIni(db: AppDeps["db"], kelasId: string, pendaftaranIds?: string[]) {
  const rows = await db
    .selectDistinct({ id: santriWali.userId })
    .from(santriWali)
    .innerJoin(pendaftaran, eq(pendaftaran.santriId, santriWali.santriId))
    .innerJoin(santri, and(eq(santri.id, santriWali.santriId), eq(santri.status, "aktif")))
    .where(
      and(
        eq(pendaftaran.kelasId, kelasId),
        eq(pendaftaran.status, "aktif"),
        pendaftaranIds
          ? inArray(pendaftaran.id, pendaftaranIds.length ? pendaftaranIds : [""])
          : undefined,
      ),
    );
  return rows.map((r) => r.id);
}

export function tugasRoutes(deps: AppDeps) {
  const { db, pool, boss, storage } = deps;
  const lampiranOf = async (ids: string[]) =>
    ids.length
      ? db
          .select({
            id: berkas.id,
            rujukanId: berkas.rujukanId,
            namaAsli: berkas.namaAsli,
            tipe: berkas.tipe,
            ukuran: berkas.ukuran,
            path: berkas.path,
          })
          .from(berkas)
          .where(and(eq(berkas.rujukanTipe, "tugas"), inArray(berkas.rujukanId, ids)))
      : [];
  const getTugas = async (id: string) => {
    const [t] = await db.select().from(tugas).where(eq(tugas.id, id));
    if (!t) throw fail(404, "Tugas tidak ditemukan");
    return { t, p: await getPengajaran(db, t.pengajaranId) };
  };

  return new Hono<AppEnv>()
    .use(requireUser)
    .get("/", async (c) => {
      const pengajaranId = queryId(c, "pengajaranId");
      if (!pengajaranId) throw fail(400, "Pilih pengajaran");
      const p = await getPengajaran(db, pengajaranId);
      await bolehLihat(currentUser(c), p);
      const rows = await db
        .select()
        .from(tugas)
        .where(eq(tugas.pengajaranId, p.id))
        .orderBy(desc(tugas.tanggalDiberi), desc(tugas.dibuatAt));
      const lamp = await lampiranOf(rows.map((r) => r.id));
      return c.json(
        rows.map((r) => ({
          ...r,
          // path di disk tidak dikirim ke browser
          lampiran: lamp.filter((l) => l.rujukanId === r.id).map(({ path: _, ...l }) => l),
        })),
      );
    })
    .post("/", async (c) => {
      const input = await parseBody(c, tugasSchema);
      const p = await getPengajaran(db, input.pengajaranId);
      await bolehIsi(currentUser(c), p);
      const [row] = await db
        .insert(tugas)
        .values({ ...input, dibuatOleh: currentUser(c).id })
        .returning();
      return c.json(row, 201);
    })
    .patch("/:id", async (c) => {
      const { t, p } = await getTugas(paramId(c));
      await bolehIsi(currentUser(c), p);
      const input = await parseBody(c, tugasSchema.omit({ pengajaranId: true }));
      const [row] = await db.update(tugas).set(input).where(eq(tugas.id, t.id)).returning();
      return c.json(row);
    })
    .delete("/:id", async (c) => {
      const { t, p } = await getTugas(paramId(c));
      const user = currentUser(c);
      await bolehIsi(user, p);
      const lamp = await lampiranOf([t.id]);
      await db.transaction(async (tx) => {
        if (lamp.length)
          await tx.delete(berkas).where(
            inArray(
              berkas.id,
              lamp.map((l) => l.id),
            ),
          );
        await tx.delete(tugas).where(eq(tugas.id, t.id));
        await audit(tx, {
          userId: user.id,
          aksi: "tugas.hapus",
          entitas: "tugas",
          entitasId: t.id,
          sebelum: { ...t, lampiran: lamp },
          ip: c.get("ip"),
        });
      });
      // Berkas di disk ikut dihapus (salinan di B2, bila sudah dibackup, tetap ada).
      await Promise.all(lamp.map((l) => storage.delete(l.path)));
      return c.json({ ok: true });
    })
    .post("/:id/lampiran", async (c) => {
      const { t, p } = await getTugas(paramId(c));
      const user = currentUser(c);
      await bolehIsi(user, p);
      const form = await c.req.parseBody();
      const f = form.berkas;
      if (!(f instanceof File)) throw fail(400, "Pilih berkas");
      const buf = Buffer.from(await f.arrayBuffer());
      // Tipe dari isi berkas, bukan nama/header browser.
      const type = detectType(buf);
      if (!type) throw fail(400, "Hanya gambar (JPG/PNG/WebP) atau PDF");
      const max = type.mime === "application/pdf" ? 5 * MB : 2 * MB;
      if (buf.length > max) throw fail(400, `Berkas terlalu besar (maks ${max / MB} MB)`);
      const { key, size } = await storage.put(storage.randomKey("files", type.ext), buf);
      try {
        const [row] = await db
          .insert(berkas)
          .values({
            namaAsli: f.name.slice(0, 200) || `lampiran.${type.ext}`,
            path: key,
            ukuran: size,
            tipe: type.mime,
            rujukanTipe: "tugas",
            rujukanId: t.id,
            publik: false,
            dibuatOleh: user.id,
          })
          .returning({
            id: berkas.id,
            namaAsli: berkas.namaAsli,
            tipe: berkas.tipe,
            ukuran: berkas.ukuran,
          });
        return c.json(row, 201);
      } catch (e) {
        await storage.delete(key);
        throw e;
      }
    })
    .delete("/:id/lampiran/:berkasId", async (c) => {
      const { t, p } = await getTugas(paramId(c));
      await bolehIsi(currentUser(c), p);
      const [row] = await db
        .delete(berkas)
        .where(
          and(
            eq(berkas.id, paramId(c, "berkasId")),
            eq(berkas.rujukanTipe, "tugas"),
            eq(berkas.rujukanId, t.id),
          ),
        )
        .returning();
      if (!row) throw fail(404, "Lampiran tidak ditemukan");
      // Berkas di disk dibiarkan bila sudah dibackup? Tidak: berkas dihapus; salinan B2 tetap ada.
      await storage.delete(row.path);
      return c.json({ ok: true });
    })
    .post("/:id/notifikasi", async (c) => {
      const { t, p } = await getTugas(paramId(c));
      const user = currentUser(c);
      await bolehIsi(user, p);
      const penerima = await waliKelasIni(db, p.kelasId);
      const n = await transactionWithClient(pool, async (tx, client) => {
        const sent = await notify(tx, client, boss, penerima, {
          jenis: "tugas",
          judul: `PR ${p.mapelNama}: ${t.judul}`,
          isi: t.tenggat
            ? `Tenggat ${t.tenggat}. ${t.deskripsi ?? ""}`.slice(0, 200)
            : (t.deskripsi ?? "Ada tugas baru.").slice(0, 200),
          url: "/akademik",
          pengirimUserId: user.id,
        });
        await tx.update(tugas).set({ dinotifikasiAt: new Date() }).where(eq(tugas.id, t.id));
        return sent;
      });
      return c.json({ penerima: n });
    });
}

export function penilaianRoutes(deps: AppDeps) {
  const { db, pool, boss } = deps;
  const getPenilaian = async (id: string) => {
    const [pn] = await db.select().from(penilaian).where(eq(penilaian.id, id));
    if (!pn) throw fail(404, "Penilaian tidak ditemukan");
    return { pn, p: await getPengajaran(db, pn.pengajaranId) };
  };
  return new Hono<AppEnv>()
    .use(requireUser)
    .get("/", async (c) => {
      const pengajaranId = queryId(c, "pengajaranId");
      if (!pengajaranId) throw fail(400, "Pilih pengajaran");
      const p = await getPengajaran(db, pengajaranId);
      await bolehLihat(currentUser(c), p);
      const sem = await getSemester(db, queryId(c, "semesterId"), p.tahunAjaranId);
      const rows = await db
        .select({
          id: penilaian.id,
          jenis: penilaian.jenis,
          judul: penilaian.judul,
          tanggal: penilaian.tanggal,
          dinotifikasiAt: penilaian.dinotifikasiAt,
          terisi: sql<number>`(select count(*)::int from nilai n where n.penilaian_id = "penilaian"."id")`,
          rataRata: sql<
            number | null
          >`(select round(avg(n.nilai), 1)::float from nilai n where n.penilaian_id = "penilaian"."id")`,
        })
        .from(penilaian)
        .where(and(eq(penilaian.pengajaranId, p.id), eq(penilaian.semesterId, sem.id)))
        .orderBy(asc(penilaian.tanggal), asc(penilaian.dibuatAt));
      return c.json({
        semester: sem,
        jumlahSantri: (await santriKelas(db, p.kelasId)).length,
        penilaian: rows,
      });
    })
    .post("/", async (c) => {
      const input = await parseBody(c, penilaianSchema);
      const p = await getPengajaran(db, input.pengajaranId);
      await bolehIsi(currentUser(c), p);
      const sem = await getSemester(db, input.semesterId, p.tahunAjaranId);
      const [row] = await db
        .insert(penilaian)
        .values({ ...input, semesterId: sem.id, dibuatOleh: currentUser(c).id })
        .returning();
      return c.json(row, 201);
    })
    .patch("/:id", async (c) => {
      const { pn, p } = await getPenilaian(paramId(c));
      await bolehIsi(currentUser(c), p);
      const input = await parseBody(
        c,
        penilaianSchema.pick({ jenis: true, judul: true, tanggal: true }),
      );
      const [row] = await db
        .update(penilaian)
        .set(input)
        .where(eq(penilaian.id, pn.id))
        .returning();
      return c.json(row);
    })
    .get("/:id/nilai", async (c) => {
      const { pn, p } = await getPenilaian(paramId(c));
      await bolehLihat(currentUser(c), p);
      const siswa = await santriKelas(db, p.kelasId);
      const vals = await db.select().from(nilai).where(eq(nilai.penilaianId, pn.id));
      const final = await finalSet(
        db,
        siswa.map((s) => s.pendaftaranId),
        pn.semesterId,
      );
      return c.json({
        penilaian: { ...pn, mapelNama: p.mapelNama, kelasNama: p.kelasNama },
        bisaUbah: await can(currentUser(c), "akademik.isi", { pengajaranId: p.id }),
        santri: siswa.map((s) => ({
          ...s,
          nilai: vals.find((v) => v.pendaftaranId === s.pendaftaranId)?.nilai ?? null,
          terkunci: final.has(s.pendaftaranId),
        })),
      });
    })
    .put("/:id/nilai", async (c) => {
      const { pn, p } = await getPenilaian(paramId(c));
      const user = currentUser(c);
      await bolehIsi(user, p);
      const { items } = await parseBody(c, nilaiSchema);
      const siswa = new Set((await santriKelas(db, p.kelasId)).map((s) => s.pendaftaranId));
      if (items.some((i) => !siswa.has(i.pendaftaranId)))
        throw fail(400, "Ada santri yang bukan anggota kelas ini");
      const final = await finalSet(
        db,
        items.map((i) => i.pendaftaranId),
        pn.semesterId,
      );
      await db.transaction(async (tx) => {
        const before = await tx.select().from(nilai).where(eq(nilai.penilaianId, pn.id));
        const old = new Map(before.map((b) => [b.pendaftaranId, b.nilai]));
        const changed = items.filter((i) => (old.get(i.pendaftaranId) ?? null) !== i.nilai);
        if (changed.some((i) => final.has(i.pendaftaranId))) {
          throw fail(
            409,
            "Rapor sebagian santri sudah final; minta pemegang izin kunci membuka rapor dulu",
          );
        }
        const isi = changed.filter((i) => i.nilai != null);
        const hapus = changed.filter((i) => i.nilai == null).map((i) => i.pendaftaranId);
        if (isi.length) {
          await tx
            .insert(nilai)
            .values(
              isi.map((i) => ({
                penilaianId: pn.id,
                pendaftaranId: i.pendaftaranId,
                nilai: i.nilai as number,
              })),
            )
            .onConflictDoUpdate({
              target: [nilai.penilaianId, nilai.pendaftaranId],
              set: { nilai: sql`excluded.nilai` },
            });
        }
        if (hapus.length)
          await tx
            .delete(nilai)
            .where(and(eq(nilai.penilaianId, pn.id), inArray(nilai.pendaftaranId, hapus)));
        if (changed.length) {
          await audit(tx, {
            userId: user.id,
            aksi: "nilai.ubah",
            entitas: "penilaian",
            entitasId: pn.id,
            sebelum: changed.map((i) => ({
              pendaftaranId: i.pendaftaranId,
              nilai: old.get(i.pendaftaranId) ?? null,
            })),
            sesudah: changed,
            ip: c.get("ip"),
          });
        }
      });
      return c.json({ ok: true });
    })
    .post("/:id/notifikasi", async (c) => {
      const { pn, p } = await getPenilaian(paramId(c));
      const user = currentUser(c);
      await bolehIsi(user, p);
      const sudah = (
        await db.select({ id: nilai.pendaftaranId }).from(nilai).where(eq(nilai.penilaianId, pn.id))
      ).map((r) => r.id);
      const penerima = await waliKelasIni(db, p.kelasId, sudah);
      const n = await transactionWithClient(pool, async (tx, client) => {
        const sent = await notify(tx, client, boss, penerima, {
          jenis: "nilai",
          judul: `Nilai ${p.mapelNama}: ${pn.judul}`,
          isi: "Nilai sudah bisa dilihat di menu Akademik.",
          url: "/akademik",
          pengirimUserId: user.id,
        });
        await tx
          .update(penilaian)
          .set({ dinotifikasiAt: new Date() })
          .where(eq(penilaian.id, pn.id));
        return sent;
      });
      return c.json({ penerima: n });
    });
}

export function akademikRoutes(deps: AppDeps) {
  const { db } = deps;
  return (
    new Hono<AppEnv>()
      .use(requireUser)
      /** Pengajaran yang relevan: yang diajar (guru), atau semua (admin/lihat semua) — tahun ajaran aktif. */
      .get("/pengajaran", async (c) => {
        const user = currentUser(c);
        const semua = await can(user, "akademik.lihat");
        const rows = await db
          .select({
            id: pengajaran.id,
            kelasId: pengajaran.kelasId,
            kelasNama: kelas.nama,
            unitId: kelas.unitId,
            unitKode: units.kode,
            mapelNama: mapel.nama,
            guruId: pengajaran.guruId,
          })
          .from(pengajaran)
          .innerJoin(kelas, eq(kelas.id, pengajaran.kelasId))
          .innerJoin(units, eq(units.id, kelas.unitId))
          .innerJoin(mapel, eq(mapel.id, pengajaran.mapelId))
          .innerJoin(
            tahunAjaran,
            and(eq(tahunAjaran.id, kelas.tahunAjaranId), eq(tahunAjaran.aktif, true)),
          )
          .where(
            semua
              ? undefined
              : or(
                  user.relasi.pengajaran.length
                    ? inArray(pengajaran.id, user.relasi.pengajaran)
                    : sql`false`,
                  user.relasi.kelasWali.length
                    ? inArray(pengajaran.kelasId, user.relasi.kelasWali)
                    : sql`false`,
                ),
          )
          .orderBy(asc(kelas.nama), asc(mapel.nama));
        return c.json(
          rows.map((r) => ({
            ...r,
            bisaIsi: user.isAdmin || user.relasi.pengajaran.includes(r.id),
          })),
        );
      })
      .get("/pengaturan/:unitId", async (c) =>
        c.json(await pengaturanUnit(db, paramId(c, "unitId"))),
      )
      .put("/pengaturan/:unitId", requirePermission("pengaturan.kelola"), async (c) => {
        const unitId = paramId(c, "unitId");
        const input = await parseBody(c, pengaturanUnitSchema);
        const before = await pengaturanUnit(db, unitId);
        await db.transaction(async (tx) => {
          await tx.delete(bobotNilai).where(eq(bobotNilai.unitId, unitId));
          await tx
            .insert(bobotNilai)
            .values(JENIS.map((j) => ({ unitId, jenis: j, bobot: input.bobot[j] ?? 0 })));
          await tx.delete(skalaPredikat).where(eq(skalaPredikat.unitId, unitId));
          await tx.insert(skalaPredikat).values(input.skala.map((s) => ({ ...s, unitId })));
          // Aspek tidak dihapus (sudah dipakai nilai rapor): yang hilang dari daftar dinonaktifkan.
          const keep = new Set(input.aspek.flatMap((a) => (a.id ? [a.id] : [])));
          for (const [i, a] of input.aspek.entries()) {
            if (a.id) {
              await tx
                .update(raporAspek)
                .set({
                  kelompok: a.kelompok,
                  nama: a.nama,
                  tipe: a.tipe,
                  aktif: a.aktif,
                  urutan: i,
                })
                .where(and(eq(raporAspek.id, a.id), eq(raporAspek.unitId, unitId)));
            } else await tx.insert(raporAspek).values({ ...a, unitId, urutan: i });
          }
          for (const a of before.aspek) {
            if (!keep.has(a.id))
              await tx.update(raporAspek).set({ aktif: false }).where(eq(raporAspek.id, a.id));
          }
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "pengaturan.akademik",
            entitas: "units",
            entitasId: unitId,
            sebelum: before,
            sesudah: input,
            ip: c.get("ip"),
          });
        });
        return c.json(await pengaturanUnit(db, unitId));
      })
      /** Halaman Akademik wali santri: PR aktif, nilai, rapor final anaknya. */
      .get("/anak/:santriId", async (c) => {
        const santriId = paramId(c, "santriId");
        if (!(await can(currentUser(c), "akademik.lihat", { santriId })))
          throw fail(403, "Anda tidak punya akses");
        const [d] = await db
          .select({
            pendaftaranId: pendaftaran.id,
            kelasId: kelas.id,
            kelasNama: kelas.nama,
            tahunAjaranId: kelas.tahunAjaranId,
            nama: santri.nama,
          })
          .from(pendaftaran)
          .innerJoin(kelas, eq(kelas.id, pendaftaran.kelasId))
          .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
          .innerJoin(
            tahunAjaran,
            and(eq(tahunAjaran.id, pendaftaran.tahunAjaranId), eq(tahunAjaran.aktif, true)),
          )
          .where(eq(pendaftaran.santriId, santriId));
        if (!d) return c.json({ santri: null, tugas: [], nilai: [], rapor: [] });
        const today = schoolToday(await schoolTimeZone(db), deps.now?.() ?? new Date());
        const tugasRows = await db
          .select({
            id: tugas.id,
            judul: tugas.judul,
            deskripsi: tugas.deskripsi,
            tanggalDiberi: tugas.tanggalDiberi,
            tenggat: tugas.tenggat,
            mapelNama: mapel.nama,
          })
          .from(tugas)
          .innerJoin(pengajaran, eq(pengajaran.id, tugas.pengajaranId))
          .innerJoin(mapel, eq(mapel.id, pengajaran.mapelId))
          .where(
            and(
              eq(pengajaran.kelasId, d.kelasId),
              or(isNull(tugas.tenggat), gte(tugas.tenggat, today)),
            ),
          )
          .orderBy(asc(tugas.tenggat), desc(tugas.tanggalDiberi))
          .limit(50);
        const lamp = tugasRows.length
          ? await db
              .select({
                id: berkas.id,
                rujukanId: berkas.rujukanId,
                namaAsli: berkas.namaAsli,
                tipe: berkas.tipe,
              })
              .from(berkas)
              .where(
                and(
                  eq(berkas.rujukanTipe, "tugas"),
                  inArray(
                    berkas.rujukanId,
                    tugasRows.map((t) => t.id),
                  ),
                ),
              )
          : [];
        const nilaiRows = await db
          .select({
            mapelNama: mapel.nama,
            judul: penilaian.judul,
            jenis: penilaian.jenis,
            tanggal: penilaian.tanggal,
            nilai: nilai.nilai,
          })
          .from(nilai)
          .innerJoin(penilaian, eq(penilaian.id, nilai.penilaianId))
          .innerJoin(pengajaran, eq(pengajaran.id, penilaian.pengajaranId))
          .innerJoin(mapel, eq(mapel.id, pengajaran.mapelId))
          .where(eq(nilai.pendaftaranId, d.pendaftaranId))
          .orderBy(asc(mapel.nama), desc(penilaian.tanggal));
        const raporRows = await db
          .select({ semesterId: rapor.semesterId, nomor: semester.nomor, status: rapor.status })
          .from(rapor)
          .innerJoin(semester, eq(semester.id, rapor.semesterId))
          .where(and(eq(rapor.pendaftaranId, d.pendaftaranId), eq(rapor.status, "final")));
        return c.json({
          santri: {
            id: santriId,
            nama: d.nama,
            kelasNama: d.kelasNama,
            pendaftaranId: d.pendaftaranId,
          },
          tugas: tugasRows.map((t) => ({
            ...t,
            lampiran: lamp.filter((l) => l.rujukanId === t.id),
          })),
          nilai: nilaiRows,
          rapor: raporRows,
        });
      })
  );
}

export function raporRoutes(deps: AppDeps) {
  const { db } = deps;
  const kelasOfPendaftaran = async (pendaftaranId: string) => {
    const [r] = await db
      .select({
        kelasId: pendaftaran.kelasId,
        santriId: pendaftaran.santriId,
        tahunAjaranId: pendaftaran.tahunAjaranId,
      })
      .from(pendaftaran)
      .where(eq(pendaftaran.id, pendaftaranId));
    if (!r) throw fail(404, "Santri tidak ditemukan");
    return r;
  };
  const getKelasTa = async (kelasId: string) => {
    const [k] = await db.select().from(kelas).where(eq(kelas.id, kelasId));
    if (!k) throw fail(404, "Kelas tidak ditemukan");
    return k;
  };

  return (
    new Hono<AppEnv>()
      .use(requireUser)
      .get("/mapel", async (c) => {
        const pengajaranId = queryId(c, "pengajaranId");
        if (!pengajaranId) throw fail(400, "Pilih pengajaran");
        const p = await getPengajaran(db, pengajaranId);
        await bolehLihat(currentUser(c), p);
        const sem = await getSemester(db, queryId(c, "semesterId"), p.tahunAjaranId);
        const set = await pengaturanUnit(db, p.unitId);
        const siswa = await santriKelas(db, p.kelasId);
        const oto = await nilaiOtomatis(db, p.id, sem.id, set.bobot);
        const saved = await db
          .select({ pendaftaranId: rapor.pendaftaranId, status: rapor.status, rn: raporNilai })
          .from(rapor)
          .leftJoin(
            raporNilai,
            and(eq(raporNilai.raporId, rapor.id), eq(raporNilai.pengajaranId, p.id)),
          )
          .where(
            and(
              eq(rapor.semesterId, sem.id),
              inArray(rapor.pendaftaranId, siswa.length ? siswa.map((s) => s.pendaftaranId) : [""]),
            ),
          );
        return c.json({
          semester: sem,
          pengajaran: p,
          skala: set.skala,
          santri: siswa.map((s) => {
            const r = saved.find((x) => x.pendaftaranId === s.pendaftaranId);
            const final = r?.status === "final";
            const e = nilaiRaporEfektif(
              r?.rn ?? undefined,
              final,
              oto.get(s.pendaftaranId) ?? null,
              set.skala,
              p.mapelNama,
            );
            return {
              ...s,
              nilaiOtomatis: e.otomatis,
              nilaiAkhir: e.nilai,
              manual: e.manual,
              predikat: e.predikat,
              deskripsi: e.deskripsi,
              deskripsiManual: e.deskripsiManual,
              final,
            };
          }),
        });
      })
      .put("/mapel", async (c) => {
        const input = await parseBody(c, raporMapelSchema);
        const user = currentUser(c);
        const p = await getPengajaran(db, input.pengajaranId);
        await bolehIsi(user, p);
        const sem = await getSemester(db, input.semesterId, p.tahunAjaranId);
        const set = await pengaturanUnit(db, p.unitId);
        const siswa = new Set((await santriKelas(db, p.kelasId)).map((s) => s.pendaftaranId));
        if (input.items.some((i) => !siswa.has(i.pendaftaranId)))
          throw fail(400, "Ada santri yang bukan anggota kelas ini");
        const final = await finalSet(
          db,
          input.items.map((i) => i.pendaftaranId),
          sem.id,
        );
        if (input.items.some((i) => final.has(i.pendaftaranId)))
          throw fail(409, "Rapor sebagian santri sudah final");
        const oto = await nilaiOtomatis(db, p.id, sem.id, set.bobot);
        await db.transaction(async (tx) => {
          for (const i of input.items) {
            const r = await ensureRapor(tx, i.pendaftaranId, sem.id);
            const otomatis = oto.get(i.pendaftaranId) ?? null;
            const manual = i.nilaiAkhir != null && i.nilaiAkhir !== otomatis;
            const akhir = manual ? i.nilaiAkhir : otomatis;
            const [before] = await tx
              .select()
              .from(raporNilai)
              .where(and(eq(raporNilai.raporId, r.id), eq(raporNilai.pengajaranId, p.id)));
            // Hanya yang ditulis guru yang disimpan; nilai & deskripsi otomatis dihitung ulang
            // saat dibaca dan saat rapor dikunci (nilai yang masuk belakangan selalu ikut).
            const values = {
              nilaiOtomatis: otomatis,
              nilaiAkhir: manual ? akhir : null,
              manual,
              predikat: null,
              deskripsi: i.deskripsi,
              deskripsiManual: !!i.deskripsi,
            };
            await tx
              .insert(raporNilai)
              .values({ raporId: r.id, pengajaranId: p.id, ...values })
              .onConflictDoUpdate({
                target: [raporNilai.raporId, raporNilai.pengajaranId],
                set: values,
              });
            // Nilai akhir yang diubah manual dicatat (aturan: perubahan nilai ke audit_log).
            if (manual || before?.manual) {
              if (before?.nilaiAkhir !== akhir || before?.manual !== manual) {
                await audit(tx, {
                  userId: user.id,
                  aksi: "rapor_nilai.ubah",
                  entitas: "rapor_nilai",
                  entitasId: `${r.id}:${p.id}`,
                  sebelum: before ? { nilaiAkhir: before.nilaiAkhir, manual: before.manual } : null,
                  sesudah: { nilaiAkhir: akhir, manual, nilaiOtomatis: otomatis },
                  ip: c.get("ip"),
                });
              }
            }
          }
        });
        return c.json({ ok: true });
      })
      .get("/kelas", async (c) => {
        const kelasId = queryId(c, "kelasId");
        if (!kelasId) throw fail(400, "Pilih kelas");
        const user = currentUser(c);
        if (
          !(await can(user, "rapor.lihat", { kelasId })) &&
          !(await can(user, "rapor.isi_kelas", { kelasId }))
        ) {
          throw fail(403, "Anda tidak punya akses");
        }
        const k = await getKelasTa(kelasId);
        const sem = await getSemester(db, queryId(c, "semesterId"), k.tahunAjaranId);
        const set = await pengaturanUnit(db, k.unitId);
        const siswa = await santriKelas(db, kelasId);
        const ids = siswa.map((s) => s.pendaftaranId);
        const raporRows = ids.length
          ? await db
              .select()
              .from(rapor)
              .where(and(inArray(rapor.pendaftaranId, ids), eq(rapor.semesterId, sem.id)))
          : [];
        const ran = raporRows.length
          ? await db
              .select()
              .from(raporAspekNilai)
              .where(
                inArray(
                  raporAspekNilai.raporId,
                  raporRows.map((r) => r.id),
                ),
              )
          : [];
        const absen = await rekapAbsen(db, ids, sem);
        const [{ jumlahMapel } = { jumlahMapel: 0 }] = await db
          .select({ jumlahMapel: count() })
          .from(pengajaran)
          .where(eq(pengajaran.kelasId, kelasId));
        return c.json({
          semester: sem,
          jumlahMapel,
          aspek: set.aspek.filter((a) => a.aktif),
          skala: set.skala,
          bisaIsi: await can(user, "rapor.isi_kelas", { kelasId }),
          bisaKunci: await can(user, "rapor.kunci"),
          santri: siswa.map((s) => {
            const r = raporRows.find((x) => x.pendaftaranId === s.pendaftaranId);
            return {
              ...s,
              status: r?.status ?? "draft",
              catatanWali: r?.catatanWali ?? "",
              keputusan: r?.keputusan ?? null,
              aspek: Object.fromEntries(
                ran.filter((x) => x.raporId === r?.id).map((x) => [x.aspekId, x.nilai]),
              ),
              absensi:
                r?.status === "final"
                  ? { sakit: r.sakit ?? 0, izin: r.izin ?? 0, alpa: r.alpa ?? 0 }
                  : absen.get(s.pendaftaranId),
            };
          }),
        });
      })
      .put("/kelas/:pendaftaranId", async (c) => {
        const pendaftaranId = paramId(c, "pendaftaranId");
        const input = await parseBody(c, raporKelasSchema);
        const user = currentUser(c);
        const d = await kelasOfPendaftaran(pendaftaranId);
        if (!(await can(user, "rapor.isi_kelas", { kelasId: d.kelasId })))
          throw fail(403, "Hanya wali kelas yang mengisi bagian ini");
        const sem = await getSemester(db, input.semesterId, d.tahunAjaranId);
        const [k] = await db
          .select({ unitId: kelas.unitId })
          .from(kelas)
          .where(eq(kelas.id, d.kelasId));
        const aspekIds = new Set(
          (await pengaturanUnit(db, k?.unitId as string)).aspek.map((a) => a.id),
        );
        if (input.aspek.some((a) => !aspekIds.has(a.aspekId)))
          throw fail(400, "Aspek tidak dikenal untuk unit ini");
        await db.transaction(async (tx) => {
          const r = await ensureRapor(tx, pendaftaranId, sem.id);
          if (r.status === "final") throw fail(409, "Rapor sudah final");
          await tx
            .update(rapor)
            .set({
              catatanWali: input.catatanWali,
              keputusan: sem.nomor === 2 ? input.keputusan : null,
            })
            .where(eq(rapor.id, r.id));
          for (const a of input.aspek) {
            await tx
              .insert(raporAspekNilai)
              .values({ raporId: r.id, aspekId: a.aspekId, nilai: a.nilai })
              .onConflictDoUpdate({
                target: [raporAspekNilai.raporId, raporAspekNilai.aspekId],
                set: { nilai: a.nilai },
              });
          }
        });
        return c.json({ ok: true });
      })
      .post("/kunci", requirePermission("rapor.kunci"), async (c) => {
        const input = await parseBody(c, kunciSchema);
        const ids =
          input.pendaftaranIds ??
          (await santriKelas(db, input.kelasId)).map((s) => s.pendaftaranId);
        const valid = new Set((await santriKelas(db, input.kelasId)).map((s) => s.pendaftaranId));
        if (ids.some((i) => !valid.has(i)))
          throw fail(400, "Ada santri yang bukan anggota kelas ini");
        await db.transaction(async (tx) => {
          await kunciRapor(tx, input.kelasId, input.semesterId, ids, currentUser(c).id);
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "rapor.kunci",
            entitas: "rapor",
            entitasId: `${input.kelasId}:${input.semesterId}`,
            sesudah: { pendaftaranIds: ids },
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true, jumlah: ids.length });
      })
      .post("/buka", requirePermission("rapor.kunci"), async (c) => {
        const input = await parseBody(c, kunciSchema);
        const ids =
          input.pendaftaranIds ??
          (await santriKelas(db, input.kelasId)).map((s) => s.pendaftaranId);
        await db.transaction(async (tx) => {
          await tx
            .update(rapor)
            .set({ status: "draft", dikunciOleh: null, dikunciAt: null })
            .where(
              and(
                inArray(rapor.pendaftaranId, ids.length ? ids : [""]),
                eq(rapor.semesterId, input.semesterId),
              ),
            );
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "rapor.buka",
            entitas: "rapor",
            entitasId: `${input.kelasId}:${input.semesterId}`,
            sesudah: { pendaftaranIds: ids },
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      })
      /** Data cetak: template unit + konteks per santri. Wali santri hanya rapor final anaknya. */
      .get("/cetak", async (c) => {
        const user = currentUser(c);
        const semesterId = queryId(c, "semesterId");
        if (!semesterId) throw fail(400, "Pilih semester");
        const pendaftaranId = queryId(c, "pendaftaranId");
        let kelasId = queryId(c, "kelasId");
        let hanyaFinal = false;
        if (pendaftaranId) {
          const d = await kelasOfPendaftaran(pendaftaranId);
          kelasId = d.kelasId;
          const staf =
            (await can(user, "rapor.lihat", { kelasId })) ||
            (await can(user, "rapor.isi_kelas", { kelasId }));
          if (!staf) {
            if (!(await can(user, "rapor.lihat", { santriId: d.santriId })))
              throw fail(403, "Anda tidak punya akses");
            hanyaFinal = true;
          }
        } else if (!kelasId || !(await can(user, "rapor.lihat", { kelasId }))) {
          throw fail(403, "Anda tidak punya akses");
        }
        const { unitId, data } = await raporContexts(
          db,
          kelasId as string,
          semesterId,
          pendaftaranId ? [pendaftaranId] : undefined,
        );
        if (hanyaFinal && data.some((d) => d.status !== "final"))
          throw fail(403, "Rapor belum final");
        const [tpl] = await db
          .select()
          .from(raporTemplate)
          .where(and(eq(raporTemplate.unitId, unitId), eq(raporTemplate.aktif, true)));
        return c.json({
          template: tpl ? { html: tpl.html, css: tpl.css } : DEFAULT_TEMPLATE,
          data,
        });
      })
      .get("/template/:unitId", async (c) => {
        const unitId = paramId(c, "unitId");
        const [tpl] = await db
          .select()
          .from(raporTemplate)
          .where(and(eq(raporTemplate.unitId, unitId), eq(raporTemplate.aktif, true)));
        return c.json(
          tpl
            ? { nama: tpl.nama, html: tpl.html, css: tpl.css, bawaan: false }
            : { ...DEFAULT_TEMPLATE, bawaan: true },
        );
      })
      .put("/template/:unitId", requirePermission("pengaturan.kelola"), async (c) => {
        const unitId = paramId(c, "unitId");
        const input = await parseBody(c, templateSchema);
        const err = checkTemplate(input.html);
        if (err) throw fail(400, `Template tidak valid: ${err}`);
        await db.transaction(async (tx) => {
          await tx
            .update(raporTemplate)
            .set({ aktif: false })
            .where(eq(raporTemplate.unitId, unitId));
          await tx.insert(raporTemplate).values({ ...input, unitId });
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "rapor_template.simpan",
            entitas: "rapor_template",
            entitasId: unitId,
            sesudah: { nama: input.nama },
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      })
  );
}
