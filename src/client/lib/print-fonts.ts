// Font untuk halaman cetak di dalam iframe (CSS halaman utama tidak ikut masuk ke iframe).
// Di-bundle Vite sebagai aset sendiri, jadi tidak bergantung font di perangkat & tanpa CDN.
import amiri from "@fontsource/amiri/files/amiri-arabic-400-normal.woff2?url";
import amiriBold from "@fontsource/amiri/files/amiri-arabic-700-normal.woff2?url";
import jakarta from "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url";

export const PRINT_FONTS = `
@font-face { font-family: "Plus Jakarta Sans Variable"; src: url(${jakarta}) format("woff2"); font-weight: 200 800; }
@font-face { font-family: "Amiri"; src: url(${amiri}) format("woff2"); font-weight: 400; }
@font-face { font-family: "Amiri"; src: url(${amiriBold}) format("woff2"); font-weight: 700; }
`;
