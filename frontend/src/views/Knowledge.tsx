import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as d3 from "d3";
import { MiniMarkdown } from "../components/ui";

// ------------------------------------------------------------------ API
type NodeType = "document" | "concept" | "entity" | "data" | "research" | "query";
interface KNode { id: string; type: NodeType; label: string; description?: string; props: Record<string, any>; degree: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }
interface KEdge { id: string; src: string; dst: string; rel: string; basis: string; weight: number; n_evidence: number; quote?: string | null; source?: KNode; target?: KNode }
interface Overview { nodes: Record<string, number>; edges: Record<string, number>; bases: Record<string, number>; documents: number; relations: Record<string, string>; node_types: Record<string, string> }
interface Research {
  id: string; query: string; answer: string; mode: string; model?: string | null; warnings: string[];
  understood: { concepts: Record<string, string>; entities: Record<string, string>; values: string[] };
  sources: { id: string; kind: string; node: string | null; title: string; text: string; used: boolean; chunk_id?: number; section?: string }[];
  path: { nodes: { id: string; type?: string; label?: string; role?: string; used?: boolean }[]; edges: { id?: string; src: string; dst: string; rel: string; used: boolean }[] };
}
const j = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail; } catch { /* */ } throw new Error(`${r.status} ${d}`); }
  return r.json();
};
const toB64 = (f: File) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.onerror = rej; fr.readAsDataURL(f); });

const TYPE_LABEL: Record<string, string> = { document: "Documents", concept: "Concepts", entity: "Entities", data: "Data", research: "Research" };
const REL_LABEL = (r: string) => r.replace(/_/g, " ");
const BASIS_LABEL: Record<string, string> = { metadata: "PSI metadata", text: "passage in the text", table: "test tables", computed: "computed from tables", curated: "curated from stated text", inferred: "inferred (not stated)", wikilink: "wikilink in a note" };

// ------------------------------------------------------------------ drawing helpers (monochrome; shape encodes type)
function drawNode(g: CanvasRenderingContext2D, n: KNode, r: number, fill: string, stroke: string, lw: number) {
  const x = n.x!, y = n.y!;
  g.lineWidth = lw; g.strokeStyle = stroke; g.fillStyle = fill;
  g.beginPath();
  switch (n.type) {
    case "concept": g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = "#090a0a"; g.fill(); g.stroke(); return;
    case "entity": g.moveTo(x, y - r * 1.15); g.lineTo(x + r * 1.15, y); g.lineTo(x, y + r * 1.15); g.lineTo(x - r * 1.15, y); g.closePath(); break;
    case "data": g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7); break;
    case "research": g.moveTo(x, y - r * 1.2); g.lineTo(x + r * 1.1, y + r * 0.8); g.lineTo(x - r * 1.1, y + r * 0.8); g.closePath(); break;
    case "query": g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.lineWidth = 1; g.beginPath(); g.arc(x, y, r + 6, 0, Math.PI * 2); g.stroke(); return;
    default: g.arc(x, y, r, 0, Math.PI * 2);
  }
  g.fill(); if (lw > 0) g.stroke();
}

export default function Knowledge() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [data, setData] = useState<{ nodes: KNode[]; edges: KEdge[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [types, setTypes] = useState<Record<string, boolean>>({ document: true, concept: true, entity: true, data: true, research: true });
  const [rel, setRel] = useState<string>("all");
  const [showInferred, setShowInferred] = useState(false);
  const [pubs, setPubs] = useState(false);
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<KNode[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [collapse, setCollapse] = useState(false);
  const [hist, setHist] = useState<{ list: string[]; i: number }>({ list: [], i: -1 });
  const [detail, setDetail] = useState<any>(null);
  const [edgeDetail, setEdgeDetail] = useState<any>(null);
  const [hover, setHover] = useState<{ n: KNode; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Research | null>(null);
  const [past, setPast] = useState<{ id: string; query: string }[]>([]);
  const [hlSource, setHlSource] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const posRef = useRef(new Map<string, { x: number; y: number }>());
  const vaultRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    Promise.all([j<Overview>("/api/kg/overview"), j<{ nodes: KNode[]; edges: KEdge[] }>(`/api/kg/graph?publications=${pubs}`), j<{ id: string; query: string }[]>("/api/kg/research")])
      .then(([o, g, h]) => { setOv(o); setData(g); setPast(h); }).catch((e: Error) => setErr(e.message));
  }, [pubs]);
  useEffect(load, [load]);

  // visible subgraph after filters / focus
  const view = useMemo(() => {
    if (!data) return null;
    let nodes = data.nodes.filter((n) => types[n.type]);
    let ids = new Set(nodes.map((n) => n.id));
    let edges = data.edges.filter((e) => ids.has(e.src) && ids.has(e.dst) && (rel === "all" || e.rel === rel) && (showInferred || e.basis !== "inferred"));
    if (collapse && focus) {
      const keep = new Set([focus]);
      for (const e of edges) { if (e.src === focus) keep.add(e.dst); if (e.dst === focus) keep.add(e.src); }
      nodes = nodes.filter((n) => keep.has(n.id)); ids = keep;
      edges = edges.filter((e) => keep.has(e.src) && keep.has(e.dst));
    }
    if (res) {
      // research path nodes stay visible whatever the filters
      const extra = res.path.nodes.filter((p) => p.id !== "query" && !ids.has(p.id)).map((p) => data.nodes.find((n) => n.id === p.id)).filter(Boolean) as KNode[];
      nodes = [...nodes, ...extra];
    }
    return { nodes, edges };
  }, [data, types, rel, showInferred, collapse, focus, res]);

  const sel = useRef<{ focus: string | null; hover: string | null; res: Research | null; hlSource: string | null; edge: string | null }>({ focus: null, hover: null, res: null, hlSource: null, edge: null });
  sel.current = { focus, hover: hover?.n.id ?? null, res, hlSource, edge: edgeDetail?.id ?? null };
  const api = useRef<{ center: (id: string) => void; reset: () => void } | null>(null);

  // ------------------------------------------------------------------ force simulation on canvas
  useEffect(() => {
    if (!view || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current, wrap = wrapRef.current;
    const g = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = wrap.clientWidth, H = wrap.clientHeight;
    const size = () => { W = wrap.clientWidth; H = wrap.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`; };
    size();
    const prev = posRef.current;
    const nodes: KNode[] = view.nodes.map((n) => { const p = prev.get(n.id); return { ...n, x: p?.x ?? W / 2 + (Math.random() - 0.5) * 400, y: p?.y ?? H / 2 + (Math.random() - 0.5) * 300 }; });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    let qnode: KNode | null = null;
    if (res) { qnode = { id: "query", type: "query", label: res.query, props: {}, degree: 0, x: W / 2, y: H / 2 }; nodes.push(qnode); byId.set("query", qnode); }
    const links: KEdge[] = view.edges.map((e) => ({ ...e, source: byId.get(e.src)!, target: byId.get(e.dst)! })).filter((e) => e.source && e.target);
    const pathEdges = res ? res.path.edges.filter((e) => byId.has(e.src) && byId.has(e.dst)).map((e) => ({ ...e, source: byId.get(e.src)!, target: byId.get(e.dst)! })) : [];
    const topIds = new Set([...nodes].sort((a, b) => b.degree - a.degree).slice(0, 16).map((n) => n.id));
    const radius = (n: KNode) => n.type === "query" ? 9 : Math.max(2.6, Math.min(13, 2.2 + Math.sqrt(n.degree) * 1.25));
    const sim = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink([...links, ...pathEdges.filter((e) => e.rel === "asks_about")] as any).id((d: any) => d.id).distance((l: any) => l.rel === "asks_about" ? 90 : l.rel === "describes" ? 28 : 85).strength((l: any) => l.rel === "shares_concept" ? 0.03 : 0.25))
      .force("charge", d3.forceManyBody().strength((d: any) => -90 - radius(d) * 16).distanceMax(700))
      .force("center", d3.forceCenter(W / 2, H / 2).strength(0.03))
      .force("collide", d3.forceCollide().radius((d: any) => radius(d) + 3))
      .alphaDecay(0.03);
    if (qnode) { qnode.fx = W / 2; qnode.fy = H / 2; }

    let t = d3.zoomIdentity;
    const zoom = d3.zoom<HTMLCanvasElement, unknown>().scaleExtent([0.15, 6]).on("zoom", (ev) => { t = ev.transform; draw(); });
    const cs = d3.select(canvas);
    cs.call(zoom as any).on("dblclick.zoom", null);
    api.current = {
      center: (id) => { const n = byId.get(id); if (!n) return; const k = Math.max(t.k, 1.4); cs.transition().duration(600).call(zoom.transform as any, d3.zoomIdentity.translate(W / 2 - n.x! * k + (detailOpen() ? -190 : 0), H / 2 - n.y! * k).scale(k)); },
      reset: () => cs.transition().duration(500).call(zoom.transform as any, d3.zoomIdentity),
    };
    const detailOpen = () => !!sel.current.focus || !!sel.current.edge;

    const neighbours = (id: string | null) => {
      const s = new Set<string>(); if (!id) return s;
      for (const e of links) { if (e.src === id) s.add(e.dst); if (e.dst === id) s.add(e.src); }
      return s;
    };
    function draw() {
      const { focus: f, hover: h, res: r, hlSource, edge } = sel.current;
      const nb = neighbours(f ?? h);
      const used = new Set(r ? r.path.nodes.filter((p) => p.used).map((p) => p.id) : []);
      const inPath = new Set(r ? r.path.nodes.map((p) => p.id) : []);
      const hlNode = hlSource && r ? r.sources.find((s) => s.id === hlSource)?.node : null;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      g.save(); g.translate(t.x, t.y); g.scale(t.k, t.k);
      const focusSet = f || h ? new Set([f ?? h!, ...nb]) : null;
      // edges
      for (const e of links) {
        const a = e.source!, b = e.target!;
        let alpha = r ? 0.035 : focusSet ? (focusSet.has(a.id) && focusSet.has(b.id) && (a.id === (f ?? h) || b.id === (f ?? h)) ? 0.75 : 0.03) : e.basis === "inferred" ? 0.06 : 0.12;
        if (edge === e.id) alpha = 1;
        g.strokeStyle = `rgba(167,169,170,${alpha})`; g.lineWidth = (edge === e.id ? 1.6 : 0.6) / Math.sqrt(t.k);
        if (e.basis === "inferred") g.setLineDash([3 / t.k, 3 / t.k]); else g.setLineDash([]);
        g.beginPath(); g.moveTo(a.x!, a.y!); g.lineTo(b.x!, b.y!); g.stroke();
      }
      g.setLineDash([]);
      for (const e of pathEdges) {
        const a = e.source!, b = e.target!;
        g.strokeStyle = e.used ? "rgba(240,240,237,0.85)" : "rgba(167,169,170,0.22)"; g.lineWidth = (e.used ? 1.4 : 0.7) / Math.sqrt(t.k);
        g.beginPath(); g.moveTo(a.x!, a.y!); g.lineTo(b.x!, b.y!); g.stroke();
      }
      // nodes
      for (const n of nodes) {
        const r0 = radius(n);
        let fill = "#a7a9aa", stroke = "#a7a9aa", lw = 1;
        let dim = false;
        if (r) dim = !inPath.has(n.id) && n.id !== "query";
        else if (focusSet) dim = !focusSet.has(n.id);
        if (dim) { fill = "rgba(98,103,106,0.35)"; stroke = "rgba(98,103,106,0.35)"; }
        else if (r && used.has(n.id)) { fill = "#f0f0ed"; stroke = "#f0f0ed"; lw = 1.4; }
        else if (r) { fill = "#62676a"; stroke = "#a7a9aa"; }
        else if (n.type === "document") { fill = "#f0f0ed"; stroke = "#f0f0ed"; }
        if (n.id === f || n.id === h || n.id === hlNode) { fill = "#f0f0ed"; stroke = "#f0f0ed"; lw = 2; }
        if (n.type === "query") { fill = "#f0f0ed"; stroke = "#f0f0ed"; }
        drawNode(g, n, r0, fill, stroke, lw / t.k);
        if (n.id === hlNode) { g.strokeStyle = "#f0f0ed"; g.lineWidth = 1 / t.k; g.beginPath(); g.arc(n.x!, n.y!, r0 + 7, 0, Math.PI * 2); g.stroke(); }
      }
      // labels
      g.textBaseline = "middle";
      for (const n of nodes) {
        const r0 = radius(n);
        const important = n.id === f || n.id === h || n.type === "query" || (r && inPath.has(n.id)) || (focusSet?.has(n.id) && !r) || (!r && !focusSet && (topIds.has(n.id) || (t.k > 1.8 && r0 > 4) || t.k > 2.8));
        if (!important) continue;
        const label = n.type === "document" && n.props?.acronym ? n.props.acronym : n.label.length > 42 ? n.label.slice(0, 40) + "…" : n.label;
        const fs = (n.type === "query" ? 13 : 11) / t.k;
        g.font = `${n.type === "concept" || n.type === "query" ? 500 : 400} ${fs}px ${n.type === "data" ? "'IBM Plex Mono'" : "Inter"}, sans-serif`;
        g.fillStyle = (r && !inPath.has(n.id)) || (focusSet && !focusSet.has(n.id)) ? "rgba(98,103,106,0.6)" : "rgba(240,240,237,0.92)";
        g.fillText(label, n.x! + r0 + 4 / t.k, n.y!);
      }
      g.restore();
    }
    sim.on("tick", () => { for (const n of nodes) prev.set(n.id, { x: n.x!, y: n.y! }); draw(); });

    // pointer: hover, click node, click edge, drag
    const pick = (mx: number, my: number) => {
      const [x, y] = t.invert([mx, my]);
      let best: KNode | null = null, bd = 1e9;
      for (const n of nodes) { const d = Math.hypot(n.x! - x, n.y! - y); if (d < radius(n) + 5 / t.k && d < bd) { bd = d; best = n; } }
      return best;
    };
    const pickEdge = (mx: number, my: number) => {
      const [x, y] = t.invert([mx, my]);
      let best: KEdge | null = null, bd = 6 / t.k;
      for (const e of links) {
        const a = e.source!, b = e.target!; const dx = b.x! - a.x!, dy = b.y! - a.y!; const L2 = dx * dx + dy * dy || 1;
        const u = Math.max(0, Math.min(1, ((x - a.x!) * dx + (y - a.y!) * dy) / L2));
        const d = Math.hypot(a.x! + u * dx - x, a.y! + u * dy - y);
        if (d < bd) { bd = d; best = e; }
      }
      return best;
    };
    let dragging: KNode | null = null, moved = false;
    const onMove = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (dragging) { const [x, y] = t.invert([mx, my]); dragging.fx = x; dragging.fy = y; moved = true; sim.alphaTarget(0.15).restart(); return; }
      const n = pick(mx, my);
      setHover((h) => (n ? (h?.n.id === n.id ? h : { n, x: mx, y: my }) : null));
      canvas.style.cursor = n ? "pointer" : pickEdge(mx, my) ? "help" : "grab";
      draw();
    };
    const onDown = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect(); const n = pick(ev.clientX - r.left, ev.clientY - r.top);
      if (n) { dragging = n; moved = false; ev.stopImmediatePropagation(); }
    };
    const onUp = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect(); const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      if (dragging) {
        const n = dragging; dragging = null; sim.alphaTarget(0);
        if (n.id !== "query") { n.fx = null; n.fy = null; }
        if (!moved && n.id !== "query") openNode(n.id);
        return;
      }
      const e = pickEdge(mx, my); if (e) openEdge(e.id);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointerup", onUp);
    const ro = new ResizeObserver(() => { size(); draw(); }); ro.observe(wrap);
    const raf = setInterval(draw, 120); // re-draw for highlight changes while the simulation sleeps
    return () => { sim.stop(); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerdown", onDown, true); window.removeEventListener("pointerup", onUp); ro.disconnect(); clearInterval(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // ------------------------------------------------------------------ actions
  const openNode = (id: string, push = true) => {
    setFocus(id); setEdgeDetail(null);
    j<any>(`/api/kg/node?id=${encodeURIComponent(id)}`).then(setDetail).catch((e: Error) => setErr(e.message));
    if (push) setHist((h) => { const list = [...h.list.slice(0, h.i + 1), id]; return { list, i: list.length - 1 }; });
    setTimeout(() => api.current?.center(id), 60);
  };
  const openEdge = (id: string) => { j<any>(`/api/kg/edge?id=${encodeURIComponent(id)}`).then((d) => { setEdgeDetail(d); }).catch((e: Error) => setErr(e.message)); };
  const back = () => setHist((h) => { if (h.i <= 0) return h; const i = h.i - 1; openNode(h.list[i], false); return { ...h, i }; });
  const fwd = () => setHist((h) => { if (h.i >= h.list.length - 1) return h; const i = h.i + 1; openNode(h.list[i], false); return { ...h, i }; });
  const close = () => { setFocus(null); setDetail(null); setEdgeDetail(null); setCollapse(false); };
  const resetAll = () => { close(); setRes(null); setHlSource(null); setRel("all"); setTypes({ document: true, concept: true, entity: true, data: true, research: true }); api.current?.reset(); };

  useEffect(() => {
    if (!search.trim()) { setHits([]); return; }
    const h = setTimeout(() => j<KNode[]>(`/api/kg/search?q=${encodeURIComponent(search)}`).then(setHits).catch(() => setHits([])), 160);
    return () => clearTimeout(h);
  }, [search]);

  const ask = async (q?: string) => {
    const text = (q ?? query).trim(); if (text.length < 2) return;
    setBusy(true); setErr(null); close();
    try { const r = await j<Research>("/api/kg/research", { method: "POST", body: JSON.stringify({ query: text }) }); setRes(r); setQuery(text); setPast((p) => [{ id: r.id, query: r.query }, ...p.filter((x) => x.id !== r.id)].slice(0, 30)); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const reopen = async (id: string) => { setBusy(true); try { const r = await j<Research>(`/api/kg/research/${id}`); setRes(r); setQuery(r.query); } finally { setBusy(false); } };

  const upload = async (files: FileList | null, obsidianImport = false) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const payload = { files: await Promise.all([...files].map(async (f) => ({ name: f.name, content_base64: await toB64(f) }))) };
      const out = await j<any[]>(obsidianImport ? "/api/kg/obsidian/import" : "/api/kg/ingest", { method: "POST", body: JSON.stringify(payload) });
      const ok = out.filter((r) => r.status === "created" || r.status === "updated").length;
      const warn = out.flatMap((r) => r.warnings ?? []).concat(out.filter((r) => r.status === "error").map((r) => `${r.file}: ${r.error}`));
      setToast(`${ok} document${ok === 1 ? "" : "s"} indexed${out.some((r) => r.status === "duplicate") ? ", duplicates skipped" : ""}${warn.length ? ` · ${warn.join(" · ")}` : ""}`);
      load();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const syncVault = async () => {
    try { const r = await j<any>("/api/kg/obsidian/sync", { method: "POST", body: JSON.stringify({}) }); setToast(`Vault written: ${r.notes} notes in ${r.path} — open that folder in Obsidian.`); }
    catch (e) { setErr((e as Error).message); }
  };

  const nodeLabel = (id: string) => detail?.labels?.[id]?.label ?? data?.nodes.find((n) => n.id === id)?.label ?? id;
  const groupBy = <T,>(xs: T[], k: (x: T) => string) => xs.reduce<Record<string, T[]>>((a, x) => { (a[k(x)] ||= []).push(x); return a; }, {});

  return (
    <div className="kg">
      <header className="kg-head">
        <div>
          <p className="mono meta">Orbital knowledge engine</p>
          <h1>From documents to connections.</h1>
          <p className="lede">Every NASA PSI investigation, publication, measured quantity and finding — and the documents you add — linked by relationships you can trace back to a passage, a table or a stated link.</p>
        </div>
        {ov && (
          <dl className="kg-counts mono">
            {Object.entries(TYPE_LABEL).map(([k, l]) => <div key={k}><dt>{l}</dt><dd>{ov.nodes[k] ?? 0}</dd></div>)}
            <div><dt>Relationships</dt><dd>{Object.values(ov.edges).reduce((a, b) => a + b, 0)}</dd></div>
          </dl>
        )}
      </header>

      <section className="kg-stage">
        <div className="kg-tools">
          <div className="kg-find">
            <input className="input" placeholder="Find a node — BASS, extinction, Mars…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a node" />
            {hits.length > 0 && (
              <ul className="kg-hits">
                {hits.map((h) => <li key={h.id}><button onClick={() => { setSearch(""); setHits([]); setTypes((t) => ({ ...t, [h.type]: true })); if (h.id.startsWith("pub:")) setPubs(true); openNode(h.id); }}><span>{h.label}</span><span className="mono faint">{h.type}</span></button></li>)}
              </ul>
            )}
          </div>
          <div className="seg" role="group" aria-label="Node types">
            {Object.entries(TYPE_LABEL).map(([k, l]) => <button key={k} aria-pressed={types[k]} onClick={() => setTypes((t) => ({ ...t, [k]: !t[k] }))}><i className={`glyph ${k}`} />{l}</button>)}
          </div>
          <select value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Relationship">
            <option value="all">All relationships</option>
            {ov && Object.keys(ov.relations).map((r) => <option key={r} value={r}>{REL_LABEL(r)} ({ov.edges[r] ?? 0})</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={showInferred} onChange={(e) => setShowInferred(e.target.checked)} />Inferred links</label>
          <label className="check"><input type="checkbox" checked={pubs} onChange={(e) => setPubs(e.target.checked)} />Publications</label>
          <span className="grow" />
          <div className="seg" role="group" aria-label="History"><button disabled={hist.i <= 0} onClick={back} title="Previous node">← Back</button><button disabled={hist.i >= hist.list.length - 1} onClick={fwd} title="Next node">Forward →</button><button onClick={resetAll}>Reset</button></div>
        </div>

        <div className="kg-canvas" ref={wrapRef}>
          <canvas ref={canvasRef} />
          {!data && !err && <p className="loading kg-loading">Loading the graph…</p>}
          {hover && !detail && (
            <div className="kg-tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
              <span className="mono meta">{hover.n.type}{hover.n.props?.kind ? ` · ${hover.n.props.kind}` : ""} · {hover.n.degree} links</span>
              <strong>{hover.n.label}</strong>
              {hover.n.description && <p>{hover.n.description.slice(0, 180)}{hover.n.description.length > 180 ? "…" : ""}</p>}
            </div>
          )}
          <div className="kg-legend mono">
            <span><i className="glyph document" />document</span><span><i className="glyph concept" />concept</span><span><i className="glyph entity" />entity</span><span><i className="glyph data" />data</span><span><i className="glyph research" />finding</span><span><i className="dash" />inferred</span>
            <span className="faint">scroll to zoom · drag to pan or move a node · click a link to see why it exists</span>
          </div>

          {(detail || edgeDetail) && (
            <aside className="kg-inspector" aria-live="polite">
              <button className="tlink close" onClick={close}>Close</button>
              {edgeDetail ? (
                <EdgeView e={edgeDetail} open={openNode} />
              ) : detail && (
                <NodeView d={detail} nodeLabel={nodeLabel} open={openNode} openEdge={openEdge} groupBy={groupBy} collapse={collapse} setCollapse={setCollapse} />
              )}
            </aside>
          )}
        </div>

        <form className="kg-composer" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <span className="mono meta">Research</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask the knowledge base — e.g. What do we know about flame spread in oxygen-enriched cabins with airflow?" aria-label="Research question" />
          <button className="tlink strong" type="submit" disabled={busy}>{busy ? "Searching…" : "Research"}</button>
        </form>
      </section>

      {err && <p className="error" style={{ margin: "16px var(--pad)" }}>{err}</p>}
      {toast && <p className="kg-toast mono" onClick={() => setToast(null)}>{toast}</p>}

      {res && (
        <section className="kg-answer">
          <div className="ka-main">
            <p className="mono meta">Research {res.id} · {res.mode === "llm" ? `phrased by ${res.model} from cited sources` : res.mode === "no_evidence" ? "no evidence found" : "extractive — quoted from sources"}</p>
            <h2>{res.query}</h2>
            <p className="ka-understood small">
              Understood as {[...Object.keys(res.understood.concepts).map((c) => c.replace(/-/g, " ")), ...Object.keys(res.understood.entities)].join(", ") || "free text"}
              {res.understood.values.length ? ` · values treated as search conditions: ${res.understood.values.join(", ")}` : ""}
            </p>
            {res.warnings.map((w) => <p key={w} className="small muted">{w}</p>)}
            <MiniMarkdown text={res.answer} onCite={(id) => { setHlSource(id); const s = res.sources.find((x) => x.id === id); if (s?.node) api.current?.center(s.node); document.getElementById(`src-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} />
          </div>
          <div className="ka-sources">
            <h3 className="col-h">Sources and evidence path</h3>
            <p className="faint small">Bright in the graph: used in the answer. Grey: related documents that were found but not cited.</p>
            <ol>
              {res.sources.map((s) => (
                <li key={s.id} id={`src-${s.id}`} className={`${s.used ? "used" : ""} ${hlSource === s.id ? "hl" : ""}`}>
                  <button className="src-h" onClick={() => { setHlSource(s.id); if (s.node) openNode(s.node); }}>
                    <span className="mono">{s.id}</span><span>{s.title}</span><span className="mono faint">{s.kind}{s.used ? " · cited" : ""}</span>
                  </button>
                  <p>{s.text.length > 420 ? s.text.slice(0, 418) + "…" : s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="kg-foot">
        <div>
          <h3 className="col-h">Add documents</h3>
          <p className="small muted">PDF, DOCX, XLSX, CSV, Markdown, TXT, HTML or JSON. Text, sections, tables and values with units are extracted; originals are kept; each passage stays traceable. Re-uploading a changed file creates a new version.</p>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.docx,.xlsx,.csv,.tsv,.md,.markdown,.txt,.html,.htm,.json" onChange={(e) => upload(e.target.files)} />
          <button className="tlink strong" onClick={() => fileRef.current?.click()} disabled={busy}>Upload documents</button>
        </div>
        <div>
          <h3 className="col-h">Obsidian</h3>
          <p className="small muted">An Obsidian vault is a folder of Markdown notes. Export this graph as notes with [[wikilinks]] and typed relationship sections, or write it straight into a local folder and open it in Obsidian. Import your own notes: frontmatter, tags and wikilinks are kept.</p>
          <input ref={vaultRef} type="file" multiple hidden accept=".md,.zip" onChange={(e) => upload(e.target.files, true)} />
          <div className="row tight">
            <a className="tlink" href="/api/kg/obsidian/export">Export vault (.zip)</a>
            <button className="tlink" onClick={syncVault}>Write vault to ./vault</button>
            <button className="tlink" onClick={() => vaultRef.current?.click()}>Import notes</button>
          </div>
        </div>
        <div>
          <h3 className="col-h">Previous research</h3>
          {past.length === 0 ? <p className="small faint">None yet. Every research keeps the sources and the graph it used, so it can be reopened exactly.</p> : (
            <ul className="kg-past">{past.slice(0, 8).map((p) => <li key={p.id}><button onClick={() => reopen(p.id)}>{p.query}</button></li>)}</ul>
          )}
        </div>
      </section>
    </div>
  );
}

function NodeView({ d, nodeLabel, open, openEdge, groupBy, collapse, setCollapse }: { d: any; nodeLabel: (id: string) => string; open: (id: string) => void; openEdge: (id: string) => void; groupBy: any; collapse: boolean; setCollapse: (b: boolean) => void }) {
  const n = d.node; const p = n.props ?? {};
  const outBy = groupBy(d.out, (e: any) => e.rel) as Record<string, any[]>;
  const inBy = groupBy(d.in, (e: any) => e.rel) as Record<string, any[]>;
  const Rel = ({ title, list, dir }: { title: string; list: any[]; dir: "out" | "in" }) => (
    <div className="ki-rel">
      <h4>{title} <span className="faint mono">{list.length}</span></h4>
      <ul>
        {list.slice(0, 40).map((e: any) => {
          const other = dir === "out" ? e.dst : e.src; const ev = e.evidence?.[0] ?? {};
          return (
            <li key={e.id}>
              <button onClick={() => open(other)}>{nodeLabel(other)}</button>
              <button className="why mono" onClick={() => openEdge(e.id)} title="Why does this link exist?">{BASIS_LABEL[e.basis] ?? e.basis}{ev.tests ? ` · ${ev.tests} values ${ev.min}–${ev.max} ${ev.unit ?? ""}` : ""}</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <div className="ki">
      <p className="mono meta">{n.type}{p.kind ? ` · ${p.kind}` : ""}{p.accession ? ` · ${p.accession}` : ""}</p>
      <h2>{n.label}</h2>
      {n.description && <p className="muted">{n.description}</p>}
      <dl className="ki-meta">
        {p.doi && <div><dt>DOI</dt><dd><a href={`https://doi.org/${p.doi}`} target="_blank" rel="noreferrer">{p.doi}</a></dd></div>}
        {p.platform && <div><dt>Platform</dt><dd>{p.platform}</dd></div>}
        {p.hardware && <div><dt>Hardware</dt><dd>{p.hardware}</dd></div>}
        {p.dates?.[0] && <div><dt>Dates</dt><dd>{p.dates.filter(Boolean).join(" → ")}</dd></div>}
        {p.authors && <div><dt>Authors</dt><dd>{p.authors}</dd></div>}
        {p.publications && <div><dt>Publications</dt><dd>{p.publications}</dd></div>}
        {p.unit && <div><dt>Unit</dt><dd>{p.unit}</dd></div>}
        {p.evidence_kind && <div><dt>Evidence</dt><dd>{p.evidence_kind.replace(/_/g, " ")}</dd></div>}
        {p.filename && <div><dt>File</dt><dd><a href={`/api/kg/documents/${p.doc_id}/file`}>{p.filename}</a> · v{p.version}</dd></div>}
        {p.url && <div><dt>Source</dt><dd><a href={p.url} target="_blank" rel="noreferrer">PSI record</a></dd></div>}
      </dl>
      <div className="row tight"><label className="check"><input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} />Show only this node and its neighbours</label></div>
      {Object.entries(outBy).map(([r, l]) => <Rel key={`o${r}`} title={REL_LABEL(r)} list={l} dir="out" />)}
      {Object.entries(inBy).map(([r, l]) => <Rel key={`i${r}`} title={`${REL_LABEL(r)} — incoming`} list={l} dir="in" />)}
      {d.document?.values?.length > 0 && (
        <div className="ki-rel"><h4>Values extracted, as written <span className="faint mono">{d.document.values.length}</span></h4>
          <ul>{d.document.values.slice(0, 20).map((v: any, i: number) => <li key={i} className="small"><span className="mono">{v.raw}</span> <span className="faint">— {v.locator}: “{v.context.slice(0, 110)}”</span></li>)}</ul></div>
      )}
      {d.document?.passages?.length > 0 && (
        <div className="ki-rel"><h4>Content <span className="faint mono">{d.document.passages.length} passages</span></h4>
          {d.document.passages.slice(0, 24).map((c: any) => <div key={c.id} className="ki-pass"><span className="mono faint">{c.section}</span><p>{c.text}</p></div>)}</div>
      )}
    </div>
  );
}

function EdgeView({ e, open }: { e: any; open: (id: string) => void }): ReactNode {
  return (
    <div className="ki">
      <p className="mono meta">relationship · {e.rel.replace(/_/g, " ")} · basis: {BASIS_LABEL[e.basis] ?? e.basis}</p>
      <h2><button className="inline-link" onClick={() => open(e.src)}>{e.src_node?.label}</button> <span className="faint">→ {e.rel.replace(/_/g, " ")} →</span> <button className="inline-link" onClick={() => open(e.dst)}>{e.dst_node?.label}</button></h2>
      <p className="muted">{e.definition}</p>
      {e.basis === "inferred" && <p className="small">This link is <b>inferred</b> by FlameAtlas, not stated in a source.</p>}
      <div className="ki-rel">
        <h4>Evidence <span className="faint mono">{e.evidence.length}</span></h4>
        {e.evidence.length === 0 && <p className="small faint">Structural link from PSI metadata.</p>}
        {e.evidence.map((ev: any, i: number) => (
          <div key={i} className="ki-pass">
            <span className="mono faint">{[ev.section, ev.field, ev.source, ev.link].filter(Boolean).join(" · ")}</span>
            {ev.quote && <p>“{ev.quote}”</p>}
            {ev.tests != null && <p className="mono">{ev.tests} values · {ev.min} – {ev.max} {ev.unit ?? ""}</p>}
            {ev.tests_inside_envelope != null && <p className="mono">{ev.tests_inside_envelope} tests inside the envelope</p>}
            {ev.shared && <p>Shared concepts: {ev.shared.join(", ")}</p>}
            {ev.values != null && <p className="mono">{ev.values} values · {ev.min} – {ev.max}{ev.examples ? ` · e.g. ${ev.examples.map((x: any) => x.raw).join(", ")}` : ""}</p>}
            {ev.passage && <details><summary className="small">Full passage</summary><p className="small muted">{ev.passage.text}</p></details>}
          </div>
        ))}
      </div>
    </div>
  );
}
