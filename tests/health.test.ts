import type PgBoss from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app";
import { createBoss } from "../src/server/jobs/boss";
import { registerJobs } from "../src/server/jobs/schedules";
import { createTestDb } from "./helpers/db";

let t: Awaited<ReturnType<typeof createTestDb>>;
let boss: PgBoss;

beforeAll(async () => {
  t = await createTestDb();
  boss = createBoss(t.url);
  await boss.start();
  await registerJobs(boss, "Asia/Jayapura");
});

afterAll(async () => {
  await boss.stop({ graceful: false, wait: true });
  await t.drop();
});

describe("GET /api/health", () => {
  it("hijau bila DB dan pg-boss siap", async () => {
    const app = createApp({ pool: t.pool, boss, version: "abc123", timeZone: "Asia/Jayapura" });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, versi: "abc123", db: true, boss: true });
    expect(body.waktuSekolah).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("503 bila pg-boss belum siap", async () => {
    const fakeBoss = { getQueue: async () => null } as unknown as PgBoss;
    const app = createApp({
      pool: t.pool,
      boss: fakeBoss,
      version: "x",
      timeZone: "Asia/Jayapura",
    });
    const res = await app.request("/api/health");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: true, boss: false });
  });

  it("route API yang tidak ada → 404 JSON", async () => {
    const app = createApp({ pool: t.pool, boss, version: "x", timeZone: "Asia/Jayapura" });
    const res = await app.request("/api/tidak-ada");
    expect(res.status).toBe(404);
  });
});

describe("schoolNow", () => {
  it("memakai zona waktu sekolah (WIT = UTC+9)", async () => {
    const { schoolNow } = await import("../src/server/lib/tanggal");
    expect(schoolNow("Asia/Jayapura", new Date("2026-11-20T15:00:00Z"))).toBe(
      "2026-11-21 00:00:00",
    );
  });
});
