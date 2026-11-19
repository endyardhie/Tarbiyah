import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type pg from "pg";
import type PgBoss from "pg-boss";
import { z } from "zod";
import type { Db } from "../db/client";
import type { AuthUser } from "./can";
import type { Storage } from "./storage";
import type { VerifyTurnstile } from "./turnstile";

export type AppConfig = {
  version: string;
  appUrl: string;
  trustCloudflare: boolean;
  turnstileSiteKey: string;
};

export type AppDeps = {
  db: Db;
  pool: pg.Pool;
  boss: PgBoss;
  config: AppConfig;
  verifyTurnstile: VerifyTurnstile;
  storage: Storage;
  /** Jam sekarang; bisa diganti di tes (mis. tepat tengah malam WIT). */
  now?: () => Date;
  staticDir?: string;
};

export type AppEnv = {
  Variables: { user: AuthUser | null; sessionId: string | null; ip: string };
};

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  const body = await c.req.json().catch(() => null);
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HTTPException(400, {
      message: result.error.issues[0]?.message ?? "Data tidak valid",
    });
  }
  return result.data;
}

/** User yang sudah login (dipakai setelah middleware requireUser). */
export function currentUser(c: Context<AppEnv>): AuthUser {
  const user = c.get("user");
  if (!user) throw new HTTPException(401, { message: "Silakan masuk terlebih dahulu" });
  return user;
}

export const fail = (status: 400 | 401 | 403 | 404 | 409 | 429, message: string) =>
  new HTTPException(status, { message });

const uuidSchema = z.uuid();
/** Parameter :id yang bukan UUID dijawab 404, bukan error database. */
export function paramId(c: Context, name = "id"): string {
  const id = c.req.param(name);
  if (!id || !uuidSchema.safeParse(id).success) throw fail(404, "Data tidak ditemukan");
  return id;
}

/** Query ?nama=<uuid> opsional: kosong → undefined, bukan UUID → 400. */
export function queryId(c: Context, name: string): string | undefined {
  const v = c.req.query(name);
  if (!v) return undefined;
  if (!uuidSchema.safeParse(v).success) throw fail(400, `Parameter ${name} tidak valid`);
  return v;
}
