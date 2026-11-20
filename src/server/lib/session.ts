import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Db } from "../db/client";
import {
  kelas,
  pengajaran,
  rolePermissions,
  roles,
  santriWali,
  sessions,
  tahunAjaran,
  userRoles,
  users,
} from "../db/schema";
import type { AuthUser } from "./can";

const COOKIE = "tarbiyah"; // dengan prefix host → __Host-tarbiyah
export const SESSION_DAYS = 90;
const MAX_AGE = SESSION_DAYS * 24 * 60 * 60;
const REFRESH_AFTER_MS = 60 * 60 * 1000; // perpanjang paling sering sejam sekali

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const expiry = () => new Date(Date.now() + MAX_AGE * 1000);

export async function createSession(
  db: Db,
  userId: string,
  meta: { perangkat: string; ip: string },
) {
  const token = randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(sessions)
    .values({ tokenHash: hashToken(token), userId, kedaluwarsa: expiry(), ...meta })
    .returning({ id: sessions.id });
  return { token, id: row?.id as string };
}

export function setSessionCookie(c: Context, token: string) {
  setCookie(c, COOKIE, token, {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, COOKIE, { prefix: "host", path: "/", secure: true });
}

export const readSessionToken = (c: Context) => getCookie(c, COOKIE, "host");

/** Sesi aktif milik user aktif; diperpanjang (bergulir) bila sudah lewat sejam sejak aktif terakhir. */
export async function findSession(db: Db, token: string) {
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId, terakhirAktif: sessions.terakhirAktif })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.kedaluwarsa, sql`now()`),
        eq(users.status, "aktif"),
      ),
    );
  if (!row) return null;
  const refresh = Date.now() - row.terakhirAktif.getTime() > REFRESH_AFTER_MS;
  if (refresh) {
    await db
      .update(sessions)
      .set({ terakhirAktif: new Date(), kedaluwarsa: expiry() })
      .where(eq(sessions.id, row.id));
  }
  return { id: row.id, userId: row.userId, refreshed: refresh };
}

export async function loadAuthUser(db: Db, userId: string): Promise<AuthUser | null> {
  const [user] = await db
    .select({
      id: users.id,
      nama: users.nama,
      wajibGantiPassword: users.wajibGantiPassword,
      persetujuanAt: users.persetujuanAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const rows = await db
    .select({ id: roles.id, nama: roles.nama, admin: roles.admin, izin: rolePermissions.izin })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
    .where(eq(userRoles.userId, userId));
  const roleMap = new Map(rows.map((r) => [r.id, { id: r.id, nama: r.nama, admin: r.admin }]));
  // Relasi wali kelas & pengajar hanya untuk tahun ajaran aktif: tahun lalu tidak memberi akses
  // ke data santri bekas kelasnya (riwayat lama tetap bisa dilihat jabatan "lihat semua").
  const [kelasWali, ajar, anak] = await Promise.all([
    db
      .select({ id: kelas.id })
      .from(kelas)
      .innerJoin(tahunAjaran, eq(tahunAjaran.id, kelas.tahunAjaranId))
      .where(and(eq(kelas.waliKelasId, userId), eq(tahunAjaran.aktif, true))),
    db
      .select({ id: pengajaran.id, kelasId: pengajaran.kelasId })
      .from(pengajaran)
      .innerJoin(kelas, eq(kelas.id, pengajaran.kelasId))
      .innerJoin(tahunAjaran, eq(tahunAjaran.id, kelas.tahunAjaranId))
      .where(and(eq(pengajaran.guruId, userId), eq(tahunAjaran.aktif, true))),
    db.select({ id: santriWali.santriId }).from(santriWali).where(eq(santriWali.userId, userId)),
  ]);
  const { persetujuanAt, ...rest } = user;
  return {
    ...rest,
    perluPersetujuan: !persetujuanAt && anak.length > 0,
    isAdmin: rows.some((r) => r.admin),
    roles: [...roleMap.values()],
    permissions: new Set(rows.flatMap((r) => (r.izin ? [r.izin] : []))),
    relasi: {
      kelasWali: kelasWali.map((k) => k.id),
      pengajaran: ajar.map((p) => p.id),
      kelasAjar: [...new Set(ajar.map((p) => p.kelasId))],
      anak: anak.map((a) => a.id),
    },
  };
}

/** Ringkasan perangkat dari User-Agent, mis. "Chrome · Android". */
export function describeDevice(ua: string | undefined): string {
  if (!ua) return "Perangkat tidak dikenal";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Lainnya";
  return `${browser} · ${os}`;
}
