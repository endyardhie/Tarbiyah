# TARBIYAH

Sistem informasi sekolah, pondok pesantren, dan madrasah — multi-lokasi dan multi-unit.
Presensi, akademik & rapor, keuangan (SPP), informasi, dan notifikasi dalam satu aplikasi web
(PWA) yang di-self-host.

**Author:** Endy Ardhie

## Teknologi

Node.js 24 · TypeScript · Hono · React + Vite · Tailwind CSS v4 · PostgreSQL 17 + Drizzle ORM ·
pg-boss · Docker

## Development

```bash
cp .env.example .env            # isi APP_ENCRYPTION_KEY: openssl rand -base64 32
docker compose up -d db         # Postgres lokal
pnpm install
pnpm dev                        # frontend http://localhost:5173, API :3000
```

| Perintah | Fungsi |
| --- | --- |
| `pnpm test` | tes (butuh Postgres lokal) |
| `pnpm lint` | Biome |
| `pnpm build` / `pnpm start` | build & jalankan hasil build |
| `pnpm db:generate` | buat migrasi dari skema Drizzle |
| `pnpm db:migrate` | terapkan migrasi |

Rancangan: [docs/RANCANGAN.md](docs/RANCANGAN.md) · Deploy: [docs/DEPLOY.md](docs/DEPLOY.md)
