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

// ------------------------------------------------------------------ AI answers (any question) through the relay in ai-relay/
// The relay holds the Claude key; the browser only finds the sources (same rules as knowledge/research.py) and sends them.
const foldS = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STOPWORDS = new Set("the a an of in on at to for and or is are was were be been does do did what which how why when who whom with without from by about into than then this that these those there their its it as can could would should will much many any some not no yes we you they he she i me my our your le la les des un une du de et ou est sont que qui quoi quel quelle quels quelles comment pourquoi pour avec sans sur dans par pas plus".split(" "));
let kbP: Promise<any> | null = null;
const kb = () => (kbP ??= load(key("/api/_kb")).then((k) => {
  const docs = k.chunks.map((c: any) => { const toks = foldS(c.text + " " + c.section).match(/[a-z0-9]{3,}/g) ?? []; const tf = new Map<string, number>(); toks.forEach((t: string) => tf.set(t, (tf.get(t) ?? 0) + 1)); return { c, tf, len: toks.length }; });
  const df = new Map<string, number>(); docs.forEach((d: any) => d.tf.forEach((_: number, t: string) => df.set(t, (df.get(t) ?? 0) + 1)));
  const avg = docs.reduce((a: number, d: any) => a + d.len, 0) / Math.max(1, docs.length);
  const rx = (al: string[]) => al.map((a) => new RegExp(`(?<![a-z0-9])${esc(a)}(?:s|es)?(?![a-z0-9])`));
  const terms = (tab: Record<string, string[]>) => Object.fromEntries(Object.entries(tab).map(([id, al]) => [id, rx(al)]));
  return { ...k, docs, df, avg, crx: terms(k.concepts), erx: terms(k.entities) };
}));
let aiP: Promise<string | null> | null = null;
const aiEndpoint = () => (aiP ??= realFetch(`${import.meta.env.BASE_URL}ai.json`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then((j: any) => j.endpoint || null).catch(() => null));

async function aiResearch(q: string, endpoint: string) {
  const K = await kb(); const f = foldS(q);
  const find = (tab: Record<string, RegExp[]>) => Object.fromEntries(Object.entries(tab).flatMap(([id, rs]) => { for (const r of rs) { const m = f.match(r); if (m) return [[id, m[0]]]; } return []; }));
  const concepts: Record<string, string> = find(K.crx), entities: Record<string, string> = find(K.erx);
  // BM25 over the passages: words of the question, plus the aliases of the concepts it names (half weight)
  const qt = new Map<string, number>();
  (f.match(/[a-z0-9]{3,}/g) ?? []).filter((t) => !STOPWORDS.has(t)).forEach((t) => qt.set(t, 1));
  Object.keys(concepts).forEach((c) => K.concepts[c].forEach((a: string) => (a.match(/[a-z0-9]{3,}/g) ?? []).forEach((t) => { if (!qt.has(t)) qt.set(t, 0.5); })));
  const N = K.docs.length;
  const scored = K.docs.map((d: any) => { let sc = 0; qt.forEach((w, t) => { const n = d.tf.get(t); if (!n) return; const idf = Math.log(1 + (N - K.df.get(t) + 0.5) / (K.df.get(t) + 0.5)); sc += w * idf * (n * 2.2) / (n + 1.2 * (0.25 + 0.75 * d.len / K.avg)); }); return { c: d.c, sc }; })
    .filter((x: any) => x.sc > 0).sort((a: any, b: any) => b.sc - a.sc);
  const picked: any[] = []; const per = new Map<string, number>();
  for (const x of scored) { if ((per.get(x.c.accession) ?? 0) >= 2) continue; picked.push(x); per.set(x.c.accession, (per.get(x.c.accession) ?? 0) + 1); if (picked.length >= 9) break; }
  const label = (id: string) => K.nodes[id]?.label ?? id;
  const sources: any[] = []; const add = (kind: string, node: string | null, title: string, text: string, extra: object = {}) => { sources.push({ id: `S${sources.length + 1}`, kind, node, title, text, ...extra }); };
  for (const x of picked) add("passage", `doc:${x.c.accession}`, `${label("doc:" + x.c.accession)} — ${x.c.section}`, x.c.text, { chunk_id: x.c.id, section: x.c.section, score: +x.sc.toFixed(3) });
  const docsUsed = [...new Set(picked.map((x) => x.c.accession))];
  const found = new Set<string>();
  K.edges.forEach((e: any) => { if (e.rel === "supports" && e.dst.startsWith("research:") && docsUsed.includes(e.src.slice(4))) found.add(e.dst); if (e.rel === "mentions" && e.src.startsWith("research:") && concepts[e.dst.slice(8)] !== undefined) found.add(e.src); });
  [...found].slice(0, 4).forEach((rid) => { const n = K.nodes[rid]; if (n) add("finding", rid, n.label, `${n.description ?? ""} Limitation: ${n.limitation ?? "n/a"}`, { evidence_kind: n.evidence_kind }); });
  // evidence path for the graph
  const pn = new Map<string, any>([["query", { id: "query", type: "query", label: q }]]); const pe: any[] = [];
  Object.keys(concepts).forEach((c) => { pn.set(`concept:${c}`, { id: `concept:${c}`, role: "concept" }); pe.push({ src: "query", dst: `concept:${c}`, rel: "asks_about", used: true }); });
  Object.keys(entities).forEach((e) => { pn.set(`entity:${e}`, { id: `entity:${e}`, role: "entity" }); pe.push({ src: "query", dst: `entity:${e}`, rel: "asks_about", used: true }); });
  sources.forEach((s) => { if (s.node && !pn.has(s.node)) pn.set(s.node, { id: s.node, role: s.kind }); });
  const anchors = [...pn.keys()].filter((k) => /^(concept|entity):/.test(k)), used = [...pn.keys()].filter((k) => k.startsWith("doc:"));
  K.edges.forEach((e: any) => { if (used.includes(e.src) && (anchors.includes(e.dst) || (pn.has(e.dst) && /^(research|data):/.test(e.dst)))) pe.push({ id: e.id, src: e.src, dst: e.dst, rel: e.rel, used: true }); });
  const related: string[] = [];
  anchors.slice(0, 6).forEach((a) => K.edges.filter((e: any) => e.dst === a && e.src.startsWith("doc:")).slice(0, 12).forEach((e: any) => { if (!pn.has(e.src)) { related.push(e.src); pn.set(e.src, { id: e.src, role: "related" }); pe.push({ id: e.id, src: e.src, dst: a, rel: e.rel, used: false }); } }));
  pn.forEach((v, k) => { if (k !== "query" && K.nodes[k]) Object.assign(v, { type: K.nodes[k].type, label: K.nodes[k].label }); });
  const warnings: string[] = [];
  if (entities.moon !== undefined || entities.mars !== undefined) warnings.push("Partial gravity: the PSI corpus holds microgravity and 1-g data only — values are bounds, not lunar or martian measurements.");
  // the answer
  let answer = "The documents in the knowledge base do not provide a reliable answer to this question.", mode = "no_evidence", model: string | null = null;
  if (sources.length) {
    const r = await realFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q, sources: sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title, text: String(s.text).slice(0, 1500) })) }) });
    const raw = await r.text(); let out: any = {}; try { out = JSON.parse(raw); } catch { /* not json */ }
    (window as any).__fireLabAI = { status: r.status, raw: raw.slice(0, 2000), sent: sources.length };
    if (!r.ok || !out.text) throw new Error(out.error ?? `AI relay ${r.status}: ${raw.slice(0, 160)}`);
    let text: string = out.text; const valid = new Set(sources.map((s) => s.id)); const cited = new Set([...text.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]));
    cited.forEach((c) => { if (!valid.has(c)) { text = text.split(`[${c}]`).join(""); warnings.push(`Removed an unknown citation ${c}.`); } });
    if (![...cited].some((c) => valid.has(c))) throw new Error("answer without a valid citation");
    answer = text; mode = "llm"; model = out.model ?? null;
  }
  const usedIds = new Set([...answer.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]));
  sources.forEach((s) => (s.used = usedIds.has(s.id)));
  pn.forEach((v) => (v.used = v.id === "query" || sources.some((s) => s.node === v.id && s.used) || ["concept", "entity"].includes(v.role)));
  // ranking for the side panel: investigations by retrieval score
  const byAcc = new Map<string, { s: number; sec: string }>(); scored.slice(0, 60).forEach((x: any) => { const b = byAcc.get(x.c.accession); if (!b) byAcc.set(x.c.accession, { s: x.sc, sec: x.c.section }); else b.s += x.sc * 0.3; });
  const top = [...byAcc.entries()].sort((a, b) => b[1].s - a[1].s).slice(0, 8); const mx = top[0]?.[1].s || 1;
  const num = (re: RegExp) => { const m = f.match(re); return m ? Number(m[1].replace(",", ".")) : null; };
  const scenario = { query: q, include_ground_studies: true, habitat: null, gravity: null, need: null, fuel_phase: null,
    o2_pct: num(/(\d{1,2}(?:[.,]\d+)?)\s?%\s*(?:o2|o₂|oxyg|d'oxyg|of oxygen)?/), pressure_kpa: num(/(\d{1,3}(?:[.,]\d+)?)\s?kpa/), flow_cm_s: num(/(\d{1,3}(?:[.,]\d+)?)\s?cm\/s/) };
  const rankRes = { web: true, scenario, parsed: null, weights: {}, status_scores: {}, results: top.map(([acc, v]) => ({ accession: acc, acronym: K.nodes[`doc:${acc}`]?.acronym ?? label(`doc:${acc}`).split(" — ")[0], score: Math.min(0.97, 0.35 + 0.62 * v.s / mx), why: [`Its “${v.sec}” matches the question.`] })), notes: [] };
  return { research: { id: "R-web", query: q, created: Date.now() / 1000, answer, mode, model, warnings, understood: { concepts, entities, values: [], parsed: {} },
    sources, path: { nodes: [...pn.values()], edges: pe }, related_documents: related.slice(0, 20) }, rank: rankRes };
}
const aiCache = new Map<string, Promise<any>>();

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
    const text = String(body?.query ?? "").trim();
    const ep = await aiEndpoint();
    if (ep && text.length > 1) {
      // research and rank are asked together: one retrieval + one AI call serves both
      const k = text.toLowerCase();
      if (!aiCache.has(k)) aiCache.set(k, aiResearch(text, ep));
      try { const d = await aiCache.get(k)!; return json(p === "/api/rank" ? d.rank : d.research); }
      catch (e) { aiCache.delete(k); console.warn("AI unavailable, prepared answer shown:", e); }
    }
    const m = await closest(text); const d = await load(m.file);
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

