# Panduan pengembang

Untuk pengembang yang ingin menjalankan atau mengembangkan TARBIYAH. Pengguna aplikasi cukup membaca
[manual pengguna](manual/README.md).

## Teknologi

Node.js 24 · TypeScript · Hono · React + Vite · Tailwind CSS v4 · PostgreSQL 17 + Drizzle ORM ·
pg-boss · Docker. Satu container berisi API, frontend (PWA), dan pekerja latar; tanpa Redis.

## Menjalankan di komputer sendiri

```bash
cp .env.example .env            # isi APP_ENCRYPTION_KEY: openssl rand -base64 32
docker compose up -d db         # Postgres lokal
pnpm install
pnpm dev                        # frontend http://localhost:5173, API :3000
```

Data contoh (12 kelas, ±200 santri, semua akun berpassword `contoh123`):

```bash
pnpm db:seed --contoh
```

| Perintah | Fungsi |
| --- | --- |
| `pnpm test` | tes (butuh Postgres lokal) |
| `pnpm lint` | Biome |
| `pnpm build` / `pnpm start` | build & jalankan hasil build |
| `pnpm db:generate` | buat migrasi dari skema Drizzle |
| `pnpm db:migrate` | terapkan migrasi |

## Dokumen lain

- [Rancangan](RANCANGAN.md): skema data, hak akses, dan alur.
- [Deploy](DEPLOY.md): memasang di server (Docker, Coolify), backup, firewall.
- [Manual pengguna](manual/README.md): termasuk cara membangun ulang PDF dan tangkapan layar.
