import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { clientIp } from "./lib/client-ip";
import { type AppDeps, type AppEnv, fail } from "./lib/context";
import { safeError } from "./lib/log";
import { findSession, loadAuthUser, readSessionToken, setSessionCookie } from "./lib/session";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { roleRoutes } from "./routes/roles";
import { userRoutes } from "./routes/users";

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
    .get("/public-config", (c) => c.json({ turnstileSiteKey: config.turnstileSiteKey }))
    .route("/auth", authRoutes(deps))
    .route("/me", meRoutes(deps))
    .route("/users", userRoutes(deps))
    .route("/roles", roleRoutes(deps))
    .all("*", (c) => c.json({ error: "Tidak ditemukan" }, 404));

  const app = new Hono().route("/api", api).onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(`${c.req.method} ${c.req.path}: ${safeError(err)}`);
    return c.json({ error: "Terjadi kesalahan di server" }, 500);
  });

  if (deps.staticDir) {
    const root = deps.staticDir;
    // Aset ber-hash dari Vite boleh di-cache lama.
    app.use("/assets/*", async (c, next) => {
      await next();
      if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
    });
    app.use("*", serveStatic({ root }));
    // SPA fallback: route frontend selain /api dijawab index.html.
    app.get("*", serveStatic({ root, path: "index.html" }));
  }

  return app;
}

export type AppType = ReturnType<typeof createApp>;
