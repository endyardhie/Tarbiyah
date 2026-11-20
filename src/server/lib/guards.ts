import type { MiddlewareHandler } from "hono";
import type { Permission } from "../../shared/permissions";
import { can } from "./can";
import { type AppEnv, fail } from "./context";

// Selama wajib ganti password, hanya endpoint ini yang boleh dipakai.
const ALLOWED_WHILE_MUST_CHANGE = new Set([
  "GET /api/me",
  "POST /api/me/password",
  "POST /api/auth/logout",
]);

// Wali santri wajib menyetujui pemrosesan data sebelum memakai aplikasi.
const ALLOWED_BEFORE_CONSENT = new Set([
  ...ALLOWED_WHILE_MUST_CHANGE,
  "GET /api/me/persetujuan",
  "POST /api/me/persetujuan",
]);

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) throw fail(401, "Silakan masuk terlebih dahulu");
  const rute = `${c.req.method} ${c.req.path}`;
  if (user.wajibGantiPassword && !ALLOWED_WHILE_MUST_CHANGE.has(rute)) {
    throw fail(403, "Ganti password terlebih dahulu");
  }
  if (user.perluPersetujuan && !ALLOWED_BEFORE_CONSENT.has(rute)) {
    throw fail(403, "Setujui pemrosesan data terlebih dahulu");
  }
  await next();
};

export const requirePermission =
  (permission: Permission): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const user = c.get("user");
    if (!user || !(await can(user, permission))) throw fail(403, "Anda tidak punya akses");
    await next();
  };

/** Lolos bila punya salah satu izin (mis. bendahara: lihat/kelola/catat manual). */
export const requireAnyPermission =
  (...permissions: Permission[]): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const user = c.get("user");
    if (!user) throw fail(403, "Anda tidak punya akses");
    for (const p of permissions) {
      if (await can(user, p)) return next();
    }
    throw fail(403, "Anda tidak punya akses");
  };
