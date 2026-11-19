import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type PgBoss from "pg-boss";
import { createApp } from "../../src/server/app";
import { roles, userPhones, userRoles, users } from "../../src/server/db/schema";
import type { AppConfig } from "../../src/server/lib/context";
import { hashPassword } from "../../src/server/lib/password";
import { createStorage } from "../../src/server/lib/storage";
import { createTestDb } from "./db";

export const ORIGIN = "https://app.contoh.sch.id";
export const TURNSTILE_OK = "turnstile-ok";

type ReqOpts = { body?: unknown; cookie?: string; headers?: Record<string, string>; ip?: string };

/** Database tes + app + helper request/login/pengguna. */
export async function createTestContext(overrides: Partial<AppConfig> & { boss?: PgBoss } = {}) {
  const t = await createTestDb();
  const config: AppConfig = {
    version: "test",
    appUrl: ORIGIN,
    trustCloudflare: false,
    turnstileSiteKey: "site",
    ...overrides,
  };
  const scheduled: { name: string; tz: string }[] = [];
  const boss =
    overrides.boss ??
    ({
      getQueue: async () => ({}),
      schedule: async (name: string, _cron: string, _data: unknown, opts: { tz: string }) => {
        scheduled.push({ name, tz: opts.tz });
      },
    } as unknown as PgBoss);
  const app = createApp({
    db: t.db,
    pool: t.pool,
    boss,
    config,
    verifyTurnstile: async (token) => token === TURNSTILE_OK,
    storage: createStorage(mkdtempSync(join(tmpdir(), "tarbiyah-test-"))),
  });

  async function req(method: string, path: string, o: ReqOpts = {}) {
    const headers: Record<string, string> = { origin: ORIGIN, ...o.headers };
    if (o.cookie) headers.cookie = o.cookie;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(
      path,
      { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) },
      { incoming: { socket: { remoteAddress: o.ip ?? "10.0.0.1" } } },
    );
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  async function login(nomor: string, password: string, o: ReqOpts = {}) {
    const res = await req("POST", "/api/auth/login", {
      ...o,
      body: { nomor, password, turnstileToken: TURNSTILE_OK },
    });
    const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
    return { ...res, cookie };
  }

  /** Buat pengguna langsung di DB. roleNama: "Admin", "Bendahara", dst. */
  async function makeUser(opts: {
    nama: string;
    nomor: string;
    password?: string;
    roleNama?: string[];
    wajibGantiPassword?: boolean;
  }) {
    const passwordHash = await hashPassword(opts.password ?? "rahasia123");
    const [user] = await t.db
      .insert(users)
      .values({
        nama: opts.nama,
        passwordHash,
        wajibGantiPassword: opts.wajibGantiPassword ?? false,
      })
      .returning();
    if (!user) throw new Error("gagal membuat user");
    await t.db.insert(userPhones).values({ userId: user.id, nomor: opts.nomor });
    for (const nama of opts.roleNama ?? []) {
      const [role] = await t.db.select().from(roles).where(eq(roles.nama, nama));
      if (!role) throw new Error(`role ${nama} tidak ada`);
      await t.db.insert(userRoles).values({ userId: user.id, roleId: role.id });
    }
    return user;
  }

  async function roleId(nama: string) {
    const [role] = await t.db.select().from(roles).where(eq(roles.nama, nama));
    if (!role) throw new Error(`role ${nama} tidak ada`);
    return role.id;
  }

  return { ...t, app, req, login, makeUser, roleId, scheduled };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
