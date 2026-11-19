function toBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Gagal membuat gambar"))),
      type,
      quality,
    ),
  );
}

/** Gambar dipaskan (contain) di kanvas persegi. `fill` = proporsi area aman (maskable: 0.8). */
async function square(img: ImageBitmap, size: number, fill: number, background: string | null) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Browser tidak mendukung canvas");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  const scale = Math.min((size * fill) / img.width, (size * fill) / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  return toBlob(c);
}

/** Logo (maks 1024 px) + ikon PWA 192, 512, dan maskable 512 — semuanya PNG, dibuat di browser. */
export async function makeLogoSet(file: File) {
  const img = await createImageBitmap(file);
  const max = Math.min(1024, Math.max(img.width, img.height));
  const logoCanvas = document.createElement("canvas");
  const scale = max / Math.max(img.width, img.height);
  logoCanvas.width = Math.round(img.width * scale);
  logoCanvas.height = Math.round(img.height * scale);
  logoCanvas.getContext("2d")?.drawImage(img, 0, 0, logoCanvas.width, logoCanvas.height);
  return {
    logo: await toBlob(logoCanvas),
    ikon192: await square(img, 192, 0.92, "#ffffff"),
    ikon512: await square(img, 512, 0.92, "#ffffff"),
    ikonMaskable: await square(img, 512, 0.7, "#ffffff"),
  };
}

/**
 * Kecilkan foto sebelum diunggah: lebar maks 1600 px, WebP (atau JPEG) kualitas ±0,8,
 * diturunkan bertahap sampai ±300 KB. PDF dan berkas lain dikirim apa adanya.
 */
export async function compressPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale);
  c.height = Math.round(img.height * scale);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  const webp = (await toBlob(c, "image/webp", 0.8)).type === "image/webp";
  const type = webp ? "image/webp" : "image/jpeg";
  let blob = await toBlob(c, type, 0.8);
  for (const q of [0.7, 0.6, 0.5]) {
    if (blob.size <= 300 * 1024) break;
    blob = await toBlob(c, type, q);
  }
  return new File([blob], file.name.replace(/\.\w+$/, webp ? ".webp" : ".jpg"), { type });
}
