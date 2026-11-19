import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog } from "../src/server/db/schema";
import { createTestContext, type TestContext } from "./helpers/app";

let t: TestContext;
let admin: string; // cookie
let adminId: string;
let operator: string; // pengguna.kelola tanpa admin
let biasa: string; // tanpa izin
let adminRole: string;
let operatorRole: string;

beforeAll(async () => {
  t = await createTestContext();
  adminRole = await t.roleId("Admin");
  const r = await t.req("POST", "/api/roles", {}); // tanpa login
  expect(r.status).toBe(401);

  const a = await t.makeUser({ nama: "Admin Satu", nomor: "6281200000001", roleNama: ["Admin"] });
  adminId = a.id;
  admin = (await t.login("6281200000001", "rahasia123")).cookie;

  const created = await t.req("POST", "/api/roles", {
    cookie: admin,
    body: { nama: "Tata Usaha", izin: ["pengguna.kelola", "santri.kelola"] },
  });
  expect(created.status).toBe(201);
  operatorRole = created.body.id;

  await t.makeUser({ nama: "Operator", nomor: "6281200000002", roleNama: ["Tata Usaha"] });
  operator = (await t.login("6281200000002", "rahasia123")).cookie;
  await t.makeUser({ nama: "Guru Biasa", nomor: "6281200000003" });
  biasa = (await t.login("6281200000003", "rahasia123")).cookie;
});
afterAll(() => t.drop());

const userBody = (over: Record<string, unknown> = {}) => ({
  nama: "Ustadz Ahmad",
  phones: [{ nomor: "0813-0000-0001", label: "Pribadi", punyaWa: true, untukLogin: true }],
  roleIds: [],
  ...over,
});

describe("pengguna", () => {
  it("tanpa izin → 403 di semua endpoint admin", async () => {
    for (const [m, p] of [
      ["GET", "/api/users"],
      ["POST", "/api/users"],
      ["GET", "/api/roles"],
      ["POST", "/api/roles"],
      ["POST", `/api/users/${adminId}/reset-password`],
    ] as const) {
      const res = await t.req(m, p, { cookie: biasa, body: m === "POST" ? {} : undefined });
      expect(res.status, `${m} ${p}`).toBe(403);
    }
  });

  it("admin membuat guru & wali; keduanya login di dua perangkat", async () => {
    const guru = await t.req("POST", "/api/users", { cookie: admin, body: userBody() });
    expect(guru.status).toBe(201);
    expect(guru.body.passwordSementara).toHaveLength(10);
    const wali = await t.req("POST", "/api/users", {
      cookie: admin,
      body: userBody({
        nama: "Bapak Wali",
        phones: [
          { nomor: "+62 813 0000 0002", label: "Ayah", punyaWa: true, untukLogin: true },
          { nomor: "081300000003", label: "Ibu", punyaWa: true, untukLogin: false },
        ],
      }),
    });
    expect(wali.status).toBe(201);

    const hp = await t.login("6281300000002", wali.body.passwordSementara, { ip: "10.8.0.1" });
    const laptop = await t.login("6281300000002", wali.body.passwordSementara, { ip: "10.8.0.2" });
    expect(hp.status).toBe(200);
    expect(laptop.status).toBe(200);
    expect(hp.body.user.wajibGantiPassword).toBe(true);
    // Nomor yang tidak "untuk login" tidak bisa dipakai login.
    expect((await t.login("6281300000003", wali.body.passwordSementara)).status).toBe(401);

    const list = await t.req("GET", "/api/users", { cookie: admin });
    expect(list.body.map((u: { nama: string }) => u.nama)).toContain("Bapak Wali");

    const logs = await t.db.select().from(auditLog).where(eq(auditLog.aksi, "pengguna.buat"));
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });

  it("nomor HP yang sudah dipakai → 409", async () => {
    const res = await t.req("POST", "/api/users", {
      cookie: admin,
      body: userBody({ nama: "Duplikat" }),
    });
    expect(res.status).toBe(409);
  });

  it("non-admin tidak boleh memberi jabatan Admin", async () => {
    const res = await t.req("POST", "/api/users", {
      cookie: operator,
      body: userBody({
        nama: "Calon Admin",
        phones: [{ nomor: "6281300000009" }],
        roleIds: [adminRole],
      }),
    });
    expect(res.status).toBe(403);
    // Tanpa jabatan admin boleh.
    const ok = await t.req("POST", "/api/users", {
      cookie: operator,
      body: userBody({
        nama: "Staf",
        phones: [{ nomor: "6281300000009" }],
        roleIds: [operatorRole],
      }),
    });
    expect(ok.status).toBe(201);
  });

  it("non-admin tidak boleh mengubah atau reset password akun admin", async () => {
    const upd = await t.req("PATCH", `/api/users/${adminId}`, {
      cookie: operator,
      body: userBody({
        nama: "Admin Diretas",
        phones: [{ nomor: "6281200000001" }],
        roleIds: [adminRole],
        status: "aktif",
      }),
    });
    expect(upd.status).toBe(403);
    const reset = await t.req("POST", `/api/users/${adminId}/reset-password`, { cookie: operator });
    expect(reset.status).toBe(403);
  });

  it("admin aktif terakhir tidak bisa dinonaktifkan atau diturunkan", async () => {
    const base = { nama: "Admin Satu", phones: [{ nomor: "6281200000001" }] };
    const off = await t.req("PATCH", `/api/users/${adminId}`, {
      cookie: admin,
      body: { ...base, roleIds: [adminRole], status: "nonaktif" },
    });
    expect(off.status).toBe(409);
    const demote = await t.req("PATCH", `/api/users/${adminId}`, {
      cookie: admin,
      body: { ...base, roleIds: [], status: "aktif" },
    });
    expect(demote.status).toBe(409);

    // Setelah ada admin kedua, admin pertama boleh diturunkan.
    const second = await t.req("POST", "/api/users", {
      cookie: admin,
      body: userBody({
        nama: "Admin Dua",
        phones: [{ nomor: "6281200000005" }],
        roleIds: [adminRole],
      }),
    });
    expect(second.status).toBe(201);
    const ok = await t.req("PATCH", `/api/users/${adminId}`, {
      cookie: admin,
      body: { ...base, roleIds: [operatorRole], status: "aktif" },
    });
    expect(ok.status).toBe(200);
  });

  it("reset password: password sementara, sesi lama keluar, wajib ganti", async () => {
    const created = await t.req("POST", "/api/users", {
      cookie: operator,
      body: userBody({ nama: "Lupa Password", phones: [{ nomor: "6281300000010" }] }),
    });
    const s = await t.login("6281300000010", created.body.passwordSementara, { ip: "10.8.1.1" });
    const reset = await t.req("POST", `/api/users/${created.body.id}/reset-password`, {
      cookie: operator,
    });
    expect(reset.status).toBe(200);
    expect((await t.req("GET", "/api/me", { cookie: s.cookie })).status).toBe(401);
    const again = await t.login("6281300000010", reset.body.passwordSementara, { ip: "10.8.1.2" });
    expect(again.body.user.wajibGantiPassword).toBe(true);
  });

  it("pengguna nonaktif tidak bisa login dan sesinya berakhir", async () => {
    const created = await t.req("POST", "/api/users", {
      cookie: operator,
      body: userBody({ nama: "Keluar", phones: [{ nomor: "6281300000011" }] }),
    });
    const s = await t.login("6281300000011", created.body.passwordSementara, { ip: "10.8.2.1" });
    const off = await t.req("PATCH", `/api/users/${created.body.id}`, {
      cookie: operator,
      body: userBody({ nama: "Keluar", phones: [{ nomor: "6281300000011" }], status: "nonaktif" }),
    });
    expect(off.status).toBe(200);
    expect((await t.req("GET", "/api/me", { cookie: s.cookie })).status).toBe(401);
    expect((await t.login("6281300000011", created.body.passwordSementara)).status).toBe(401);
  });
});

describe("jabatan", () => {
  it("izin tak dikenal / khusus admin ditolak", async () => {
    const res = await t.req("POST", "/api/roles", {
      cookie: admin,
      body: { nama: "Aneh", izin: ["pengaturan.kelola"] },
    });
    expect(res.status).toBe(400);
  });

  it("jabatan Admin tidak bisa diubah atau dihapus", async () => {
    const upd = await t.req("PATCH", `/api/roles/${adminRole}`, {
      cookie: admin,
      body: { nama: "Super", izin: [] },
    });
    expect(upd.status).toBe(400);
    expect((await t.req("DELETE", `/api/roles/${adminRole}`, { cookie: admin })).status).toBe(400);
  });

  it("izin jabatan langsung berlaku; hapus jabatan mencabutnya", async () => {
    const role = await t.req("POST", "/api/roles", {
      cookie: admin,
      body: { nama: "Sementara", izin: ["pengguna.kelola"] },
    });
    const created = await t.req("POST", "/api/users", {
      cookie: admin,
      body: userBody({
        nama: "Pemegang",
        phones: [{ nomor: "6281300000020" }],
        roleIds: [role.body.id],
      }),
    });
    await t.db.execute(
      // lewati wajib ganti password untuk tes ini
      sql`update users set wajib_ganti_password = false where id = ${created.body.id}`,
    );
    const { cookie } = await t.login("6281300000020", created.body.passwordSementara, {
      ip: "10.8.3.1",
    });
    expect((await t.req("GET", "/api/users", { cookie })).status).toBe(200);
    expect((await t.req("DELETE", `/api/roles/${role.body.id}`, { cookie: admin })).status).toBe(
      200,
    );
    expect((await t.req("GET", "/api/users", { cookie })).status).toBe(403);
  });

  it("daftar jabatan bawaan beserta izin", async () => {
    const res = await t.req("GET", "/api/roles", { cookie: admin });
    const names = res.body.map((r: { nama: string }) => r.nama);
    expect(names[0]).toBe("Admin");
    expect(names).toEqual(expect.arrayContaining(["Kepala Sekolah", "Bendahara"]));
    const bendahara = res.body.find((r: { nama: string }) => r.nama === "Bendahara");
    expect(bendahara.izin).toContain("keuangan.kelola");
  });
});
