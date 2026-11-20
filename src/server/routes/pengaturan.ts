import { Readable } from "node:stream";
import { and, eq, inArray } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import {
  pengaturanKeuanganSchema,
  pengaturanPembayaranSchema,
  pengaturanWaSchema,
} from "../../shared/keuangan";
import { identitasSchema } from "../../shared/sekolah";
import { berkas, pendaftaran, pengajaran, tugas } from "../db/schema";
import { scheduleJobs } from "../jobs/schedules";
import { audit } from "../lib/audit";
import { type AuthUser, can } from "../lib/can";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { detectType } from "../lib/file-type";
import { requirePermission, requireUser } from "../lib/guards";
import { getPembayaranView, savePembayaran } from "../payment/registry";
import { getKeuangan } from "../services/keuangan";
import { getIdentitas, getPersetujuan, saveIdentitas, writeSetting } from "../services/pengaturan";
import { getWaConfig, getWaView, saveWa } from "../services/wa";

const MB = 1024 * 1024;
const LOGO_FIELDS = {
  logo: { max: 2 * MB, types: ["image/png", "image/jpeg", "image/webp"] },
  ikon192: { max: 1 * MB, types: ["image/png"] },
  ikon512: { max: 1 * MB, types: ["image/png"] },
  ikonMaskable: { max: 1 * MB, types: ["image/png"] },
} as const;

export function pengaturanRoutes({ db, storage, boss, config }: AppDeps) {
  const admin = [requireUser, requirePermission("pengaturan.kelola")] as const;
  return (
    new Hono<AppEnv>()
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
        // Jadwal cron (tagihan, backup, dll.) ikut zona waktu baru tanpa restart.
        if (after.zonaWaktu !== before.zonaWaktu) await scheduleJobs(boss, after.zonaWaktu);
        return c.json(after);
      })
      .get("/persetujuan", ...admin, async (c) => c.json(await getPersetujuan(db)))
      .put("/persetujuan", ...admin, async (c) => {
        const input = await parseBody(
          c,
          z.object({
            teks: z.string().trim().min(20, "Teks persetujuan terlalu pendek").max(5000),
          }),
        );
        const before = await getPersetujuan(db);
        await db.transaction(async (tx) => {
          await writeSetting(tx, "persetujuan", input);
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "pengaturan.persetujuan",
            entitas: "settings",
            entitasId: "persetujuan",
            sebelum: before,
            sesudah: input,
            ip: c.get("ip"),
          });
        });
        return c.json(input);
      })
      .get("/keuangan", ...admin, async (c) => c.json(await getKeuangan(db)))
      .put("/keuangan", ...admin, async (c) => {
        const input = await parseBody(c, pengaturanKeuanganSchema);
        const before = await getKeuangan(db);
        await db.transaction(async (tx) => {
          await writeSetting(tx, "keuangan", input);
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "pengaturan.keuangan",
            entitas: "settings",
            entitasId: "keuangan",
            sebelum: before,
            sesudah: input,
            ip: c.get("ip"),
          });
        });
        return c.json(input);
      })
      .get("/wa", ...admin, async (c) => c.json(await getWaView(db)))
      .put("/wa", ...admin, async (c) => {
        const input = await parseBody(c, pengaturanWaSchema);
        const before = await getWaView(db);
        await db.transaction(async (tx) => {
          await saveWa(tx, input, config.encryptionKey);
          // Secret tidak pernah ditulis ke log: audit hanya mencatat "diganti".
          const { password, ...rest } = input;
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "pengaturan.wa",
            entitas: "settings",
            entitasId: "wa",
            sebelum: before,
            sesudah: { ...rest, passwordDiganti: !!password },
            ip: c.get("ip"),
          });
        });
        return c.json(await getWaView(db));
      })
      /** Cek koneksi GOWA (GET /app/status) — tidak mengirim pesan apa pun. */
      .post("/wa/cek", ...admin, async (c) => {
        const cfg = await getWaConfig(db, config.encryptionKey);
        if (!cfg) throw fail(409, "WA gateway nonaktif atau URL belum diisi");
        try {
          const res = await fetch(`${cfg.url}/app/status`, {
            headers: {
              authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}`,
              ...(cfg.deviceId ? { "x-device-id": cfg.deviceId } : {}),
            },
            signal: AbortSignal.timeout(10_000),
          });
          const body = (await res.json().catch(() => null)) as {
            results?: { is_connected?: boolean; is_logged_in?: boolean };
          } | null;
          if (!res.ok) return c.json({ ok: false, pesan: `GOWA menjawab status ${res.status}` });
          const r = body?.results;
          return c.json({
            ok: !!r?.is_logged_in,
            pesan: r?.is_logged_in
              ? "Terhubung dan sudah login WhatsApp"
              : r?.is_connected
                ? "Terhubung, tetapi WhatsApp belum login (scan QR di GOWA)"
                : "GOWA belum terhubung ke WhatsApp",
          });
        } catch {
          return c.json({ ok: false, pesan: "GOWA tidak bisa dihubungi dari server" });
        }
      })
      .get("/pembayaran", ...admin, async (c) => c.json(await getPembayaranView(db)))
      .put("/pembayaran", ...admin, async (c) => {
        const input = await parseBody(c, pengaturanPembayaranSchema);
        const before = await getPembayaranView(db);
        await db.transaction(async (tx) => {
          await savePembayaran(tx, input, config.encryptionKey);
          const { apiKey, webhookSecret, ...rest } = input;
          await audit(tx, {
            userId: currentUser(c).id,
            aksi: "pengaturan.pembayaran",
            entitas: "settings",
            entitasId: "pembayaran",
            sebelum: before,
            sesudah: { ...rest, apiKeyDiganti: !!apiKey, webhookSecretDiganti: !!webhookSecret },
            ip: c.get("ip"),
          });
        });
        return c.json(await getPembayaranView(db));
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
        const after = await db
          .transaction(async (tx) => {
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
          })
          .catch(async (e) => {
            // Berkas yang belum pernah tercatat di DB tidak dipakai siapa pun: hapus agar tidak yatim.
            await Promise.all(stored.map((f) => storage.delete(f.key).catch(() => {})));
            throw e;
          });
        return c.json(after);
      })
  );
}

/** Sajikan satu berkas publik dari storage (streaming). */
export async function servePublicFile(
  c: Context,
  { db, storage }: Pick<AppDeps, "db" | "storage">,
  id: string,
) {
  const [row] = await db
    .select()
    .from(berkas)
    .where(and(eq(berkas.id, id), eq(berkas.publik, true)));
  if (!row) throw fail(404, "Berkas tidak ditemukan");
  const { stream, size } = await storage.get(row.path);
  return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
    "Content-Type": row.tipe,
    "Content-Length": String(size),
    // Id berkas unik dan isinya tidak pernah berubah.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
}

/** Boleh membuka berkas privat? Lampiran tugas: guru/wali kelas/pengajar kelasnya & wali santri kelas itu. */
async function bolehBerkas(db: AppDeps["db"], user: AuthUser, row: typeof berkas.$inferSelect) {
  if (user.isAdmin) return true;
  if (row.rujukanTipe === "tugas" && row.rujukanId) {
    const [t] = await db
      .select({ pengajaranId: tugas.pengajaranId, kelasId: pengajaran.kelasId })
      .from(tugas)
      .innerJoin(pengajaran, eq(pengajaran.id, tugas.pengajaranId))
      .where(eq(tugas.id, row.rujukanId));
    if (!t) return false;
    if (await can(user, "akademik.lihat", { pengajaranId: t.pengajaranId, kelasId: t.kelasId }))
      return true;
    if (!user.relasi.anak.length) return false;
    const [anak] = await db
      .select({ id: pendaftaran.id })
      .from(pendaftaran)
      .where(
        and(
          eq(pendaftaran.kelasId, t.kelasId),
          eq(pendaftaran.status, "aktif"),
          inArray(pendaftaran.santriId, user.relasi.anak),
        ),
      )
      .limit(1);
    return !!anak;
  }
  return false;
}

/**
 * Berkas lewat route (bukan folder statis): publik (logo/ikon) bebas; privat (lampiran tugas)
 * wajib login dan lolos pengecekan hak akses.
 */
export function fileRoutes(deps: AppDeps) {
  return new Hono<AppEnv>().get("/:id", async (c) => {
    const id = paramId(c);
    const [row] = await deps.db.select().from(berkas).where(eq(berkas.id, id));
    if (!row) throw fail(404, "Berkas tidak ditemukan");
    if (row.publik) return servePublicFile(c, deps, id);
    const user = c.get("user");
    if (!user) throw fail(401, "Silakan masuk terlebih dahulu");
    if (!(await bolehBerkas(deps.db, user, row))) throw fail(404, "Berkas tidak ditemukan");
    const { stream, size } = await deps.storage.get(row.path);
    return c.body(Readable.toWeb(stream) as ReadableStream, 200, {
      "Content-Type": row.tipe,
      "Content-Length": String(size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.namaAsli)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
  });
}
