// Data contoh untuk development/staging (±200 santri, ±300 wali). Semua akun contoh berpassword
// "contoh123". Ditandai di pengaturan `data_contoh` dan nama lembaga "(DATA CONTOH)".
import { eq } from "drizzle-orm";
import { hashPassword } from "../lib/password";
import { uuidv7 } from "../lib/uuid";
import { DEFAULT_IDENTITAS } from "../services/pengaturan";
import type { Db } from "./client";
import {
  kelas,
  lokasi,
  mapel,
  nilai,
  pendaftaran,
  pengajaran,
  penilaian,
  raporAspek,
  roles,
  santri,
  santriWali,
  semester,
  settings,
  tahunAjaran,
  tarifSpp,
  units,
  userPhones,
  userRoles,
  users,
} from "./schema";

export const PASSWORD_CONTOH = "contoh123";

const PUTRA = [
  "Ahmad",
  "Muhammad",
  "Fauzan",
  "Rizki",
  "Hafiz",
  "Ilham",
  "Yusuf",
  "Zaki",
  "Fikri",
  "Raihan",
  "Daffa",
  "Akbar",
  "Hasan",
  "Husain",
  "Umar",
  "Bilal",
  "Salman",
  "Farhan",
  "Naufal",
  "Alif",
];
const PUTRI = [
  "Aisyah",
  "Fatimah",
  "Khadijah",
  "Zahra",
  "Nabila",
  "Salsabila",
  "Aulia",
  "Annisa",
  "Hana",
  "Nadia",
  "Syifa",
  "Rahma",
  "Azizah",
  "Maryam",
  "Zainab",
  "Kayla",
  "Naila",
  "Alya",
  "Safira",
  "Najwa",
];
const KELUARGA = [
  "Wonda",
  "Kogoya",
  "Rumbiak",
  "Ramadhan",
  "Saputra",
  "Hidayat",
  "Siregar",
  "Pratama",
  "Nasution",
  "Lubis",
  "Wenda",
  "Tabuni",
  "Hamid",
  "Rahman",
  "Syahputra",
  "Mansur",
  "Kurniawan",
  "Setiawan",
  "Hakim",
  "Fadillah",
];

let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)] as T;

export async function createSampleData(db: Db) {
  const [done] = await db.select().from(settings).where(eq(settings.key, "data_contoh"));
  if (done) return { dilewati: true as const };
  const hash = await hashPassword(PASSWORD_CONTOH);

  return db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values([
        { key: "data_contoh", value: { dibuatAt: new Date().toISOString() } },
        {
          key: "identitas",
          value: {
            ...DEFAULT_IDENTITAS,
            nama: "Pondok Pesantren Contoh (DATA CONTOH)",
            alamat: "Jayapura, Papua",
          },
        },
      ])
      .onConflictDoNothing();

    const lok = await tx
      .insert(lokasi)
      .values([{ nama: "KOTA" }, { nama: "RAHE" }])
      .returning();
    const un = await tx
      .insert(units)
      .values([
        { kode: "TA", nama: "Taman Al-Qur'an", urutan: 1 },
        { kode: "MDTU", nama: "MDT Ula", urutan: 2 },
        { kode: "MDTW", nama: "MDT Wustha", urutan: 3 },
      ])
      .returning();
    const [ta] = await tx
      .insert(tahunAjaran)
      .values({ nama: "2026/2027", mulai: "2026-07-13", selesai: "2027-06-30", aktif: true })
      .returning();
    if (!ta) throw new Error("tahun ajaran gagal dibuat");
    // Tarif SPP contoh per unit + lokasi (RAHE sedikit lebih murah).
    const TARIF: Record<string, number> = { TA: 100_000, MDTU: 150_000, MDTW: 175_000 };
    await tx.insert(tarifSpp).values(
      un.flatMap((u) =>
        lok.map((l) => ({
          tahunAjaranId: ta.id,
          unitId: u.id,
          lokasiId: l.id,
          nominal: (TARIF[u.kode] ?? 150_000) - (l.nama === "RAHE" ? 25_000 : 0),
        })),
      ),
    );
    await tx.insert(semester).values([
      { tahunAjaranId: ta.id, nomor: 1, mulai: "2026-07-13", selesai: "2026-12-19", aktif: true },
      { tahunAjaranId: ta.id, nomor: 2, mulai: "2027-01-04", selesai: "2027-06-30" },
    ]);

    // Staf: 14 guru + kepala sekolah + bendahara.
    const staf = Array.from({ length: 16 }, (_, i) => ({
      id: uuidv7(),
      nama:
        i === 14
          ? "Kepala Sekolah Contoh"
          : i === 15
            ? "Bendahara Contoh"
            : `Ustadz${i % 2 ? "ah" : ""} Contoh ${String(i + 1).padStart(2, "0")}`,
      passwordHash: hash,
    }));
    await tx.insert(users).values(staf);
    await tx.insert(userPhones).values(
      staf.map((u, i) => ({
        userId: u.id,
        nomor: `628000100${String(i).padStart(3, "0")}`,
        label: "Pribadi",
      })),
    );
    const roleRows = await tx.select().from(roles);
    const roleId = (nama: string) => roleRows.find((r) => r.nama === nama)?.id;
    const kepsek = roleId("Kepala Sekolah");
    const bendahara = roleId("Bendahara");
    if (kepsek && bendahara) {
      await tx.insert(userRoles).values([
        { userId: staf[14]?.id as string, roleId: kepsek },
        { userId: staf[15]?.id as string, roleId: bendahara },
      ]);
    }
    const guru = staf.slice(0, 14);

    // 12 kelas: 3 unit × 2 lokasi × 2 kelas.
    const KELAS: Record<
      string,
      { nama: string; tingkat: number; kelompok: "banin" | "banat" | "campur" }[]
    > = {
      TA: [
        { nama: "Kelas A", tingkat: 1, kelompok: "campur" },
        { nama: "Kelas B", tingkat: 2, kelompok: "campur" },
      ],
      MDTU: [
        { nama: "Kelas 1 Banin", tingkat: 1, kelompok: "banin" },
        { nama: "Kelas 1 Banat", tingkat: 1, kelompok: "banat" },
      ],
      MDTW: [
        { nama: "Kelas 1 Banin", tingkat: 1, kelompok: "banin" },
        { nama: "Kelas 1 Banat", tingkat: 1, kelompok: "banat" },
      ],
    };
    const kelasValues = un.flatMap((u) =>
      lok.flatMap((l) =>
        (KELAS[u.kode] ?? []).map((k) => ({
          ...k,
          tahunAjaranId: ta.id,
          unitId: u.id,
          lokasiId: l.id,
        })),
      ),
    );
    const kelasRows = await tx
      .insert(kelas)
      .values(kelasValues.map((k, i) => ({ ...k, waliKelasId: guru[i % guru.length]?.id })))
      .returning();

    const MAPEL: Record<string, [string, string][]> = {
      TA: [
        ["Iqra'", "إقرأ"],
        ["Hafalan Surat Pendek", "حفظ السور القصيرة"],
        ["Doa Harian", "الأدعية اليومية"],
        ["Akhlak", "الأخلاق"],
      ],
      MDTU: [
        ["Al-Qur'an", "القرآن"],
        ["Fiqih", "الفقه"],
        ["Aqidah Akhlak", "العقيدة والأخلاق"],
        ["Bahasa Arab", "اللغة العربية"],
        ["Tarikh", "التاريخ"],
      ],
      MDTW: [
        ["Al-Qur'an", "القرآن"],
        ["Fiqih", "الفقه"],
        ["Aqidah Akhlak", "العقيدة والأخلاق"],
        ["Bahasa Arab", "اللغة العربية"],
        ["Hadits", "الحديث"],
      ],
    };
    const mapelRows = await tx
      .insert(mapel)
      .values(
        un.flatMap((u) =>
          (MAPEL[u.kode] ?? []).map(([nama, namaArab]) => ({ nama, namaArab, unitId: u.id })),
        ),
      )
      .returning();
    let g = 0;
    await tx.insert(pengajaran).values(
      kelasRows.flatMap((k) =>
        mapelRows
          .filter((m) => m.unitId === k.unitId)
          .map((m) => ({
            kelasId: k.id,
            mapelId: m.id,
            guruId: guru[g++ % guru.length]?.id as string,
            kkm: 70,
          })),
      ),
    );

    // ±200 santri (17 per kelas) dari ±150 keluarga; tiap keluarga punya ayah & ibu (±300 wali).
    const santriValues: (typeof santri.$inferInsert & {
      id: string;
      kelasId: string;
      keluarga: number;
    })[] = [];
    let nis = 1;
    let keluarga = 0;
    for (const k of kelasRows) {
      for (let i = 0; i < 17; i++) {
        const putra = k.kelompok === "banin" || (k.kelompok === "campur" && rand() < 0.5);
        const depan = pick(putra ? PUTRA : PUTRI);
        // Sekitar seperempat santri punya saudara kandung di kelas lain (wali sama).
        const fam = rand() < 0.27 && keluarga > 0 ? Math.floor(rand() * keluarga) : keluarga++;
        santriValues.push({
          id: uuidv7(),
          nis: `C${String(nis++).padStart(4, "0")}`,
          nama: `${depan} ${pick(KELUARGA)}`,
          namaPanggilan: depan,
          jenisKelamin: putra ? "L" : "P",
          tempatLahir: pick(["Jayapura", "Sentani", "Wamena", "Merauke", "Biak"]),
          tanggalLahir: `${2014 + Math.floor(rand() * 6)}-${String(1 + Math.floor(rand() * 12)).padStart(2, "0")}-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
          alamat: "Alamat contoh",
          kelasId: k.id,
          keluarga: fam,
        });
      }
    }
    await tx.insert(santri).values(santriValues.map(({ kelasId: _, keluarga: __, ...s }) => s));
    await tx.insert(pendaftaran).values(
      santriValues.map((s, i) => ({
        santriId: s.id,
        tahunAjaranId: ta.id,
        kelasId: s.kelasId,
        noAbsen: (i % 17) + 1,
      })),
    );

    const wali = Array.from({ length: keluarga }, (_, f) => [
      {
        id: uuidv7(),
        nama: `Bapak ${pick(PUTRA)} (contoh)`,
        nomor: `6280002${String(f).padStart(5, "0")}`,
        hubungan: "ayah" as const,
      },
      {
        id: uuidv7(),
        nama: `Ibu ${pick(PUTRI)} (contoh)`,
        nomor: `6280003${String(f).padStart(5, "0")}`,
        hubungan: "ibu" as const,
      },
    ]);
    const waliFlat = wali.flat();
    await tx
      .insert(users)
      .values(waliFlat.map((w) => ({ id: w.id, nama: w.nama, passwordHash: hash })));
    await tx.insert(userPhones).values(
      waliFlat.map((w) => ({
        userId: w.id,
        nomor: w.nomor,
        label: w.hubungan === "ayah" ? "Ayah" : "Ibu",
      })),
    );
    await tx.insert(santriWali).values(
      santriValues.flatMap((s) =>
        (wali[s.keluarga] ?? []).map((w) => ({
          santriId: s.id,
          userId: w.id,
          hubungan: w.hubungan,
          penerimaTagihan: true,
        })),
      ),
    );

    return {
      dilewati: false as const,
      lokasi: lok.length,
      unit: un.length,
      kelas: kelasRows.length,
      santri: santriValues.length,
      wali: waliFlat.length,
      guru: guru.length,
    };
  });
}

/**
 * Nilai contoh untuk satu kelas (semester aktif) + aspek rapor bawaan tiap unit, agar alur rapor
 * (isi → kunci → cetak) bisa langsung dicoba. Ditandai dengan pengaturan `data_contoh_nilai`.
 */
export async function createSampleNilai(db: Db) {
  const [done] = await db.select().from(settings).where(eq(settings.key, "data_contoh_nilai"));
  if (done) return null;
  const [sem] = await db.select().from(semester).where(eq(semester.aktif, true));
  if (!sem) return null;
  const allUnits = await db.select().from(units);
  return db.transaction(async (tx) => {
    await tx
      .insert(settings)
      .values({ key: "data_contoh_nilai", value: { dibuatAt: new Date().toISOString() } });
    for (const u of allUnits) {
      await tx.insert(raporAspek).values([
        { unitId: u.id, kelompok: "Sikap", nama: "Akhlak", tipe: "predikat" as const, urutan: 0 },
        {
          unitId: u.id,
          kelompok: "Sikap",
          nama: "Kedisiplinan",
          tipe: "predikat" as const,
          urutan: 1,
        },
        {
          unitId: u.id,
          kelompok: "Sikap",
          nama: "Kebersihan",
          tipe: "predikat" as const,
          urutan: 2,
        },
        {
          unitId: u.id,
          kelompok: "Hafalan",
          nama: "Hafalan Juz 30",
          tipe: "teks" as const,
          urutan: 3,
        },
      ]);
    }
    // Kelas pertama yang punya santri di tahun ajaran semester aktif.
    const [k] = await tx
      .select({ id: kelas.id })
      .from(kelas)
      .innerJoin(pendaftaran, eq(pendaftaran.kelasId, kelas.id))
      .where(eq(kelas.tahunAjaranId, sem.tahunAjaranId))
      .orderBy(kelas.nama)
      .limit(1);
    if (!k) return null;
    const ajar = await tx.select().from(pengajaran).where(eq(pengajaran.kelasId, k.id));
    const siswa = await tx.select().from(pendaftaran).where(eq(pendaftaran.kelasId, k.id));
    const plan = [
      { jenis: "PR" as const, judul: "PR 1", tanggal: "2026-08-10" },
      { jenis: "UH" as const, judul: "Ulangan Harian 1", tanggal: "2026-08-24" },
      { jenis: "UH" as const, judul: "Ulangan Harian 2", tanggal: "2026-09-21" },
      { jenis: "UTS" as const, judul: "UTS", tanggal: "2026-10-05" },
      { jenis: "UAS" as const, judul: "UAS", tanggal: "2026-12-07" },
    ];
    for (const p of ajar) {
      for (const x of plan) {
        const [pn] = await tx
          .insert(penilaian)
          .values({ ...x, pengajaranId: p.id, semesterId: sem.id, dibuatOleh: p.guruId })
          .returning();
        if (!pn) continue;
        await tx.insert(nilai).values(
          siswa.map((s) => ({
            penilaianId: pn.id,
            pendaftaranId: s.id,
            nilai: 65 + Math.floor(rand() * 34),
          })),
        );
      }
    }
    return { kelasId: k.id, mapel: ajar.length, santri: siswa.length };
  });
}
