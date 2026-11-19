import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { type HealthDeps, healthRoutes } from "./routes/health";

export type AppDeps = HealthDeps & { staticDir?: string };

export function createApp(deps: AppDeps) {
  const api = new Hono()
    .route("/health", healthRoutes(deps))
    .all("*", (c) => c.json({ error: "Tidak ditemukan" }, 404));

  const app = new Hono().route("/api", api).onError((err, c) => {
    console.error(err);
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
