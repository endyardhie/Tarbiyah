/** Normalisasi nomor HP Indonesia ke format 628…; null bila tidak valid. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (d.startsWith("8")) d = `62${d}`;
  return /^628\d{7,11}$/.test(d) ? d : null;
}
