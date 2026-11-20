import { Readable } from "node:stream";
import type { B2 } from "../../src/server/lib/b2";

/** B2 tiruan di memori (tes). */
export function createMemoryB2(): B2 & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  const read = async (body: Readable | Buffer) => {
    if (Buffer.isBuffer(body)) return body;
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks);
  };
  return {
    objects,
    async put(key, body) {
      objects.set(key, await read(body));
    },
    async get(key) {
      const b = objects.get(key);
      if (!b) throw new Error(`NoSuchKey: ${key}`);
      return Readable.from([b]);
    },
    async exists(key) {
      return objects.has(key);
    },
    async list(prefix) {
      return [...objects.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([key, b]) => ({ key, size: b.length, lastModified: new Date() }))
        .sort((a, b) => a.key.localeCompare(b.key));
    },
  };
}
