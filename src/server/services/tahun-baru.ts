import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import { LANJUT, type tahunBaruSchema, type UsulanTahunBaru } from "../../shared/tahun-baru";
import type { Db } from "../db/client";
import {
  kelas,
  lokasi,
  pendaftaran,
  santri,
  semester,
  tahunAjaran,
  tarifSpp,
  units,
} from "../db/schema";
import { audit } from "../lib/audit";
import { fail } from "../lib/context";
import { activeTahunAjaran } from "./sekolah";

/** "2026-07-13" → "2027-07-13" (29 Feb → 28 Feb). */
const tambahTahun = (t: string) => {
  const [y, m, d] = t.split("-").map(Number) as [number, number, number];
  const hari = Math.min(d, new Date(Date.UTC(y + 1, m, 0)).getUTCDate());
  return `${y + 1}-${String(m).padStart(2, "0")}-${String(hari).padStart(2, "0")}`;
};

/** Usulan: tahun +1, struktur kelas sama, santri naik ke tingkat +1 (tidak ada → lulus). */
export async function usulanTahunBaru(db: Db): Promise<UsulanTahunBaru> {
  const ta = await activeTahunAjaran(db);
  if (!ta) throw fail(409, "Belum ada tahun ajaran aktif");
  const sems = await db
    .select()
    .from(semester)
    .where(eq(semester.tahunAjaranId, ta.id))
    .orderBy(asc(semester.nomor));
  const kelasLama = await db
    .select({
      id: kelas.id,
      nama: kelas.nama,
      tingkat: kelas.tingkat,
      kelompok: kelas.kelompok,
      unitId: kelas.unitId,
      lokasiId: kelas.lokasiId,
      unitKode: units.kode,
      lokasiNama: lokasi.nama,
    })
    .from(kelas)
    .innerJoin(units, eq(units.id, kelas.unitId))
    .innerJoin(lokasi, eq(lokasi.id, kelas.lokasiId))
    .where(and(eq(kelas.tahunAjaranId, ta.id), eq(kelas.aktif, true)))
    .orderBy(asc(units.urutan), asc(lokasi.nama), asc(kelas.tingkat), asc(kelas.nama));
  const siswa = await db
    .select({
      santriId: santri.id,
      nama: santri.nama,
      nis: santri.nis,
      kelasId: pendaftaran.kelasId,
    })
    .from(pendaftaran)
    .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
    .where(
      and(
        eq(pendaftaran.tahunAjaranId, ta.id),
        eq(pendaftaran.status, "aktif"),
        eq(santri.status, "aktif"),
      ),
    )
    .orderBy(asc(santri.nama));

  const tujuan = (k: (typeof kelasLama)[number]) => {
    const atas = kelasLama.filter(
      (x) => x.unitId === k.unitId && x.lokasiId === k.lokasiId && x.tingkat === k.tingkat + 1,
    );
    return atas.find((x) => x.kelompok === k.kelompok) ?? atas[0] ?? null;
  };
  const [y] = ta.nama.split("/").map(Number) as [number];
  return {
    taLama: { id: ta.id, nama: ta.nama, mulai: ta.mulai, selesai: ta.selesai },
    usulan: {
      tahunAjaran: {
        nama: Number.isFinite(y) ? `${y + 1}/${y + 2}` : "",
        mulai: tambahTahun(ta.mulai),
        selesai: tambahTahun(ta.selesai),
      },
      semester: sems.map((s) => ({
        nomor: s.nomor,
        mulai: tambahTahun(s.mulai),
        selesai: tambahTahun(s.selesai),
      })),
    },
    kelas: kelasLama.map(({ unitId: _, lokasiId: __, ...k }) => k),
    santri: siswa.map((s) => {
      const asal = kelasLama.find((k) => k.id === s.kelasId);
      const t = asal ? tujuan(asal) : null;
      return { ...s, status: t ? "naik" : "lulus", kelasTujuanId: t?.id ?? null };
    }),
  };
}

/**
 * Jalankan dalam SATU transaksi: tahun & semester baru → salin kelas (struktur sama) dan tarif
 * SPP → pendaftaran baru sesuai keputusan → status santri pindah/lulus → tahun baru aktif.
 * Tahun lama otomatis menjadi arsip baca-saja (lebih lama dari tahun aktif).
 */
export async function jalankanTahunBaru(
  db: Db,
  input: z.output<typeof tahunBaruSchema>,
  user: { id: string; ip: string },
) {
  return db.transaction(async (tx) => {
    const [lama] = await tx
      .select()
      .from(tahunAjaran)
      .where(eq(tahunAjaran.aktif, true))
      .for("update");
    if (!lama) throw fail(409, "Belum ada tahun ajaran aktif");
    if (input.tahunAjaran.mulai <= lama.selesai) {
      throw fail(400, "Tahun ajaran baru harus dimulai setelah tahun ajaran lama selesai");
    }
    const aktif = await tx
      .select({ id: pendaftaran.id, santriId: pendaftaran.santriId, kelasId: pendaftaran.kelasId })
      .from(pendaftaran)
      .innerJoin(santri, eq(santri.id, pendaftaran.santriId))
      .where(
        and(
          eq(pendaftaran.tahunAjaranId, lama.id),
          eq(pendaftaran.status, "aktif"),
          eq(santri.status, "aktif"),
        ),
      );
    const putusan = new Map(input.keputusan.map((k) => [k.santriId, k]));
    if (putusan.size !== input.keputusan.length || aktif.some((a) => !putusan.has(a.santriId))) {
      throw fail(400, "Setiap santri aktif harus punya satu keputusan. Muat ulang wizard.");
    }
    if (input.keputusan.length !== aktif.length) {
      throw fail(400, "Ada santri yang bukan santri aktif tahun ini. Muat ulang wizard.");
    }

    const [baru] = await tx
      .insert(tahunAjaran)
      .values({ ...input.tahunAjaran, aktif: false })
      .returning();
    if (!baru) throw new Error("tahun ajaran gagal dibuat");
    const sems = await tx
      .insert(semester)
      .values(input.semester.map((s) => ({ ...s, tahunAjaranId: baru.id, aktif: false })))
      .returning();

    const kelasLama = await tx
      .select()
      .from(kelas)
      .where(and(eq(kelas.tahunAjaranId, lama.id), eq(kelas.aktif, true)));
    const salin = new Map<string, string>();
    if (kelasLama.length) {
      const rows = await tx
        .insert(kelas)
        .values(
          kelasLama.map((k) => ({
            tahunAjaranId: baru.id,
            unitId: k.unitId,
            lokasiId: k.lokasiId,
            nama: k.nama,
            tingkat: k.tingkat,
            kelompok: k.kelompok,
            waliKelasId: k.waliKelasId,
          })),
        )
        .returning({ id: kelas.id });
      kelasLama.forEach((k, i) => salin.set(k.id, rows[i]?.id as string));
    }
    const tarif = await tx.select().from(tarifSpp).where(eq(tarifSpp.tahunAjaranId, lama.id));
    if (tarif.length) {
      await tx.insert(tarifSpp).values(
        tarif.map((t) => ({
          tahunAjaranId: baru.id,
          unitId: t.unitId,
          lokasiId: t.lokasiId,
          nominal: t.nominal,
        })),
      );
    }

    const hitung: Record<string, number> = {};
    const pendaftaranBaru = [];
    for (const a of aktif) {
      const k = putusan.get(a.santriId);
      if (!k) continue;
      hitung[k.status] = (hitung[k.status] ?? 0) + 1;
      await tx.update(pendaftaran).set({ status: k.status }).where(eq(pendaftaran.id, a.id));
      if (LANJUT.includes(k.status)) {
        const kelasBaru = k.kelasId ? salin.get(k.kelasId) : undefined;
        if (!kelasBaru) throw fail(400, "Kelas tujuan tidak valid");
        pendaftaranBaru.push({ santriId: a.santriId, tahunAjaranId: baru.id, kelasId: kelasBaru });
      }
    }
    if (pendaftaranBaru.length) await tx.insert(pendaftaran).values(pendaftaranBaru);
    // Santri pindah/lulus tidak lagi aktif → tidak ditagih dan tidak muncul di kelas mana pun.
    for (const status of ["pindah", "lulus"] as const) {
      const ids = input.keputusan.filter((k) => k.status === status).map((k) => k.santriId);
      if (ids.length) {
        await tx
          .update(santri)
          .set({ status, diubahAt: new Date() })
          .where(inArray(santri.id, ids));
      }
    }

    // Tahun baru aktif + semester 1-nya; tahun lama menjadi arsip.
    await tx.update(semester).set({ aktif: false }).where(ne(semester.tahunAjaranId, baru.id));
    await tx.update(tahunAjaran).set({ aktif: false }).where(ne(tahunAjaran.id, baru.id));
    await tx.update(tahunAjaran).set({ aktif: true }).where(eq(tahunAjaran.id, baru.id));
    const sem1 = sems.find((s) => s.nomor === Math.min(...sems.map((x) => x.nomor)));
    if (sem1) await tx.update(semester).set({ aktif: true }).where(eq(semester.id, sem1.id));

    await audit(tx, {
      userId: user.id,
      aksi: "tahun_ajaran.baru",
      entitas: "tahun_ajaran",
      entitasId: baru.id,
      sebelum: { tahunAjaran: lama.nama },
      sesudah: { tahunAjaran: baru.nama, kelas: salin.size, tarif: tarif.length, ...hitung },
      ip: user.ip,
    });
    return { tahunAjaran: baru, kelas: salin.size, tarif: tarif.length, keputusan: hitung };
  });
}
