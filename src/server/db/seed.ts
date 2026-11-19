// Data contoh untuk development/staging. Admin awal & data sekolah ditambahkan di M1/M2.
if (process.env.NODE_ENV === "production") {
  console.error("Seed ditolak: NODE_ENV=production");
  process.exit(1);
}
console.log("Belum ada data contoh (ditambahkan di M1/M2).");
