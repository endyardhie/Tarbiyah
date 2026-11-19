import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, mkdir, readdir, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";

export type Storage = ReturnType<typeof createStorage>;

/**
 * Penyimpanan berkas di atas DATA_DIR. Key relatif ("files/ab/xyz.png"), tanpa "..".
 * Berkas tidak pernah ditimpa: put ke key yang sudah ada akan gagal.
 */
export function createStorage(root: string) {
  const base = resolve(root);

  function pathOf(key: string) {
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new Error(`Key berkas tidak valid: ${key}`);
    return full;
  }

  return {
    /** Key acak baru, mis. randomKey("files", "png") → "files/9f/9f3c…png". */
    randomKey(folder: string, ext: string) {
      const id = randomBytes(16).toString("hex");
      return `${folder}/${id.slice(0, 2)}/${id}.${ext.replace(/^\./, "")}`;
    },

    async put(key: string, data: Buffer | Readable): Promise<{ key: string; size: number }> {
      const full = pathOf(key);
      await mkdir(dirname(full), { recursive: true });
      // Tulis ke berkas sementara lalu link: berkas setengah jadi tidak pernah terlihat, dan link gagal bila key sudah ada.
      const tmp = `${full}.tmp-${randomBytes(6).toString("hex")}`;
      try {
        await writeFile(tmp, data, { flag: "wx" });
        await link(tmp, full);
      } finally {
        await rm(tmp, { force: true });
      }
      return { key, size: (await stat(full)).size };
    },

    /** Stream isi berkas (tidak dimuat utuh ke memori). */
    async get(key: string): Promise<{ stream: Readable; size: number }> {
      const full = pathOf(key);
      const { size } = await stat(full);
      return { stream: createReadStream(full), size };
    },

    async delete(key: string): Promise<void> {
      await unlink(pathOf(key)).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") throw err;
      });
    },

    /** Semua key di bawah prefix (rekursif), urut abjad. */
    async list(prefix = ""): Promise<string[]> {
      const dir = prefix ? pathOf(prefix) : base;
      const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(
        (err: NodeJS.ErrnoException) => {
          if (err.code === "ENOENT") return [];
          throw err;
        },
      );
      return entries
        .filter((e) => e.isFile() && !e.name.includes(".tmp-"))
        .map((e) => relative(base, join(e.parentPath, e.name)).split(sep).join("/"))
        .sort();
    },
  };
}
