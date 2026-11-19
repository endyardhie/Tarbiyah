import { describe, expect, it } from "vitest";
import { type AuthUser, can } from "../src/server/lib/can";
import { decryptSecret, encryptSecret } from "../src/server/lib/crypto";
import { hashPassword, verifyPassword } from "../src/server/lib/password";
import { uuidv7 } from "../src/server/lib/uuid";
import { normalizePhone } from "../src/shared/phone";

describe("normalizePhone", () => {
  it.each([
    ["0812-3456-7890", "6281234567890"],
    ["+62 812 3456 7890", "6281234567890"],
    ["6281234567890", "6281234567890"],
    ["81234567890", "6281234567890"],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(["", "12345", "0211234567", "08123", "+1 555 123 4567"])("tolak %s", (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
});

describe("password", () => {
  it("Argon2id dan verifikasi", async () => {
    const h = await hashPassword("rahasia123");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "rahasia123")).toBe(true);
    expect(await verifyPassword(h, "salah")).toBe(false);
    expect(await verifyPassword("bukan-hash", "x")).toBe(false);
  });
});

describe("AES-GCM", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("enkripsi lalu dekripsi", () => {
    const e = encryptSecret("token-gowa", key);
    expect(e.v).toBe(1);
    expect(e.data).not.toContain("token-gowa");
    expect(decryptSecret(e, key)).toBe("token-gowa");
  });
  it("data yang diubah ditolak", () => {
    const e = encryptSecret("abc", key);
    expect(() =>
      decryptSecret({ ...e, data: Buffer.from("xyz").toString("base64") }, key),
    ).toThrow();
  });
});

describe("uuidv7", () => {
  it("format v7 dan urut waktu", () => {
    const a = uuidv7();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidv7() > a || uuidv7().slice(0, 13) >= a.slice(0, 13)).toBe(true);
  });
});

describe("can()", () => {
  const user = (over: Partial<AuthUser>): AuthUser => ({
    id: "u",
    nama: "U",
    wajibGantiPassword: false,
    isAdmin: false,
    roles: [],
    permissions: new Set(),
    relasi: { kelasWali: [], pengajaran: [], kelasAjar: [], anak: [] },
    ...over,
  });

  it("admin lolos semua izin, termasuk khusus admin", async () => {
    const admin = user({ isAdmin: true });
    expect(await can(admin, "keuangan.kelola")).toBe(true);
    expect(await can(admin, "pengaturan.kelola")).toBe(true);
  });

  it("non-admin hanya izin jabatannya", async () => {
    const bendahara = user({ permissions: new Set(["keuangan.kelola"]) });
    expect(await can(bendahara, "keuangan.kelola")).toBe(true);
    expect(await can(bendahara, "pengguna.kelola")).toBe(false);
  });

  it("izin khusus admin tidak bisa diberikan lewat jabatan", async () => {
    const u = user({ permissions: new Set(["pengaturan.kelola", "backup.kelola"]) });
    expect(await can(u, "pengaturan.kelola")).toBe(false);
    expect(await can(u, "backup.kelola")).toBe(false);
  });
});
