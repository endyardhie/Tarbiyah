import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, sessions } from "../src/server/db/schema";
import { safeError } from "../src/server/lib/log";
import { createFirstAdmin } from "../src/server/services/users";
import { createTestContext, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string;
let operator: string;
let operatorId: string;

beforeAll(async () => {
  t = await createTestContext();
  await t.makeUser({ nama: "Admin", nomor: "6281400000001", roleNama: ["Admin"] });
  admin = (await t.login("6281400000001", "rahasia123")).cookie;
  await t.req("POST", "/api/roles", {
    cookie: admin,
    body: { nama: "Tata Usaha", izin: ["pengguna.kelola", "santri.kelola"] },
  });
  const op = await t.makeUser({
    nama: "Operator",
    nomor: "6281400000002",
    roleNama: ["Tata Usaha"],
  });
  operatorId = op.id;
  operator = (await t.login("6281400000002", "rahasia123")).cookie;
});
afterAll(() => t.drop());

const audits = (aksi: string) => t.db.select().from(auditLog).where(eq(auditLog.aksi, aksi));

describe("eskalasi izin oleh non-admin", () => {
  it("tidak bisa membuat/mengubah jabatan dengan izin yang tidak dimiliki", async () => {
    const bad = await t.req("POST", "/api/roles", {
      cookie: operator,
      body: { nama: "Keuangan Palsu", izin: ["keuangan.kelola"] },
    });
    expect(bad.status).toBe(403);
    const ok = await t.req("POST", "/api/roles", {
      cookie: operator,
      body: { nama: "Pendataan", izin: ["santri.kelola"] },
    });
    expect(ok.status).toBe(201);
    const upd = await t.req("PATCH", `/api/roles/${ok.body.id}`, {
      cookie: operator,
      body: { nama: "Pendataan", izin: ["santri.kelola", "rapor.kunci"] },
    });
    expect(upd.status).toBe(403);
  });

  it("tidak bisa memberi jabatan yang izinnya lebih tinggi", async () => {
    const res = await t.req("POST", "/api/users", {
      cookie: operator,
      body: {
        nama: "Calon Bendahara",
        phones: [{ nomor: "6281400000010" }],
        roleIds: [await t.roleId("Bendahara")],
      },
    });
    expect(res.status).toBe(403);
  });

  it("tidak bisa mengubah jabatan sendiri, tapi boleh mengubah data diri lewat Pengguna", async () => {
    const tu = await t.roleId("Tata Usaha");
    const base = { nama: "Operator", phones: [{ nomor: "6281400000002" }], status: "aktif" };
    const res = await t.req("PATCH", `/api/users/${operatorId}`, {
      cookie: operator,
      body: { ...base, roleIds: [tu, await t.roleId("Pendataan")] },
    });
    expect(res.status).toBe(403);
    const same = await t.req("PATCH", `/api/users/${operatorId}`, {
      cookie: operator,
      body: { ...base, nama: "Operator TU", roleIds: [tu] },
    });
    expect(same.status).toBe(200);
  });

  it("jabatan yang tidak ada → 400", async () => {
    const res = await t.req("POST", "/api/users", {
      cookie: admin,
      body: {
        nama: "X",
        phones: [{ nomor: "6281400000011" }],
        roleIds: ["0190f0f0-0000-7000-8000-000000000000"],
      },
    });
    expect(res.status).toBe(400);
  });
});

describe("profil sendiri", () => {
  it("nomor milik orang lain → 409; tanpa nomor login → 400; perubahan tercatat", async () => {
    const taken = await t.req("PATCH", "/api/me", {
      cookie: operator,
      body: { nama: "Operator", phones: [{ nomor: "6281400000001" }] },
    });
    expect(taken.status).toBe(409);
    const noLogin = await t.req("PATCH", "/api/me", {
      cookie: operator,
      body: { nama: "Operator", phones: [{ nomor: "6281400000002", untukLogin: false }] },
    });
    expect(noLogin.status).toBe(400);
    const ok = await t.req("PATCH", "/api/me", {
      cookie: operator,
      body: {
        nama: "Operator",
        phones: [{ nomor: "6281400000002" }, { nomor: "6281400000003", untukLogin: false }],
      },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.user.phones).toHaveLength(2);
    expect((await audits("profil.ubah")).length).toBe(1);
  });

  it("ganti password mengeluarkan perangkat lain, perangkat ini tetap", async () => {
    await t.makeUser({ nama: "Guru", nomor: "6281400000020", password: "lamalama1" });
    const hp = await t.login("6281400000020", "lamalama1", { ip: "10.20.0.1" });
    const laptop = await t.login("6281400000020", "lamalama1", { ip: "10.20.0.2" });
    const res = await t.req("POST", "/api/me/password", {
      cookie: hp.cookie,
      body: { passwordLama: "lamalama1", passwordBaru: "barubaru1" },
    });
    expect(res.status).toBe(200);
    expect((await t.req("GET", "/api/me", { cookie: hp.cookie })).status).toBe(200);
    expect((await t.req("GET", "/api/me", { cookie: laptop.cookie })).status).toBe(401);
    expect((await audits("password.ganti")).length).toBe(1);
  });
});

describe("audit", () => {
  it("login, reset password, dan perubahan jabatan tercatat", async () => {
    expect((await audits("login")).length).toBeGreaterThan(0);
    const created = await t.req("POST", "/api/users", {
      cookie: admin,
      body: { nama: "Y", phones: [{ nomor: "6281400000030" }] },
    });
    await t.req("POST", `/api/users/${created.body.id}/reset-password`, { cookie: admin });
    const [reset] = await t.db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.aksi, "pengguna.reset_password"), eq(auditLog.entitasId, created.body.id)),
      );
    expect(reset?.ip).toBe("10.0.0.1");
    expect((await audits("jabatan.buat")).length).toBeGreaterThanOrEqual(2);
  });
});

describe("pengerasan", () => {
  it("id bukan UUID → 404, bukan 500", async () => {
    expect((await t.req("GET", "/api/users/abc", { cookie: admin })).status).toBe(404);
    expect((await t.req("DELETE", "/api/me/sessions/abc", { cookie: admin })).status).toBe(404);
    expect((await t.req("DELETE", "/api/roles/1", { cookie: admin })).status).toBe(404);
  });

  it("body lebih dari 1 MB ditolak 413", async () => {
    const res = await t.req("PATCH", "/api/me", {
      cookie: admin,
      body: { nama: "x".repeat(1_100_000), phones: [] },
    });
    expect(res.status).toBe(413);
  });

  it("log error database tidak memuat nilai query", async () => {
    const err = await t.db
      .insert(sessions)
      .values({
        tokenHash: "x",
        userId: "0190f0f0-0000-7000-8000-000000000000",
        kedaluwarsa: new Date(),
      })
      .catch((e) => e);
    expect(String(err.message)).toContain("params");
    const line = safeError(err);
    expect(line).toMatch(/kode=23503/);
    expect(line).not.toContain("0190f0f0");
    expect(line).not.toContain("params");
  });
});

describe("admin pertama", () => {
  it("ditolak bila sudah ada admin aktif", async () => {
    await expect(createFirstAdmin(t.db, "6281400000099", "rahasia123")).rejects.toThrow(
      /Sudah ada admin aktif/,
    );
  });

  it("dibuat di database baru dan wajib ganti password", async () => {
    const fresh = await createTestContext();
    await createFirstAdmin(fresh.db, "6281400000098", "sementara12");
    const res = await fresh.login("6281400000098", "sementara12");
    expect(res.status).toBe(200);
    expect(res.body.isAdmin).toBe(true);
    expect(res.body.user.wajibGantiPassword).toBe(true);
    await fresh.drop();
  });
});
