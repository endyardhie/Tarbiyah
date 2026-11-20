import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBoss } from "../src/server/jobs/boss";
import { registerJobs } from "../src/server/jobs/schedules";
import { schoolNow } from "../src/server/lib/tanggal";
import { createTestContext, type TestContext } from "./helpers/app";
import { createTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof createTestDb>>;
let boss: PgBoss;
let ctx: TestContext;

beforeAll(async () => {
  t = await createTestDb();
  boss = createBoss(t.url);
  await boss.start();
  await registerJobs(boss, t.db, t.pool, "Asia/Jayapura", {
    encryptionKey: Buffer.alloc(32, 1).toString("base64"),
    appUrl: "https://x",
  });
  ctx = await createTestContext({ boss, version: "abc123" });
});

afterAll(async () => {
  await boss.stop({ graceful: false, wait: true });
  await ctx.drop();
  await t.drop();
});

describe("GET /api/health", () => {
  it("hijau bila DB dan pg-boss siap", async () => {
    const res = await ctx.req("GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, versi: "abc123", db: true, boss: true });
    expect(res.body.waktuSekolah).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("503 bila pg-boss belum siap", async () => {
    const fake = await createTestContext({
      boss: { getQueue: async () => null } as unknown as PgBoss,
    });
    const res = await fake.req("GET", "/api/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ ok: false, db: true, boss: false });
    await fake.drop();
  });

  it("route API yang tidak ada → 404 JSON", async () => {
    const res = await ctx.req("GET", "/api/tidak-ada");
    expect(res.status).toBe(404);
  });
});

describe("schoolNow", () => {
  it("memakai zona waktu sekolah (WIT = UTC+9)", () => {
    expect(schoolNow("Asia/Jayapura", new Date("2026-11-20T15:00:00Z"))).toBe(
      "2026-11-21 00:00:00",
    );
  });
});
