import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { langgananSchema, pengumumanSchema, sasaranSchema } from "../../shared/presensi";
import { transactionWithClient } from "../db/client";
import { notifikasi, pengumuman, pushSubscriptions, sasaran, users } from "../db/schema";
import { type AppDeps, type AppEnv, currentUser, fail, paramId, parseBody } from "../lib/context";
import { requireUser } from "../lib/guards";
import { lockedFor, recordFailure } from "../lib/rate-limit";
import { describeDevice } from "../lib/session";
import { assertBolehKirim, listPengumuman, penerimaDariSasaran } from "../services/pengumuman";
import { getVapid, notify } from "../services/push";

export function notifikasiRoutes({ db }: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser)
    .get("/", async (c) => {
      const user = currentUser(c);
      const belum = c.req.query("status") === "belum";
      // shortcut: 100 terbaru; tambah paginasi bila kotak masuk sudah panjang.
      const rows = await db
        .select({
          id: notifikasi.id,
          jenis: notifikasi.jenis,
          judul: notifikasi.judul,
          isi: notifikasi.isi,
          url: notifikasi.url,
          dibacaAt: notifikasi.dibacaAt,
          dibuatAt: notifikasi.dibuatAt,
          pengirimNama: users.nama,
        })
        .from(notifikasi)
        .leftJoin(users, eq(users.id, notifikasi.pengirimId))
        .where(and(eq(notifikasi.userId, user.id), belum ? isNull(notifikasi.dibacaAt) : undefined))
        .orderBy(desc(notifikasi.dibuatAt))
        .limit(100);
      return c.json(rows);
    })
    .get("/jumlah", async (c) => {
      const [r] = await db
        .select({ n: count() })
        .from(notifikasi)
        .where(and(eq(notifikasi.userId, currentUser(c).id), isNull(notifikasi.dibacaAt)));
      return c.json({ belum: r?.n ?? 0 });
    })
    .post("/baca-semua", async (c) => {
      await db
        .update(notifikasi)
        .set({ dibacaAt: new Date() })
        .where(and(eq(notifikasi.userId, currentUser(c).id), isNull(notifikasi.dibacaAt)));
      return c.json({ ok: true });
    })
    .post("/:id/baca", async (c) => {
      const [row] = await db
        .update(notifikasi)
        .set({ dibacaAt: new Date() })
        .where(and(eq(notifikasi.id, paramId(c)), eq(notifikasi.userId, currentUser(c).id)))
        .returning({ id: notifikasi.id });
      if (!row) throw fail(404, "Notifikasi tidak ditemukan");
      return c.json({ ok: true });
    });
}

export function pengumumanRoutes({ db, pool, boss }: AppDeps) {
  return new Hono<AppEnv>()
    .use(requireUser)
    .get("/", async (c) => c.json(await listPengumuman(db, currentUser(c))))
    .post("/pratinjau", async (c) => {
      const { sasaran: list } = await parseBody(
        c,
        z.object({ sasaran: z.array(sasaranSchema).min(1).max(30) }),
      );
      const user = currentUser(c);
      await assertBolehKirim(user, list);
      return c.json({ penerima: (await penerimaDariSasaran(db, list, user.id)).length });
    })
    .post("/", async (c) => {
      const input = await parseBody(c, pengumumanSchema);
      const user = currentUser(c);
      await assertBolehKirim(user, input.sasaran);
      const result = await transactionWithClient(pool, async (tx, client) => {
        const [row] = await tx
          .insert(pengumuman)
          .values({
            judul: input.judul,
            isi: input.isi,
            pengirimId: user.id,
            kirimNotifikasi: input.kirimNotifikasi,
          })
          .returning({ id: pengumuman.id });
        const id = row?.id as string;
        await tx.insert(sasaran).values(input.sasaran.map((s) => ({ ...s, pengumumanId: id })));
        let penerima = 0;
        if (input.kirimNotifikasi) {
          penerima = await notify(
            tx,
            client,
            boss,
            await penerimaDariSasaran(tx, input.sasaran, user.id),
            {
              jenis: "pengumuman",
              judul: input.judul,
              isi: input.isi.length > 200 ? `${input.isi.slice(0, 197)}…` : input.isi,
              url: `/informasi/pengumuman#${id}`,
              pengirimUserId: user.id,
            },
          );
        }
        return { id, penerima };
      });
      return c.json(result, 201);
    });
}

export function pushRoutes({ db, pool, boss, config }: AppDeps) {
  return (
    new Hono<AppEnv>()
      // Kunci publik VAPID boleh diambil tanpa login (memang publik).
      .get("/kunci", async (c) =>
        c.json({ publicKey: (await getVapid(db, config.encryptionKey)).publicKey }),
      )
      .put("/langganan", requireUser, async (c) => {
        const { endpoint, keys } = await parseBody(c, langgananSchema);
        const userId = currentUser(c).id;
        // Langganan yang sudah ada hanya boleh diambil alih oleh pemiliknya atau oleh browser yang
        // memegang rahasia "auth"-nya (bukti kepemilikan), bukan sekadar tahu alamat endpoint.
        const [row] = await db
          .insert(pushSubscriptions)
          .values({
            userId,
            endpoint,
            p256dh: keys.p256dh,
            auth: keys.auth,
            perangkat: describeDevice(c.req.header("user-agent")),
          })
          .onConflictDoUpdate({
            target: pushSubscriptions.endpoint,
            set: { userId, p256dh: keys.p256dh, auth: keys.auth },
            setWhere: or(
              eq(pushSubscriptions.userId, userId),
              eq(pushSubscriptions.auth, keys.auth),
            ),
          })
          .returning({ id: pushSubscriptions.id });
        if (!row) throw fail(403, "Langganan ini milik perangkat lain");
        return c.json({ ok: true });
      })
      .delete("/langganan", requireUser, async (c) => {
        // Milik sendiri, atau milik akun lain di browser ini (dibuktikan dengan rahasia "auth") —
        // dipakai saat login agar push akun sebelumnya tidak nyasar ke pengguna baru.
        const { endpoint, auth } = await parseBody(
          c,
          z.object({ endpoint: z.string().max(2000), auth: z.string().max(100).optional() }),
        );
        const mine = eq(pushSubscriptions.userId, currentUser(c).id);
        await db
          .delete(pushSubscriptions)
          .where(
            and(
              eq(pushSubscriptions.endpoint, endpoint),
              auth ? or(mine, eq(pushSubscriptions.auth, auth)) : mine,
            ),
          );
        return c.json({ ok: true });
      })
      /** Kirim notifikasi uji ke diri sendiri (cek push di perangkat). */
      .post("/uji", requireUser, async (c) => {
        const user = currentUser(c);
        const key = `push-uji:${user.id}`;
        const wait = await lockedFor(db, key, 5);
        if (wait > 0)
          throw fail(
            429,
            `Notifikasi uji dibatasi 5 kali per jam. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`,
          );
        await recordFailure(db, key, 60 * 60); // dipakai sebagai penghitung pemakaian
        await transactionWithClient(pool, (tx, client) =>
          notify(tx, client, boss, [user.id], {
            jenis: "sistem",
            judul: "Notifikasi aktif",
            isi: "Perangkat ini akan menerima pemberitahuan dari sekolah.",
            url: "/notifikasi",
            pengirimUserId: null,
          }),
        );
        return c.json({ ok: true });
      })
  );
}
