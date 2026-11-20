// Pasang tema sebelum render agar tidak berkedip tema yang salah (berkas terpisah: CSP tanpa inline script).
(() => {
  var t;
  try {
    t = localStorage.getItem("tema");
  } catch {}
  if (t !== "light" && t !== "dark")
    t = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = t;
})();
