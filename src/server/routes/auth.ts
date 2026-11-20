import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { normalizePhone } from "../../shared/phone";
import { loginSchema, otpMintaSchema, otpResetSchema } from "../../shared/schemas";
import { sessions, users } from "../db/schema";
import { audit } from "../lib/audit";
import { type AppDeps, type AppEnv, fail, parseBody } from "../lib/context";
import { requireUser } from "../lib/guards";
import { burnPasswordCheck, verifyPassword } from "../lib/password";
import { clearFailures, lockedFor, recordFailure } from "../lib/rate-limit";
import {
  clearSessionCookie,
  createSession,
  describeDevice,
  loadAuthUser,
  setSessionCookie,
} from "../lib/session";
import { mintaOtp, resetDenganOtp } from "../services/otp";
import { findLoginUser } from "../services/users";
import { meResponse } from "./me";

const WINDOW_SEC = 15 * 60;
const PHONE_LIMIT = 5; // gagal per nomor per 15 menit
const IP_LIMIT = 30; // gagal per IP per 15 menit (wifi sekolah dipakai bersama)
const OTP_PER_NOMOR = 3; // permintaan OTP per nomor per jam
const OTP_PER_IP = 10;

export function authRoutes({ db, pool, boss, config, verifyTurnstile }: AppDeps) {
  const otpDeps = { db, pool, boss, encryptionKey: config.encryptionKey };
  return (
    new Hono<AppEnv>()
      .post("/login", async (c) => {
        const body = await parseBody(c, loginSchema);
        const ip = c.get("ip");
        if (!(await verifyTurnstile(body.turnstileToken, ip))) {
          throw fail(400, "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.");
        }
        const nomor = normalizePhone(body.nomor);
        const ipKey = `login:ip:${ip}`;
        const phoneKey = nomor ? `login:hp:${nomor}` : null;
        const wait = Math.max(
          await lockedFor(db, ipKey, IP_LIMIT),
          phoneKey ? await lockedFor(db, phoneKey, PHONE_LIMIT) : 0,
        );
        if (wait > 0) {
          throw fail(
            429,
            `Terlalu banyak percobaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`,
          );
        }

        const found = nomor ? await findLoginUser(db, nomor) : null;
        const ok = found
          ? await verifyPassword(found.passwordHash, body.password)
          : await burnPasswordCheck(body.password).then(() => false);
        if (!found || !ok) {
          await recordFailure(db, ipKey, WINDOW_SEC);
          if (phoneKey) await recordFailure(db, phoneKey, WINDOW_SEC);
          throw fail(401, "Nomor HP atau password salah");
        }

        if (phoneKey) await clearFailures(db, phoneKey);
        const perangkat = describeDevice(c.req.header("user-agent"));
        const { token } = await createSession(db, found.id, { perangkat, ip });
        await audit(db, {
          userId: found.id,
          aksi: "login",
          entitas: "sessions",
          sesudah: { perangkat },
          ip,
        });
        await db.update(users).set({ loginTerakhir: new Date() }).where(eq(users.id, found.id));
        setSessionCookie(c, token);
        const auth = await loadAuthUser(db, found.id);
        if (!auth) throw fail(401, "Nomor HP atau password salah");
        return c.json(await meResponse(db, auth));
      })
      // Lupa password: OTP via WA. Maks 3 permintaan/jam per nomor dan 10/jam per IP.
      .post("/otp/minta", async (c) => {
        const body = await parseBody(c, otpMintaSchema);
        const ip = c.get("ip");
        if (!(await verifyTurnstile(body.turnstileToken, ip))) {
          throw fail(400, "Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.");
        }
        const nomor = normalizePhone(body.nomor);
        if (!nomor) throw fail(400, "Nomor HP tidak valid");
        const keys = [
          { key: `otp:hp:${nomor}`, limit: OTP_PER_NOMOR },
          { key: `otp:ip:${ip}`, limit: OTP_PER_IP },
        ];
        for (const k of keys) {
          const wait = await lockedFor(db, k.key, k.limit);
          if (wait > 0) {
            throw fail(
              429,
              `Terlalu banyak permintaan kode. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`,
            );
          }
        }
        for (const k of keys) await recordFailure(db, k.key, 60 * 60);
        await mintaOtp(otpDeps, nomor);
        return c.json({ ok: true });
      })
      .post("/otp/reset", async (c) => {
        const body = await parseBody(c, otpResetSchema);
        const nomor = normalizePhone(body.nomor);
        if (!nomor) throw fail(400, "Nomor HP tidak valid");
        await resetDenganOtp(otpDeps, { ...body, nomor, ip: c.get("ip") });
        return c.json({ ok: true });
      })
      .post("/logout", requireUser, async (c) => {
        const id = c.get("sessionId");
        if (id) await db.delete(sessions).where(eq(sessions.id, id));
        clearSessionCookie(c);
        return c.json({ ok: true });
      })
  );
}
