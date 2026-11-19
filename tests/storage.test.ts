import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStorage, type Storage } from "../src/server/lib/storage";

let dir: string;
let storage: Storage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "tarbiyah-storage-"));
  storage = createStorage(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("storage", () => {
  it("put, get, list, delete", async () => {
    const r = await storage.put("files/a/satu.txt", Buffer.from("halo"));
    expect(r).toEqual({ key: "files/a/satu.txt", size: 4 });
    await storage.put("files/b/dua.txt", Readable.from(["du", "a"]));
    await storage.put("backups/x.dump", Buffer.from("db"));

    const got = await storage.get("files/a/satu.txt");
    expect(got.size).toBe(4);
    expect(await text(got.stream)).toBe("halo");

    expect(await storage.list("files")).toEqual(["files/a/satu.txt", "files/b/dua.txt"]);
    expect(await storage.list()).toHaveLength(3);

    await storage.delete("files/a/satu.txt");
    await storage.delete("files/a/satu.txt"); // tidak error bila sudah tidak ada
    expect(await storage.list("files")).toEqual(["files/b/dua.txt"]);
  });

  it("tidak pernah menimpa berkas yang sudah ada", async () => {
    await storage.put("files/tetap.txt", Buffer.from("asli"));
    await expect(storage.put("files/tetap.txt", Buffer.from("baru"))).rejects.toThrow();
    expect(await text((await storage.get("files/tetap.txt")).stream)).toBe("asli");
    expect((await storage.list("files")).some((k) => k.includes(".tmp-"))).toBe(false);
  });

  it("menolak key di luar DATA_DIR", async () => {
    await expect(storage.put("../luar.txt", Buffer.from("x"))).rejects.toThrow(/tidak valid/);
    await expect(storage.get("files/../../etc/passwd")).rejects.toThrow(/tidak valid/);
  });

  it("randomKey membuat path acak di folder yang diminta", () => {
    const k = storage.randomKey("files", ".png");
    expect(k).toMatch(/^files\/[0-9a-f]{2}\/[0-9a-f]{32}\.png$/);
    expect(storage.randomKey("files", "png")).not.toBe(k);
  });

  it("list prefix yang belum ada → kosong", async () => {
    expect(await storage.list("tidak-ada")).toEqual([]);
  });
});
