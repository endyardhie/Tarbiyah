import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { identitasSchema } from "../../shared/sekolah";
import { berkas } from "../db/schema";
import { audit } from "../lib/audit";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { detectType } from "../lib/file-type";
import { requirePermission, requireUser } from "../lib/guards";
import { getIdentitas, saveIdentitas } from "../services/pengaturan";

const MB = 1024 * 1024;
const LOGO_FIELDS = {
  logo: { max: 2 * MB, types: ["image/png", "image/jpeg", "image/webp"] },
  ikon192: { max: 1 * MB, types: ["image/png"] },
  ikon512: { max: 1 * MB, types: ["image/png"] },
  ikonMaskable: { max: 1 * MB, types: ["image/png"] },
} as const;

export function pengaturanRoutes({ db, storage }: AppDeps) {
  const admin = [requireUser, requirePermission("pengaturan.kelola")] as const;
  return new Hono<AppEnv>()
    .get("/identitas", requireUser, async (c) => c.json(await getIdentitas(db)))
    .put("/identitas", ...admin, async (c) => {
      const input = await parseBody(c, identitasSchema);
      const before = await getIdentitas(db);
      const after = { ...before, ...input };
      await db.transaction(async (tx) => {
        await saveIdentitas(db, tx, after);
        await audit(tx, {
          userId: currentUser(c).id,
          aksi: "pengaturan.identitas",
          entitas: "settings",
          entitasId: "identitas",
          sebelum: before,
          sesudah: after,
          ip: c.get("ip"),
        });
      });
      return c.json(after);
    })
    .post("/logo", ...admin, async (c) => {
      // Logo asli + ikon PWA (192, 512, maskable) yang dibuat browser dengan canvas.
      const form = await c.req.parseBody();
      const files: {
        field: keyof typeof LOGO_FIELDS;
        buf: Buffer;
        name: string;
        mime: string;
        ext: string;
      }[] = [];
      for (const [field, rule] of Object.entries(LOGO_FIELDS) as [
        keyof typeof LOGO_FIELDS,
        (typeof LOGO_FIELDS)[keyof typeof LOGO_FIELDS],
      ][]) {
        const f = form[field];
        if (!(f instanceof File)) throw fail(400, `Berkas ${field} belum dipilih`);
        if (f.size > rule.max)
          throw fail(400, `Berkas ${field} terlalu besar (maks ${rule.max / MB} MB)`);
        const buf = Buffer.from(await f.arrayBuffer());
        const type = detectType(buf);
        if (!type || !(rule.types as readonly string[]).includes(type.mime)) {
          throw fail(
            400,
            `Berkas ${field} harus gambar ${rule.types.map((t) => t.split("/")[1]).join("/")}`,
          );
        }
        files.push({ field, buf, name: f.name || `${field}.${type.ext}`, ...type });
      }
      const user = currentUser(c);
      // Tulis berkas dulu (nama acak, tidak pernah menimpa), lalu catat di DB dalam satu transaksi.
      const stored: ((typeof files)[number] & { key: string; size: number })[] = [];
      for (const f of files) {
        const { key, size } = await storage.put(storage.randomKey("files", f.ext), f.buf);
        stored.push({ ...f, key, size });
      }
      const before = await getIdentitas(db);
      const after = await db.transaction(async (tx) => {
        const ids: Record<string, string> = {};
        for (const f of stored) {
          const [row] = await tx
            .insert(berkas)
            .values({
              namaAsli: f.name,
              path: f.key,
              ukuran: f.size,
              tipe: f.mime,
              rujukanTipe: "logo",
              rujukanId: f.field,
              publik: true,
              dibuatOleh: user.id,
            })
            .returning({ id: berkas.id });
          ids[f.field] = row?.id as string;
        }
        const next = {
          ...before,
          logoId: ids.logo ?? null,
          ikon192Id: ids.ikon192 ?? null,
          ikon512Id: ids.ikon512 ?? null,
          ikonMaskableId: ids.ikonMaskable ?? null,
        };
        await saveIdentitas(db, tx, next);
        await audit(tx, {
          userId: user.id,
          aksi: "pengaturan.logo",
          entitas: "settings",
          entitasId: "identitas",
          sebelum: before,
          sesudah: next,
          ip: c.get("ip"),
        });
        return next;
      });
      return c.json(after);
    });
}

/** Berkas publik (logo & ikon). Berkas privat menyusul di M5 dengan pengecekan can(). */
export function fileRoutes({ db, storage }: AppDeps) {
  return new Hono<AppEnv>().get("/:id", async (c) => {
    const [row] = await db
      .select()
      .from(berkas)
      .where(and(eq(berkas.id, paramId(c)), eq(berkas.publik, true)));
    if (!row) throw fail(404, "Berkas tidak ditemukan");
    const { stream, size } = await storage.get(row.path);
    return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Type": row.tipe,
      "Content-Length": String(size),
      // Id berkas unik dan isinya tidak pernah berubah.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
  });
}
