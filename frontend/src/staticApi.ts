/**
 * Server-less mode (GitHub Pages). Built with VITE_STATIC=1, the app answers its own /api/* requests:
 *  - fixed answers come from JSON files exported by scripts/export_static.py into <base>/static-api/;
 *  - a typed question is matched to the closest prepared question (the panel says so when it is not exact);
 *  - extraction, variables, scatter plots and the ZIP export are computed here with the same rules as
 *    backend/flameatlas/services/export.py and analysis.py.
 */
const ROOT = `${import.meta.env.BASE_URL}static-api/`;
const realFetch = window.fetch.bind(window);
const key = (p: string) => p.replace(/^\/api\//, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") + ".json";
const cache = new Map<string, Promise<any>>();
const load = (file: string): Promise<any> => {
  if (!cache.has(file)) cache.set(file, realFetch(ROOT + file).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); }));
  return cache.get(file)!;
};
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

// ------------------------------------------------------------------ prepared questions
const STOP = new Set("the a an of in on at to for and or is are be does do did what which how why when who with without from by about into than then this that these those there their it its as can could would should will much many any some fire fires flame flames".split(" "));
const SYN: Record<string, string> = { lunar: "moon", artemis: "moon", martian: "mars", station: "iss", extinguish: "extinct", suppress: "extinct", suppressant: "extinct", suppression: "extinct", put: "extinct", out: "extinct", fans: "airflow", fan: "airflow", ventilation: "airflow", flow: "airflow", air: "airflow", smoke: "smoke", detector: "detect", detection: "detect", detectors: "detect", missing: "gap", gaps: "gap", lack: "gap", oxygen: "o2", "o₂": "o2", spacesuit: "suit", eva: "suit", weightless: "microgravity", zero: "microgravity", space: "microgravity", orbit: "microgravity", candle: "candle" };
const toks = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9%₂ ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)).map((w) => (SYN[w] ?? w).slice(0, 6)));
async function closest(q: string): Promise<{ q: string; file: string; exact: boolean }> {
  const list: { q: string; file: string }[] = await load("questions.json");
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const hit = list.find((x) => norm(x.q) === norm(q));
  if (hit) return { ...hit, exact: true };
  const A = toks(q);
  let best = list[0], score = -1;
  for (const x of list) {
    const B = toks(x.q); let inter = 0; A.forEach((w) => { if (B.has(w)) inter++; });
    const s = inter / Math.sqrt(Math.max(1, A.size) * Math.max(1, B.size));
    if (s > score) { score = s; best = x; }
  }
  return { ...best, exact: false };
}

// ------------------------------------------------------------------ table (extraction, variables, scatter)
interface Table { base_columns: string[]; quantity_columns: string[]; rows: unknown[][]; in_scope: string[]; test_vars: Record<string, { col: string; scale: number; unit: string }>; dictionary: any[]; variables: any[]; sources: Record<string, any>; limitations: string; version: string }
let rowsCache: { t: Table; rows: Record<string, any>[] } | null = null;
async function table() {
  if (rowsCache) return rowsCache;
  const t: Table = await load(key("/api/_table"));
  const cols = [...t.base_columns, ...t.quantity_columns];
  rowsCache = { t, rows: t.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]]))) };
  return rowsCache;
}
const qname = (h: string) => h.split(" [")[0];
const qunit = (h: string) => (h.includes(" [") ? h.split(" [")[1].replace(/]$/, "") : null);
const empty = (v: unknown) => v === null || v === undefined || v === "";

async function extract(req: any, limit?: number) {
  const { t, rows } = await table();
  const inScope = new Set(t.in_scope);
  const accs: string[] = req.accessions ?? [], types: string[] = req.record_types ?? ["test"];
  const rng = (v: number | null, lo?: number | null, hi?: number | null, sc = 1) =>
    (lo == null || (v != null && v >= lo * sc - 1e-9)) && (hi == null || (v != null && v <= hi * sc + 1e-9));
  let sel = rows.filter((r) => inScope.has(r.accession)
    && (!accs.length || accs.includes(r.accession))
    && (!types.length || types.includes(r.record_type))
    && (!req.fuel_phase || r.fuel_phase === req.fuel_phase)
    && rng(r.o2_mole_frac, req.o2_pct_min, req.o2_pct_max, 0.01)
    && rng(r.pressure_kpa, req.pressure_kpa_min, req.pressure_kpa_max)
    && rng(r.flow_cm_s, req.flow_cm_s_min, req.flow_cm_s_max)
    && (!(req.outcome_classes ?? []).length || req.outcome_classes.includes(r.outcome_class))
    && (req.exclude_flags ?? []).every((f: string) => !String(r.quality ?? "").includes(f))
    && (req.require_complete ?? []).every((c: string) => !t.base_columns.includes(c) || r[c] != null));
  const present = new Map<string, number>();
  for (const r of sel) for (const h of t.quantity_columns) if (r[h] != null) present.set(h, (present.get(h) ?? 0) + 1);
  let qh = t.quantity_columns.filter((h) => present.has(h));
  if (req.quantities) qh = qh.filter((h) => req.quantities.includes(qname(h)));
  else qh.sort((a, b) => present.get(b)! - present.get(a)!);
  for (const c of req.require_complete ?? []) { const h = qh.find((x) => x.startsWith(c + " [")); if (h) sel = sel.filter((r) => !empty(r[h])); }
  const columns = [...t.base_columns, ...qh];
  const out = sel.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
  return { columns, rows: limit ? out.slice(0, limit) : out, total: out.length, accessions: [...new Set(out.map((r) => r.accession as string))].sort(),
           quantities: qh.map((h) => ({ quantity: qname(h), unit: qunit(h), n: present.get(h) })) };
}

async function variables(accs: string[]) {
  const { t, rows } = await table();
  const out: any[] = Object.entries(t.test_vars).map(([id, v]) => ({ id, label: id.replace(/_/g, " "), unit: v.unit, level: "test" }));
  const sel = accs.length ? rows.filter((r) => accs.includes(r.accession)) : rows;
  const n = t.quantity_columns.map((h) => ({ h, n: sel.reduce((k, r) => k + (typeof r[h] === "number" ? 1 : 0), 0) })).filter((x) => x.n >= 3).sort((a, b) => b.n - a.n);
  out.push(...n.map(({ h, n }) => ({ id: `m:${qname(h)}`, label: qname(h).replace(/_/g, " "), unit: qunit(h), level: "measurement", n })));
  return { dictionary: t.variables, plottable: out };
}

function fit(xs: number[], ys: number[]) {
  const n = xs.length; if (n < 4) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  if (sxx === 0) return null;
  const slope = sxy / sxx, intercept = my - slope * mx;
  let res = 0, tot = 0; for (let i = 0; i < n; i++) { res += (ys[i] - (intercept + slope * xs[i])) ** 2; tot += (ys[i] - my) ** 2; }
  return { n, slope, intercept, r2: 1 - res / (tot || 1e-12), slope_se: n > 2 ? Math.sqrt(res / (n - 2)) / Math.sqrt(sxx) : null,
           x_min: Math.min(...xs), x_max: Math.max(...xs), kind: "descriptive least squares (within measured domain)" };
}
async function scatter(x: string, y: string, accs: string[], color: string) {
  const { t, rows } = await table();
  const val = (r: Record<string, any>, v: string): number | null => {
    const tv = t.test_vars[v]; if (tv) return r[tv.col] == null ? null : r[tv.col] * tv.scale;
    if (v.startsWith("m:")) { const h = t.quantity_columns.find((c) => qname(c) === v.slice(2)); const z = h ? r[h] : null; return typeof z === "number" ? z : null; }
    return null;
  };
  let sel = rows.filter((r) => r.record_type === "test" && (!accs.length || accs.includes(r.accession)));
  if ((x + y).includes("o2")) sel = sel.filter((r) => !String(r.quality ?? "").includes("o2_is_oxidizer_stream_not_ambient"));
  const points: any[] = [];
  for (const r of sel) {
    const xv = val(r, x), yv = val(r, y); if (xv == null || yv == null) continue;
    points.push({ x: xv, y: yv, test_id: r.test_id, accession: r.accession, group: String(r[color] ?? "n/a"), fuel: r.fuel, outcome: r.outcome_class, diluent: r.diluent, source_row: r.source_row, source_file: r.source_file });
  }
  const fits: Record<string, any> = {}; const groups = new Map<string, any[]>();
  points.forEach((p) => (groups.get(p.group) ?? groups.set(p.group, []).get(p.group)!).push(p));
  groups.forEach((ps, g) => { const f = fit(ps.map((p) => p.x), ps.map((p) => p.y)); if (f) fits[g] = f; });
  return { x, y, color, n: points.length, points, fits };
}

// ------------------------------------------------------------------ ZIP export (stored, no compression)
const CRC = (() => { const tb = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; tb[n] = c >>> 0; } return tb; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files: [string, string][]): Blob {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let off = 0;
  for (const [name, text] of files) {
    const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), nm, data); central.push(new Uint8Array(c.buffer), nm); off += 30 + nm.length + data.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)] as BlobPart[], { type: "application/zip" });
}
const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (cols: string[], rows: Record<string, unknown>[]) => [cols.map(csvCell).join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
async function exportZip(req: any) {
  const { t } = await table();
  const r = await extract(req);
  const dd = t.dictionary.filter((d) => r.columns.includes(d.column));
  const sources = r.accessions.map((a) => t.sources[a]).filter(Boolean);
  const provenance = { generated_by: `Fire Lab ${t.version} (web)`, generated_at: new Date().toISOString().slice(0, 19) + "+00:00", n_rows: r.total, request: req, sources,
    transformations: ["Pressure converted to kPa from mmHg (×0.133322), atm (×101.325), bar (×100), psia (×6.894757).", "O2 expressed as mole fraction (percent / 100).",
      "Thickness converted to mm (micron /1000, cm ×10, inch ×25.4).", "Measurements pivoted to one column per quantity; units in the column header."] };
  const citation = sources.map((s: any) => `${s.acronym || s.accession}: ${s.title}. NASA Physical Sciences Informatics. https://doi.org/${s.doi}`).join("\n");
  const blob = zip([["data.csv", csv(r.columns, r.rows)], ["data_dictionary.csv", csv(["column", "label", "unit", "level", "description"], dd)],
    ["provenance.json", JSON.stringify(provenance, null, 2)], ["LIMITATIONS.md", t.limitations], ["CITATION.txt", "Please cite every dataset you use with its DOI:\n\n" + citation + "\n"]]);
  const name = "fire_lab_extract_" + (r.accessions.slice(0, 4).join("_") || "empty") + ".zip";
  return new Response(blob, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${name}"`, "x-rows": String(r.total) } });
}

// ------------------------------------------------------------------ router
async function handle(url: URL, method: string, body: any): Promise<Response> {
  const p = url.pathname.slice(url.pathname.indexOf("/api/")); const q = url.searchParams;
  const list = (k: string) => (q.get(k) ? q.get(k)!.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : []);
  if (p === "/api/kg/research" || p === "/api/rank") {
    const text = String(body?.query ?? "").trim(); const m = await closest(text); const d = await load(m.file);
    if (p === "/api/rank") return json(d.rank);
    const r = { ...d.research, query: m.exact ? text : m.q };
    if (!m.exact) r.warnings = [`This online version answers a set of prepared questions. Closest one to “${text}”.`, ...(r.warnings ?? [])];
    return json(r);
  }
  if (p === "/api/extract/preview") return json(await extract(body ?? {}, Number(q.get("limit") ?? 100)));
  if (p === "/api/extract/export") return exportZip(body ?? {});
  if (p === "/api/variables") return json(await variables(list("accessions")));
  if (p === "/api/analysis/scatter") return json(await scatter(q.get("x")!, q.get("y")!, list("accessions"), q.get("color") ?? "accession"));
  if (method !== "GET") return json({ detail: "Not available in the online version — run Fire Lab locally for this." }, 501);
  const sorted = [...q.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
  try { return json(await load(key(p + (sorted ? `?${sorted}` : "")))); } catch { return json({ detail: "not found" }, 404); }
}

export const IS_STATIC = Boolean(import.meta.env.VITE_STATIC);
if (IS_STATIC) window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.includes("/api/")) return realFetch(input, init);
  let body: any = null; try { body = init?.body ? JSON.parse(String(init.body)) : null; } catch { /* not json */ }
  return handle(url, (init?.method ?? "GET").toUpperCase(), body);
};

