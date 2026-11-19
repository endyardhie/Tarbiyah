import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { clientIp } from "./lib/client-ip";
import { type AppDeps, type AppEnv, fail } from "./lib/context";
import { safeError } from "./lib/log";
import { findSession, loadAuthUser, readSessionToken, setSessionCookie } from "./lib/session";
import { agendaRoutes } from "./routes/agenda";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { imporRoutes } from "./routes/impor";
import { meRoutes } from "./routes/me";
import { fileRoutes, pengaturanRoutes, servePublicFile } from "./routes/pengaturan";
import { presensiRoutes } from "./routes/presensi";
import { roleRoutes } from "./routes/roles";
import { santriRoutes, santriWaliRoutes, waliRoutes } from "./routes/santri";
import { sekolahRoutes } from "./routes/sekolah";
import { userRoutes } from "./routes/users";
import { getIdentitas, isSampleData } from "./services/pengaturan";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createApp(deps: AppDeps) {
  const { db, config } = deps;
  const appOrigin = new URL(config.appUrl).origin;

  const api = new Hono<AppEnv>()
    // Body JSON dibaca utuh ke memori; batasi agar container 512 MB aman. Unggahan berkas punya batas sendiri (M5).
    .use(
      bodyLimit({
        maxSize: 1024 * 1024,
        onError: (c) => c.json({ error: "Data terlalu besar" }, 413),
      }),
    )
    .use(async (c, next) => {
      c.set("ip", clientIp(c, config.trustCloudflare));
      // Cegah CSRF: request yang mengubah data harus datang dari APP_URL.
      if (!SAFE_METHODS.has(c.req.method) && c.req.header("origin") !== appOrigin) {
        throw fail(403, "Asal permintaan tidak diizinkan");
      }
      c.set("user", null);
      c.set("sessionId", null);
      const token = readSessionToken(c);
      const session = token ? await findSession(db, token) : null;
      if (token && session) {
        c.set("user", await loadAuthUser(db, session.userId));
        c.set("sessionId", session.id);
        if (session.refreshed) setSessionCookie(c, token);
      }
      await next();
    })
    .route("/health", healthRoutes(deps))
    .get("/public-config", async (c) => {
      const id = await getIdentitas(db);
      return c.json({
        turnstileSiteKey: config.turnstileSiteKey,
        nama: id.nama,
        namaSingkat: id.namaSingkat,
        logoUrl: id.logoId ? `/api/files/${id.logoId}` : null,
        dataContoh: await isSampleData(db),
        zonaWaktu: id.zonaWaktu,
      });
    })
    .route("/auth", authRoutes(deps))
    .route("/me", meRoutes(deps))
    .route("/users", userRoutes(deps))
    .route("/roles", roleRoutes(deps))
    .route("/", sekolahRoutes(deps))
    .route("/santri", santriRoutes(deps))
    .route("/wali", waliRoutes(deps))
    .route("/santri-wali", santriWaliRoutes(deps))
    .route("/impor", imporRoutes(deps))
    .route("/pengaturan", pengaturanRoutes(deps))
    .route("/files", fileRoutes(deps))
    .route("/presensi", presensiRoutes(deps))
    .route("/agenda", agendaRoutes(deps))
    .all("*", (c) => c.json({ error: "Tidak ditemukan" }, 404));

  const app = new Hono().route("/api", api).onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return c.json({ error: "Data yang sama sudah ada" }, 409);
    if (code === "23503")
      return c.json({ error: "Data masih dipakai atau rujukan tidak valid" }, 409);
    console.error(`${c.req.method} ${c.req.path}: ${safeError(err)}`);
    return c.json({ error: "Terjadi kesalahan di server" }, 500);
  });

  // Manifest PWA dinamis dari pengaturan identitas (nama & ikon yang diunggah admin).
  app.get("/manifest.webmanifest", async (c) => {
    const id = await getIdentitas(db);
    const icon = (fileId: string | null, fallback: string) =>
      fileId ? `/api/files/${fileId}` : fallback;
    c.header("Cache-Control", "no-cache");
    return c.json(
      {
        name: id.nama,
        short_name: id.namaSingkat,
        lang: "id",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f5f4ee",
        theme_color: "#15803d",
        icons: [
          { src: icon(id.ikon192Id, "/icons/icon-192.png"), sizes: "192x192", type: "image/png" },
          { src: icon(id.ikon512Id, "/icons/icon-512.png"), sizes: "512x512", type: "image/png" },
          {
            src: icon(id.ikonMaskableId, "/icons/icon-maskable-512.png"),
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      200,
      { "Content-Type": "application/manifest+json" },
    );
  });
  // iOS mengambil ikon ini saat "Tambah ke Layar Utama": sajikan langsung, tanpa redirect.
  app.get("/apple-touch-icon.png", async (c) => {
    const id = await getIdentitas(db);
    if (id.ikon192Id) return servePublicFile(c, deps, id.ikon192Id);
    if (!deps.staticDir) return c.notFound();
    const file = await readFile(join(deps.staticDir, "icons/icon-192.png"));
    return c.body(file, 200, { "Content-Type": "image/png", "Cache-Control": "no-cache" });
  });

  if (deps.staticDir) {
    const root = deps.staticDir;
    // Aset ber-hash dari Vite boleh di-cache lama.
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    // Service worker & index.html harus selalu dicek ulang agar versi baru cepat terpasang.
    app.use("*", async (c, next) => {
      await next();
      const p = c.req.path;
      if (p === "/sw.js" || !p.includes(".")) c.header("Cache-Control", "no-cache");
    });
    app.use("*", serveStatic({ root }));
    // SPA fallback: route frontend selain /api dijawab index.html.
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}

export type AppType = ReturnType<typeof createApp>;
