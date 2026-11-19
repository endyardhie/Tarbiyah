import { eq, inArray, sql } from "drizzle-orm";
import { normalizePhone } from "../../shared/phone";
import { type BarisImpor, HUBUNGAN } from "../../shared/sekolah";
import type { Db } from "../db/client";
import {
  kelas,
  lokasi,
  pendaftaran,
  santri,
  santriWali,
  units,
  userPhones,
  users,
} from "../db/schema";
import { audit } from "../lib/audit";
import { hashPassword, tempPassword } from "../lib/password";
import { uuidv7 } from "../lib/uuid";

type WaliPlan = {
  nama: string;
  nomor: string;
  hubungan: (typeof HUBUNGAN)[number];
  aksi: "baru" | "ada";
};
export type BarisHasil = {
  baris: number;
  nis: string;
  nama: string;
  kelas: string | null;
  aksi: "baru" | "ubah";
  wali: WaliPlan[];
  errors: string[];
  warnings: string[];
};

const clean = (v: string | undefined) => (v ?? "").trim();

function parseTanggal(v: string): string | null | "invalid" {
  if (!v) return null;
  const m =
    v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!m) return "invalid";
  const [y, mo, d] =
    v.includes("-") && m[1]?.length === 4 ? [m[1], m[2], m[3]] : [m[3], m[2], m[1]];
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso ? "invalid" : iso;
}

function parseJk(v: string): "L" | "P" | null | "invalid" {
  const x = v.toLowerCase();
  if (!x) return null;
  if (["l", "lk", "laki-laki", "laki laki", "putra"].includes(x)) return "L";
  if (["p", "pr", "perempuan", "putri"].includes(x)) return "P";
  return "invalid";
}

/** Validasi semua baris tanpa menulis apa pun. */
export async function planImport(db: Db, tahunAjaranId: string, rawRows: Record<string, string>[]) {
  const rows: BarisImpor[] = rawRows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim().toLowerCase(), v])),
  );
  const kelasList = await db
    .select({ id: kelas.id, nama: kelas.nama, unit: units.kode, lokasi: lokasi.nama })
    .from(kelas)
    .innerJoin(units, eq(units.id, kelas.unitId))
    .innerJoin(lokasi, eq(lokasi.id, kelas.lokasiId))
    .where(eq(kelas.tahunAjaranId, tahunAjaranId));
  const kelasKey = (u: string, l: string, k: string) =>
    `${u.toUpperCase()}|${l.toLowerCase()}|${k.toLowerCase()}`;
  const kelasMap = new Map(kelasList.map((k) => [kelasKey(k.unit, k.lokasi, k.nama), k]));

  const nisList = rows.map((r) => clean(r.nis)).filter(Boolean);
  const existingNis = new Set(
    nisList.length
      ? (await db.select({ nis: santri.nis }).from(santri).where(inArray(santri.nis, nisList))).map(
          (r) => r.nis,
        )
      : [],
  );
  const phonesInFile = rows
    .flatMap((r) => [r.wali1_hp, r.wali2_hp])
    .map((p) => normalizePhone(clean(p)) ?? "")
    .filter(Boolean);
  const existingPhones = new Map(
    phonesInFile.length
      ? (
          await db
            .select({ nomor: userPhones.nomor, userId: users.id, nama: users.nama })
            .from(userPhones)
            .innerJoin(users, eq(users.id, userPhones.userId))
            .where(inArray(userPhones.nomor, phonesInFile))
        ).map((r) => [r.nomor, r])
      : [],
  );

  const nisSeen = new Map<string, number>();
  const waliByPhone = new Map<string, string>(); // nomor → nama pertama di file
  const hasil: BarisHasil[] = rows.map((r, i) => {
    const baris = i + 2; // baris 1 = judul kolom
    const errors: string[] = [];
    const warnings: string[] = [];
    const nis = clean(r.nis);
    const nama = clean(r.nama);
    if (!nis) errors.push("NIS kosong");
    else if (nisSeen.has(nis)) errors.push(`NIS ganda dengan baris ${nisSeen.get(nis)}`);
    else nisSeen.set(nis, baris);
    if (!nama) errors.push("Nama kosong");
    if (parseJk(clean(r.jenis_kelamin)) === "invalid") errors.push("Jenis kelamin harus L atau P");
    if (parseTanggal(clean(r.tanggal_lahir)) === "invalid")
      errors.push("Tanggal lahir tidak valid");

    const [u, l, k] = [clean(r.unit), clean(r.lokasi), clean(r.kelas)];
    let kelasLabel: string | null = null;
    if (u || l || k) {
      const found = kelasMap.get(kelasKey(u, l, k));
      if (!found) errors.push(`Kelas "${k}" (${u} ${l}) tidak ada di tahun ajaran ini`);
      else kelasLabel = `${found.nama} · ${found.unit} ${found.lokasi}`;
    }

    const wali: WaliPlan[] = [];
    for (const n of [1, 2] as const) {
      const wNama = clean(r[`wali${n}_nama`]);
      const wHp = clean(r[`wali${n}_hp`]);
      const wHub = clean(r[`wali${n}_hubungan`]).toLowerCase() || "wali";
      if (!wNama && !wHp) continue;
      if (!wNama) errors.push(`Nama wali ${n} kosong`);
      const nomor = normalizePhone(wHp);
      if (!nomor) {
        errors.push(`Nomor HP wali ${n} tidak valid`);
        continue;
      }
      if (!(HUBUNGAN as readonly string[]).includes(wHub)) {
        errors.push(`Hubungan wali ${n} harus ayah, ibu, atau wali`);
        continue;
      }
      const existing = existingPhones.get(nomor);
      const firstName = waliByPhone.get(nomor);
      if (firstName && firstName.toLowerCase() !== wNama.toLowerCase()) {
        warnings.push(
          `Nomor ${nomor} dipakai "${firstName}" di baris lain; digabung sebagai satu wali`,
        );
      }
      if (existing && existing.nama.toLowerCase() !== wNama.toLowerCase()) {
        warnings.push(
          `Nomor ${nomor} sudah milik akun "${existing.nama}"; santri dihubungkan ke akun itu`,
        );
      }
      if (!firstName) waliByPhone.set(nomor, wNama);
      wali.push({
        nama: existing?.nama ?? firstName ?? wNama,
        nomor,
        hubungan: wHub as WaliPlan["hubungan"],
        aksi: existing ? "ada" : "baru",
      });
    }
    return {
      baris,
      nis,
      nama,
      kelas: kelasLabel,
      aksi: existingNis.has(nis) ? "ubah" : "baru",
      wali,
      errors,
      warnings,
    };
  });

  const waliBaru = new Set(
    hasil.flatMap((h) => h.wali.filter((w) => w.aksi === "baru").map((w) => w.nomor)),
  );
  const waliAda = new Set(
    hasil.flatMap((h) => h.wali.filter((w) => w.aksi === "ada").map((w) => w.nomor)),
  );
  return {
    rows: hasil,
    ringkasan: {
      santriBaru: hasil.filter((h) => h.aksi === "baru").length,
      santriUbah: hasil.filter((h) => h.aksi === "ubah").length,
      waliBaru: waliBaru.size,
      waliAda: waliAda.size,
      barisError: hasil.filter((h) => h.errors.length).length,
    },
    _parsed: { rows, kelasMap, kelasKey, existingPhones },
  };
}

/** Jalankan impor (setelah planImport tanpa error) dalam satu transaksi. */
export async function runImport(
  db: Db,
  actorId: string,
  ip: string,
  tahunAjaranId: string,
  plan: Awaited<ReturnType<typeof planImport>>,
) {
  const { rows, kelasMap, kelasKey, existingPhones } = plan._parsed;

  // Akun wali baru: satu per nomor, password sementara di-hash di luar transaksi (4 sekaligus).
  const newWali = new Map<
    string,
    { id: string; nama: string; nomor: string; password: string; hash: string }
  >();
  for (const h of plan.rows) {
    for (const w of h.wali) {
      if (w.aksi === "baru" && !newWali.has(w.nomor)) {
        newWali.set(w.nomor, {
          id: uuidv7(),
          nama: w.nama,
          nomor: w.nomor,
          password: tempPassword(),
          hash: "",
        });
      }
    }
  }
  const pending = [...newWali.values()];
  for (let i = 0; i < pending.length; i += 4) {
    await Promise.all(
      pending.slice(i, i + 4).map(async (w) => {
        w.hash = await hashPassword(w.password);
      }),
    );
  }

  await db.transaction(async (tx) => {
    if (pending.length) {
      await tx.insert(users).values(
        pending.map((w) => ({
          id: w.id,
          nama: w.nama,
          passwordHash: w.hash,
          wajibGantiPassword: true,
        })),
      );
      await tx
        .insert(userPhones)
        .values(pending.map((w) => ({ userId: w.id, nomor: w.nomor, label: null })));
    }

    const santriRows = rows.map((r) => {
      const jk = parseJk(clean(r.jenis_kelamin));
      const tgl = parseTanggal(clean(r.tanggal_lahir));
      return {
        nis: clean(r.nis),
        nama: clean(r.nama),
        namaPanggilan: clean(r.nama_panggilan) || null,
        jenisKelamin: jk === "invalid" ? null : jk,
        tempatLahir: clean(r.tempat_lahir) || null,
        tanggalLahir: tgl === "invalid" ? null : tgl,
        alamat: clean(r.alamat) || null,
      };
    });
    const saved = await tx
      .insert(santri)
      .values(santriRows)
      .onConflictDoUpdate({
        target: santri.nis,
        set: {
          nama: sql`excluded.nama`,
          namaPanggilan: sql`excluded.nama_panggilan`,
          jenisKelamin: sql`excluded.jenis_kelamin`,
          tempatLahir: sql`excluded.tempat_lahir`,
          tanggalLahir: sql`excluded.tanggal_lahir`,
          alamat: sql`excluded.alamat`,
          diubahAt: sql`now()`,
        },
      })
      .returning({ id: santri.id, nis: santri.nis });
    const idByNis = new Map(saved.map((s) => [s.nis, s.id]));

    const daftar = rows.flatMap((r) => {
      const k = kelasMap.get(kelasKey(clean(r.unit), clean(r.lokasi), clean(r.kelas)));
      const santriId = idByNis.get(clean(r.nis));
      return k && santriId ? [{ santriId, tahunAjaranId, kelasId: k.id }] : [];
    });
    if (daftar.length) {
      await tx
        .insert(pendaftaran)
        .values(daftar)
        .onConflictDoUpdate({
          target: [pendaftaran.santriId, pendaftaran.tahunAjaranId],
          set: { kelasId: sql`excluded.kelas_id` },
        });
    }

    const links = new Map<
      string,
      { santriId: string; userId: string; hubungan: WaliPlan["hubungan"] }
    >();
    plan.rows.forEach((h) => {
      const santriId = idByNis.get(h.nis);
      if (!santriId) return;
      for (const w of h.wali) {
        const userId = newWali.get(w.nomor)?.id ?? existingPhones.get(w.nomor)?.userId;
        if (userId) links.set(`${santriId}|${userId}`, { santriId, userId, hubungan: w.hubungan });
      }
    });
    if (links.size) {
      await tx
        .insert(santriWali)
        .values([...links.values()])
        .onConflictDoUpdate({
          target: [santriWali.santriId, santriWali.userId],
          set: { hubungan: sql`excluded.hubungan` },
        });
    }
    await audit(tx, {
      userId: actorId,
      aksi: "impor.santri",
      entitas: "santri",
      sesudah: plan.ringkasan,
      ip,
    });
  });

  return {
    ringkasan: plan.ringkasan,
    akunBaru: pending.map((w) => ({ nama: w.nama, nomor: w.nomor, passwordSementara: w.password })),
  };
}
