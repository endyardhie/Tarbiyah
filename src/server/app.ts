import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { clientIp } from "./lib/client-ip";
import { type AppDeps, type AppEnv, fail } from "./lib/context";
import { safeError } from "./lib/log";
import { pemeliharaan } from "./lib/pemeliharaan";
import { findSession, loadAuthUser, readSessionToken, setSessionCookie } from "./lib/session";
import { agendaRoutes } from "./routes/agenda";
import { akademikRoutes, penilaianRoutes, raporRoutes, tugasRoutes } from "./routes/akademik";
import { auditRoutes } from "./routes/audit";
import { authRoutes } from "./routes/auth";
import { backupRoutes } from "./routes/backup";
import { healthRoutes } from "./routes/health";
import { imporRoutes } from "./routes/impor";
import { notifikasiRoutes, pengumumanRoutes, pushRoutes } from "./routes/informasi";
import { keuanganRoutes, webhookRoutes } from "./routes/keuangan";
import { meRoutes } from "./routes/me";
import { fileRoutes, pengaturanRoutes, servePublicFile } from "./routes/pengaturan";
import { presensiRoutes } from "./routes/presensi";
import { roleRoutes } from "./routes/roles";
import { santriRoutes, santriWaliRoutes, waliRoutes } from "./routes/santri";
import { sekolahRoutes } from "./routes/sekolah";
import { tahunBaruRoutes } from "./routes/tahun-baru";
import { userRoutes } from "./routes/users";
import { getIdentitas, isSampleData } from "./services/pengaturan";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TERBUKA_SAAT_PEMELIHARAAN = new Set([
  "/api/health",
  "/api/backup/status",
  "/api/public-config",
]);

export function createApp(deps: AppDeps) {
  const { db, config } = deps;
  const appOrigin = new URL(config.appUrl).origin;

  const api = new Hono<AppEnv>()
    // Body dibaca utuh ke memori; batasi agar container 512 MB aman. Unggah logo & lampiran: 6 MB
    // (batas per jenis berkas dicek lagi di route-nya).
    .use((c, next) => {
      const unggah =
        c.req.path === "/api/pengaturan/logo" || /^\/api\/tugas\/[^/]+\/lampiran$/.test(c.req.path);
      // Dump backup di-stream ke disk (tidak ke memori), jadi batasnya besar.
      const dump = c.req.path === "/api/backup/unggah";
      return bodyLimit({
        maxSize: dump ? 2 * 1024 ** 3 : unggah ? 6 * 1024 * 1024 : 1024 * 1024,
        onError: (c) => c.json({ error: "Data terlalu besar" }, 413),
      })(c, next);
    })
    .use(async (c, next) => {
      // Mode pemeliharaan (restore): semua permintaan ditolak kecuali status & health.
      if (pemeliharaan.aktif() && !TERBUKA_SAAT_PEMELIHARAAN.has(c.req.path)) {
        return c.json(
          {
            error: "Aplikasi sedang dipulihkan dari backup. Coba lagi beberapa menit lagi.",
            pemeliharaan: true,
          },
          503,
        );
      }
      c.set("ip", clientIp(c, config.trustCloudflare));
      // Cegah CSRF: request yang mengubah data harus datang dari APP_URL.
      // Webhook dari server provider (bukan browser) tidak membawa Origin; diverifikasi tanda tangan.
      const webhook = c.req.path.startsWith("/api/webhooks/");
      if (!webhook && !SAFE_METHODS.has(c.req.method) && c.req.header("origin") !== appOrigin) {
        throw fail(403, "Asal permintaan tidak diizinkan");
      }
      c.set("user", null);
      c.set("sessionId", null);
      // Selama restore tabel sesi sedang diganti: endpoint yang masih terbuka tidak butuh sesi.
      const token = pemeliharaan.aktif() ? undefined : readSessionToken(c);
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
    .route("/notifikasi", notifikasiRoutes(deps))
    .route("/pengumuman", pengumumanRoutes(deps))
    .route("/push", pushRoutes(deps))
    .route("/tugas", tugasRoutes(deps))
    .route("/penilaian", penilaianRoutes(deps))
    .route("/akademik", akademikRoutes(deps))
    .route("/rapor", raporRoutes(deps))
    .route("/keuangan", keuanganRoutes(deps))
    .route("/webhooks", webhookRoutes(deps))
    .route("/backup", backupRoutes(deps))
    .route("/tahun-baru", tahunBaruRoutes(deps))
    .route("/audit", auditRoutes(deps))
    .all("*", (c) => c.json({ error: "Tidak ditemukan" }, 404));

  const turnstile = "https://challenges.cloudflare.com";
  const app = new Hono()
    .use(
      secureHeaders({
        contentSecurityPolicy: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", turnstile],
          frameSrc: [turnstile],
          connectSrc: ["'self'", turnstile],
          // Atribut style dari React & CSS cetak di iframe srcdoc.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'", "data:"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
        strictTransportSecurity: config.appUrl.startsWith("https://")
          ? "max-age=31536000; includeSubDomains"
          : false,
        referrerPolicy: "strict-origin-when-cross-origin",
        xFrameOptions: "DENY",
        // Bawaan "require-corp" akan memblokir skrip Turnstile.
        crossOriginEmbedderPolicy: false,
        permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
      }),
    )
    .route("/api", api)
    .onError((err, c) => {
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
