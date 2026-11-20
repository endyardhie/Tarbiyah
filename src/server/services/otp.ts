import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { type Db, transactionWithClient } from "../db/client";
import { otpCodes, sessions, userPhones, users } from "../db/schema";
import { audit } from "../lib/audit";
import { fail } from "../lib/context";
import { hashPassword } from "../lib/password";
import { clearFailures } from "../lib/rate-limit";
import { getIdentitas } from "./pengaturan";
import { getWaConfig, queueWa } from "./wa";

export const OTP_BERLAKU_MENIT = 5;
export const OTP_MAKS_PERCOBAAN = 5;

/** Hash ber-kunci: dump database saja tidak cukup untuk menebak 6 digit secara offline. */
const hashKode = (key: string, nomor: string, kode: string) =>
  createHmac("sha256", Buffer.from(key, "base64")).update(`${nomor}:${kode}`).digest("hex");

type Deps = { db: Db; pool: pg.Pool; boss: PgBoss; encryptionKey: string };

/**
 * Buat OTP 6 digit & antrekan ke WA nomor itu. Diam-diam tidak melakukan apa pun bila nomor
 * tidak terdaftar (jawaban ke pengguna selalu sama, agar nomor terdaftar tidak bisa ditebak).
 */
export async function mintaOtp(deps: Deps, nomor: string) {
  if (!(await getWaConfig(deps.db, deps.encryptionKey))) {
    throw fail(409, "Reset lewat WhatsApp sedang tidak tersedia. Hubungi admin sekolah.");
  }
  const [user] = await deps.db
    .select({ id: users.id })
    .from(userPhones)
    .innerJoin(users, eq(users.id, userPhones.userId))
    .where(
      and(
        eq(userPhones.nomor, nomor),
        eq(userPhones.untukLogin, true),
        eq(userPhones.punyaWa, true),
        eq(users.status, "aktif"),
      ),
    );
  if (!user) return;
  const kode = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const ident = await getIdentitas(deps.db);
  await transactionWithClient(deps.pool, async (tx, client) => {
    // Kode lama tidak berlaku lagi begitu kode baru diminta.
    await tx
      .update(otpCodes)
      .set({ dipakaiAt: new Date() })
      .where(and(eq(otpCodes.nomor, nomor), isNull(otpCodes.dipakaiAt)));
    const [row] = await tx
      .insert(otpCodes)
      .values({
        nomor,
        userId: user.id,
        kodeHash: hashKode(deps.encryptionKey, nomor, kode),
        kedaluwarsa: sql`now() + make_interval(mins => ${OTP_BERLAKU_MENIT})`,
      })
      .returning({ id: otpCodes.id });
    await queueWa(
      tx,
      client,
      deps.boss,
      [
        {
          nomor,
          pesan: `Kode reset password ${ident.namaSingkat}: ${kode}\nBerlaku ${OTP_BERLAKU_MENIT} menit. Jangan berikan kode ini kepada siapa pun.`,
          rujukanTipe: "otp",
          rujukanId: row?.id ?? "",
        },
      ],
      { priority: 10 },
    );
  });
}

/** Cocokkan OTP lalu set password baru; semua sesi lama dikeluarkan. */
export async function resetDenganOtp(
  deps: Deps,
  p: { nomor: string; kode: string; passwordBaru: string; ip: string },
) {
  const [otp] = await deps.db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.nomor, p.nomor),
        isNull(otpCodes.dipakaiAt),
        gt(otpCodes.kedaluwarsa, sql`now()`),
      ),
    )
    .orderBy(desc(otpCodes.dibuatAt))
    .limit(1);
  if (!otp) throw fail(400, "Kode salah atau sudah kedaluwarsa. Minta kode baru.");
  if (otp.percobaan >= OTP_MAKS_PERCOBAAN) {
    throw fail(429, "Terlalu banyak percobaan. Minta kode baru.");
  }
  // Naikkan percobaan secara atomik sebelum membandingkan (cegah tebakan paralel).
  const [naik] = await deps.db
    .update(otpCodes)
    .set({ percobaan: sql`${otpCodes.percobaan} + 1` })
    .where(
      and(
        eq(otpCodes.id, otp.id),
        isNull(otpCodes.dipakaiAt),
        sql`${otpCodes.percobaan} < ${OTP_MAKS_PERCOBAAN}`,
      ),
    )
    .returning({ id: otpCodes.id });
  if (!naik) throw fail(429, "Terlalu banyak percobaan. Minta kode baru.");
  const expected = Buffer.from(otp.kodeHash, "hex");
  const given = Buffer.from(hashKode(deps.encryptionKey, p.nomor, p.kode.trim()), "hex");
  if (!timingSafeEqual(expected, given)) throw fail(400, "Kode salah.");

  const passwordHash = await hashPassword(p.passwordBaru);
  await deps.db.transaction(async (tx) => {
    const [pakai] = await tx
      .update(otpCodes)
      .set({ dipakaiAt: new Date() })
      .where(and(eq(otpCodes.id, otp.id), isNull(otpCodes.dipakaiAt)))
      .returning({ id: otpCodes.id });
    if (!pakai) throw fail(400, "Kode sudah dipakai.");
    await tx
      .update(users)
      .set({ passwordHash, wajibGantiPassword: false, diubahAt: new Date() })
      .where(eq(users.id, otp.userId));
    await tx.delete(sessions).where(eq(sessions.userId, otp.userId));
    // Kunci "terlalu banyak percobaan login" untuk nomor ini tidak berlaku lagi.
    await clearFailures(tx, `login:hp:${p.nomor}`);
    await audit(tx, {
      userId: otp.userId,
      aksi: "password.reset_otp",
      entitas: "users",
      entitasId: otp.userId,
      ip: p.ip,
    });
  });
}
