import PgBoss from "pg-boss";

export function createBoss(connectionString: string) {
  // Pool kecil: total koneksi aplikasi tetap di bawah batas Postgres.
  const boss = new PgBoss({ connectionString, max: 3 });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  return boss;
}
