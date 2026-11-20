import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: "src/client",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: ".",
      filename: "sw.ts",
      // Manifest dibuat server dari pengaturan (nama & ikon lembaga), bukan saat build.
      manifest: false,
      injectRegister: false,
      // Font Arab hanya untuk halaman cetak: tidak perlu diunduh semua pengguna saat install.
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,woff2,png}"],
        globIgnores: ["**/amiri-*"],
      },
    }),
  ],
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/manifest.webmanifest": "http://localhost:3000",
      "/apple-touch-icon.png": "http://localhost:3000",
    },
  },
});
