import { and, asc, eq, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  jadwalSchema,
  kelasSchema,
  lokasiSchema,
  mapelSchema,
  pengajaranSchema,
  semesterSchema,
  tahunAjaranSchema,
  unitSchema,
} from "../../shared/sekolah";
import {
  jadwal,
  kelas,
  liburMingguan,
  lokasi,
  mapel,
  pengajaran,
  semester,
  tahunAjaran,
  units,
  users,
} from "../db/schema";
import { audit } from "../lib/audit";
import { can } from "../lib/can";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, queryId } from "../lib/context";
import { crudRoutes } from "../lib/crud";
import { requirePermission, requireUser } from "../lib/guards";
import {
  assertActiveUser,
  assertKelasBukanArsip,
  assertTaBukanArsip,
  resolveTahunAjaran,
} from "../services/sekolah";

/** Lokasi, unit, tahun ajaran, semester, kelas, mapel, pengajaran, jadwal, libur mingguan. */
export function sekolahRoutes({ db }: AppDeps) {
  /** Satu tahun ajaran / semester aktif: matikan semua lalu aktifkan satu, dalam satu transaksi. */
  const activate = (table: typeof tahunAjaran | typeof semester, entitas: string) =>
    new Hono<AppEnv>().post(
      "/:id/aktifkan",
      requireUser,
      requirePermission("pengaturan.kelola"),
      async (c) => {
        const id = paramId(c);
        await db.transaction(async (tx) => {
          if (table === semester) {
            // Semester aktif harus milik tahun ajaran aktif.
            const [row] = await tx
              .select({ aktif: tahunAjaran.aktif })
              .from(semester)
              .innerJoin(tahunAjaran, eq(tahunAjaran.id, semester.tahunAjaranId))
              .where(eq(semester.id, id));
            if (!row) throw fail(404, "Data tidak ditemukan");
            if (!row.aktif) throw fail(400, "Aktifkan tahun ajarannya dulu");
          } else {
            // Ganti tahun ajaran → semester tahun lain tidak lagi aktif.
            await tx.update(semester).set({ aktif: false }).where(ne(semester.tahunAjaranId, id));
          }
          await tx.update(table).set({ aktif: false }).where(ne(table.id, id));
          const [row] = await tx
            .update(table)
            .set({ aktif: true })
            .where(eq(table.id, id))
            .returning();
          if (!row) throw fail(404, "Data tidak ditemukan");
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: `${entitas}.aktifkan`,
            entitas,
            entitasId: id,
            ip: c.get("ip"),
          });
        });
        return c.json({ ok: true });
      },
    );

  return new Hono<AppEnv>()
    .route(
      "/lokasi",
      crudRoutes(db, {
        table: lokasi,
        schema: lokasiSchema,
        permission: "pengaturan.kelola",
        entitas: "lokasi",
        list: () => db.select().from(lokasi).orderBy(asc(lokasi.nama)),
      }),
    )
    .route(
      "/units",
      crudRoutes(db, {
        table: units,
        schema: unitSchema,
        permission: "pengaturan.kelola",
        entitas: "units",
        list: () => db.select().from(units).orderBy(asc(units.urutan), asc(units.kode)),
      }),
    )
    .route("/tahun-ajaran", activate(tahunAjaran, "tahun_ajaran"))
    .route(
      "/tahun-ajaran",
      crudRoutes(db, {
        table: tahunAjaran,
        schema: tahunAjaranSchema,
        permission: "pengaturan.kelola",
        entitas: "tahun_ajaran",
        list: async () => {
          const [tas, sems] = await Promise.all([
            db.select().from(tahunAjaran).orderBy(sql`${tahunAjaran.mulai} desc`),
            db.select().from(semester).orderBy(asc(semester.nomor)),
          ]);
          return tas.map((t) => ({ ...t, semester: sems.filter((s) => s.tahunAjaranId === t.id) }));
        },
      }),
    )
    .route("/semester", activate(semester, "semester"))
    .route(
      "/semester",
      crudRoutes(db, {
        table: semester,
        schema: semesterSchema,
        permission: "pengaturan.kelola",
        entitas: "semester",
      }),
    )
    .route(
      "/kelas",
      crudRoutes(db, {
        table: kelas,
        schema: kelasSchema,
        permission: "kelas.kelola",
        entitas: "kelas",
        check: async (tx, data) => {
          await assertTaBukanArsip(tx, data.tahunAjaranId);
          await assertActiveUser(tx, data.waliKelasId, "Wali kelas");
        },
        list: async (c) => {
          const ta = await resolveTahunAjaran(db, queryId(c, "tahunAjaranId"));
          if (!ta) return [];
          return db
            .select({
              id: kelas.id,
              tahunAjaranId: kelas.tahunAjaranId,
              unitId: kelas.unitId,
              lokasiId: kelas.lokasiId,
              nama: kelas.nama,
              tingkat: kelas.tingkat,
              kelompok: kelas.kelompok,
              waliKelasId: kelas.waliKelasId,
              aktif: kelas.aktif,
              unitKode: units.kode,
              lokasiNama: lokasi.nama,
              waliKelasNama: users.nama,
              jumlahSantri: sql<number>`(select count(*)::int from pendaftaran p where p.kelas_id = "kelas"."id" and p.status = 'aktif')`,
            })
            .from(kelas)
            .innerJoin(units, eq(units.id, kelas.unitId))
            .innerJoin(lokasi, eq(lokasi.id, kelas.lokasiId))
            .leftJoin(users, eq(users.id, kelas.waliKelasId))
            .where(eq(kelas.tahunAjaranId, ta))
            .orderBy(asc(units.urutan), asc(lokasi.nama), asc(kelas.tingkat), asc(kelas.nama));
        },
      }),
    )
    .route(
      "/mapel",
      crudRoutes(db, {
        table: mapel,
        schema: mapelSchema,
        permission: "mapel.kelola",
        entitas: "mapel",
        list: () => db.select().from(mapel).orderBy(asc(mapel.nama)),
      }),
    )
    .route(
      "/pengajaran",
      crudRoutes(db, {
        table: pengajaran,
        schema: pengajaranSchema,
        permission: "jadwal.kelola",
        entitas: "pengajaran",
        canDelete: true,
        check: async (tx, data) => {
          await assertKelasBukanArsip(tx, data.kelasId);
          await assertActiveUser(tx, data.guruId, "Guru");
        },
        list: async (c) => {
          const ta = await resolveTahunAjaran(db, queryId(c, "tahunAjaranId"));
          if (!ta) return [];
          const rows = await db
            .select({
              id: pengajaran.id,
              kelasId: pengajaran.kelasId,
              mapelId: pengajaran.mapelId,
              guruId: pengajaran.guruId,
              kkm: pengajaran.kkm,
              kelasNama: kelas.nama,
              mapelNama: mapel.nama,
              mapelNamaArab: mapel.namaArab,
              guruNama: users.nama,
            })
            .from(pengajaran)
            .innerJoin(kelas, eq(kelas.id, pengajaran.kelasId))
            .innerJoin(mapel, eq(mapel.id, pengajaran.mapelId))
            .innerJoin(users, eq(users.id, pengajaran.guruId))
            .where(eq(kelas.tahunAjaranId, ta))
            .orderBy(asc(kelas.nama), asc(mapel.nama));
          const slots = await db
            .select()
            .from(jadwal)
            .innerJoin(pengajaran, eq(pengajaran.id, jadwal.pengajaranId))
            .innerJoin(kelas, eq(kelas.id, pengajaran.kelasId))
            .where(eq(kelas.tahunAjaranId, ta))
            .orderBy(asc(jadwal.hari), asc(jadwal.jamMulai));
          return rows.map((p) => ({
            ...p,
            jadwal: slots
              .filter((s) => s.jadwal.pengajaranId === p.id)
              .map((s) => ({
                ...s.jadwal,
                jamMulai: s.jadwal.jamMulai.slice(0, 5),
                jamSelesai: s.jadwal.jamSelesai.slice(0, 5),
              })),
          }));
        },
      }),
    )
    .route(
      "/jadwal",
      crudRoutes(db, {
        table: jadwal,
        schema: jadwalSchema,
        permission: "jadwal.kelola",
        entitas: "jadwal",
        canDelete: true,
      }),
    )
    .route(
      "/libur-mingguan",
      crudRoutes(db, {
        table: liburMingguan,
        schema: z.object({
          hari: z.coerce.number().int().min(1).max(7),
          unitId: z
            .uuid()
            .nullish()
            .transform((v) => v ?? null),
          lokasiId: z
            .uuid()
            .nullish()
            .transform((v) => v ?? null),
        }),
        permission: "pengaturan.kelola",
        entitas: "libur_mingguan",
        canDelete: true,
        list: () => db.select().from(liburMingguan).orderBy(asc(liburMingguan.hari)),
      }),
    )
    .get("/guru-pilihan", requireUser, async (c) => {
      // Nama staf untuk pilihan wali kelas / guru pengajar; wali santri murni tidak ditampilkan.
      const user = currentUser(c);
      const allowed =
        (await can(user, "kelas.kelola")) ||
        (await can(user, "jadwal.kelola")) ||
        (await can(user, "pengguna.kelola"));
      if (!allowed) throw fail(403, "Anda tidak punya akses");
      return c.json(
        await db
          .select({ id: users.id, nama: users.nama })
          .from(users)
          .where(
            and(
              eq(users.status, "aktif"),
              sql`(exists (select 1 from user_roles ur where ur.user_id = "users"."id")
                or not exists (select 1 from santri_wali sw where sw.user_id = "users"."id")
                or exists (select 1 from kelas k where k.wali_kelas_id = "users"."id")
                or exists (select 1 from pengajaran p where p.guru_id = "users"."id"))`,
            ),
          )
          .orderBy(asc(users.nama)),
      );
    });
}
