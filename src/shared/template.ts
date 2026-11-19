/**
 * Renderer template rapor bergaya Mustache (subset), dipakai pratinjau & cetak:
 *   {{nama.field}}          nilai, SELALU di-escape (tidak ada {{{raw}}})
 *   {{#daftar}}…{{/daftar}} ulangi untuk array; untuk nilai lain tampil bila truthy
 *   {{^daftar}}…{{/daftar}} tampil bila kosong/falsy
 * Tanpa eval; template hanya bisa menyusun teks yang sudah di-escape.
 */
type Ctx = Record<string, unknown>;
type Node =
  | { t: "text"; v: string }
  | { t: "var"; v: string }
  | { t: "section"; v: string; inverted: boolean; children: Node[] };

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
export const escapeHtml = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c] as string);

function parse(tpl: string): Node[] {
  const root: Node[] = [];
  const stack: { name: string; children: Node[] }[] = [{ name: "", children: root }];
  const re = /\{\{\s*([#^/]?)\s*([\w.]+)\s*\}\}/g;
  let last = 0;
  for (let m = re.exec(tpl); m; m = re.exec(tpl)) {
    const top = stack[stack.length - 1] as (typeof stack)[number];
    if (m.index > last) top.children.push({ t: "text", v: tpl.slice(last, m.index) });
    last = re.lastIndex;
    const [, kind, name = ""] = m;
    if (kind === "#" || kind === "^") {
      const node: Node = { t: "section", v: name, inverted: kind === "^", children: [] };
      top.children.push(node);
      stack.push({ name, children: node.children });
    } else if (kind === "/") {
      if (stack.length === 1 || top.name !== name)
        throw new Error(`Penutup {{/${name}}} tidak cocok`);
      stack.pop();
    } else top.children.push({ t: "var", v: name });
  }
  if (stack.length > 1)
    throw new Error(`Bagian {{#${stack[stack.length - 1]?.name}}} belum ditutup`);
  if (last < tpl.length) root.push({ t: "text", v: tpl.slice(last) });
  return root;
}

function lookup(stack: unknown[], path: string): unknown {
  if (path === ".") return stack[0];
  const [head, ...rest] = path.split(".");
  for (const ctx of stack) {
    if (ctx && typeof ctx === "object" && (head as string) in (ctx as Ctx)) {
      let v: unknown = (ctx as Ctx)[head as string];
      for (const k of rest) v = v && typeof v === "object" ? (v as Ctx)[k] : undefined;
      return v;
    }
  }
  return undefined;
}

function render(nodes: Node[], stack: unknown[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "var") out += escapeHtml(lookup(stack, n.v));
    else {
      const v = lookup(stack, n.v);
      const empty = !v || (Array.isArray(v) && v.length === 0);
      if (n.inverted) {
        if (empty) out += render(n.children, stack);
      } else if (Array.isArray(v)) {
        for (const item of v) out += render(n.children, [item, ...stack]);
      } else if (!empty) out += render(n.children, [v, ...stack]);
    }
  }
  return out;
}

export function renderTemplate(tpl: string, data: Ctx): string {
  return render(parse(tpl), [data]);
}

/** Validasi sintaks template (dipakai saat menyimpan). */
export function checkTemplate(tpl: string): string | null {
  try {
    parse(tpl);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
