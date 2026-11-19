import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessions } from "../src/server/db/schema";
import { createTestContext, ORIGIN, type TestContext, TURNSTILE_OK } from "./helpers/app";

let t: TestContext;

beforeAll(async () => {
  t = await createTestContext();
  await t.makeUser({ nama: "Guru A", nomor: "6281100000001", password: "rahasia123" });
  await t.makeUser({ nama: "Guru Kunci", nomor: "6281100000002", password: "rahasia123" });
});
afterAll(() => t.drop());

describe("login", () => {
  it("sukses dengan format nomor apa pun, cookie __Host- aman", async () => {
    const res = await t.login("0811-0000-0001", "rahasia123");
    expect(res.status).toBe(200);
    expect(res.body.user.nama).toBe("Guru A");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-tarbiyah=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Path=\//);

    const me = await t.req("GET", "/api/me", { cookie: res.cookie });
    expect(me.status).toBe(200);
    expect(me.body.user.phones[0].nomor).toBe("6281100000001");
  });

  it("token sesi disimpan sebagai hash, bukan token asli", async () => {
    const res = await t.login("6281100000001", "rahasia123");
    const token = res.cookie.split("=")[1] ?? "";
    const rows = await t.db.select({ h: sessions.tokenHash }).from(sessions);
    expect(rows.some((r) => r.h === token)).toBe(false);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.h))).toBe(true);
  });

  it("gagal dengan password salah atau nomor tak dikenal (pesan sama)", async () => {
    const a = await t.login("6281100000001", "salah-banget", { ip: "10.9.9.1" });
    const b = await t.login("6281199999999", "rahasia123", { ip: "10.9.9.1" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it("Turnstile gagal → ditolak", async () => {
    const res = await t.req("POST", "/api/auth/login", {
      body: { nomor: "6281100000001", password: "rahasia123", turnstileToken: "palsu" },
    });
    expect(res.status).toBe(400);
  });

  it("terkunci setelah 5 kali gagal per nomor, walau password benar", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await t.login("6281100000002", "salah", { ip: `10.1.0.${i}` });
      expect(r.status).toBe(401);
    }
    const res = await t.login("6281100000002", "rahasia123", { ip: "10.1.0.99" });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Terlalu banyak percobaan/);
  });

  it("terkunci per IP; X-Forwarded-For palsu diabaikan", async () => {
    const ip = "10.2.0.1";
    for (let i = 0; i < 30; i++) {
      await t.login(`62812000000${String(i).padStart(2, "0")}`, "salah", {
        ip,
        headers: { "x-forwarded-for": `1.1.1.${i}` },
      });
    }
    const res = await t.login("6281100000001", "rahasia123", {
      ip,
      headers: { "x-forwarded-for": "8.8.8.8" },
    });
    expect(res.status).toBe(429);
    // IP lain tetap bisa.
    expect((await t.login("6281100000001", "rahasia123", { ip: "10.2.0.2" })).status).toBe(200);
  });

  it("IP sesi dari socket, bukan X-Forwarded-For; CF-Connecting-IP hanya bila dipercaya", async () => {
    const res = await t.login("6281100000001", "rahasia123", {
      ip: "10.3.0.7",
      headers: { "x-forwarded-for": "6.6.6.6", "cf-connecting-ip": "7.7.7.7" },
    });
    const list = await t.req("GET", "/api/me/sessions", { cookie: res.cookie });
    expect(list.body.find((s: { ini: boolean }) => s.ini).ip).toBe("10.3.0.7");

    const cf = await createTestContext({ trustCloudflare: true });
    await cf.makeUser({ nama: "X", nomor: "6281100000009", password: "rahasia123" });
    const r2 = await cf.login("6281100000009", "rahasia123", {
      ip: "10.3.0.7",
      headers: { "cf-connecting-ip": "7.7.7.7" },
    });
    const l2 = await cf.req("GET", "/api/me/sessions", { cookie: r2.cookie });
    expect(l2.body[0].ip).toBe("7.7.7.7");
    await cf.drop();
  });
});

describe("sesi", () => {
  it("sesi kedaluwarsa → 401", async () => {
    const res = await t.login("6281100000001", "rahasia123", { ip: "10.4.0.1" });
    await t.db.update(sessions).set({ kedaluwarsa: sql`now() - interval '1 minute'` });
    expect((await t.req("GET", "/api/me", { cookie: res.cookie })).status).toBe(401);
  });

  it("dua perangkat; keluarkan perangkat lain; logout", async () => {
    const hp = await t.login("6281100000001", "rahasia123", { ip: "10.5.0.1" });
    const laptop = await t.login("6281100000001", "rahasia123", { ip: "10.5.0.2" });
    const list = await t.req("GET", "/api/me/sessions", { cookie: hp.cookie });
    const other = list.body.find(
      (s: { ini: boolean; ip: string }) => !s.ini && s.ip === "10.5.0.2",
    );
    expect(other).toBeTruthy();

    expect(
      (await t.req("DELETE", `/api/me/sessions/${other.id}`, { cookie: hp.cookie })).status,
    ).toBe(200);
    expect((await t.req("GET", "/api/me", { cookie: laptop.cookie })).status).toBe(401);

    expect((await t.req("POST", "/api/auth/logout", { cookie: hp.cookie })).status).toBe(200);
    expect((await t.req("GET", "/api/me", { cookie: hp.cookie })).status).toBe(401);
  });

  it("sesi bergulir: aktif setelah lebih dari sejam memperpanjang kedaluwarsa", async () => {
    const res = await t.login("6281100000001", "rahasia123", { ip: "10.6.0.1" });
    await t.db.update(sessions).set({
      terakhirAktif: sql`now() - interval '2 hours'`,
      kedaluwarsa: sql`now() + interval '1 day'`,
    });
    const me = await t.req("GET", "/api/me", { cookie: res.cookie });
    expect(me.status).toBe(200);
    expect(me.headers.get("set-cookie")).toMatch(/__Host-tarbiyah=/);
    const [s] = await t.db
      .select({ k: sessions.kedaluwarsa })
      .from(sessions)
      .where(eq(sessions.ip, "10.6.0.1"));
    expect(s && s.k.getTime() > Date.now() + 80 * 24 * 3600 * 1000).toBe(true);
  });
});

describe("cek Origin", () => {
  it("POST tanpa Origin atau Origin lain ditolak", async () => {
    const body = { nomor: "6281100000001", password: "rahasia123", turnstileToken: TURNSTILE_OK };
    const a = await t.req("POST", "/api/auth/login", { body, headers: { origin: "" } });
    const b = await t.req("POST", "/api/auth/login", {
      body,
      headers: { origin: "https://jahat.com" },
    });
    expect(a.status).toBe(403);
    expect(b.status).toBe(403);
    expect(
      (await t.req("POST", "/api/auth/login", { body, headers: { origin: ORIGIN } })).status,
    ).toBe(200);
  });
});

describe("wajib ganti password", () => {
  it("hanya /me, ganti password, dan logout yang boleh", async () => {
    await t.makeUser({
      nama: "Wali Baru",
      nomor: "6281100000003",
      password: "sementara1",
      wajibGantiPassword: true,
    });
    const { cookie } = await t.login("6281100000003", "sementara1", { ip: "10.7.0.1" });
    expect((await t.req("GET", "/api/me", { cookie })).body.user.wajibGantiPassword).toBe(true);
    expect((await t.req("GET", "/api/me/sessions", { cookie })).status).toBe(403);

    const bad = await t.req("POST", "/api/me/password", {
      cookie,
      body: { passwordLama: "salah", passwordBaru: "barubaru1" },
    });
    expect(bad.status).toBe(400);
    const ok = await t.req("POST", "/api/me/password", {
      cookie,
      body: { passwordLama: "sementara1", passwordBaru: "barubaru1" },
    });
    expect(ok.status).toBe(200);
    expect((await t.req("GET", "/api/me/sessions", { cookie })).status).toBe(200);
    expect((await t.login("6281100000003", "barubaru1", { ip: "10.7.0.2" })).status).toBe(200);
  });
});
