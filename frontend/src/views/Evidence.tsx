/**
 * Evidence — one page, built around an Obsidian-style graph.
 *  - the graph: every investigation, concept, facility and finding as a bead; drag one and its links follow
 *  - one question bar: free text or a scenario → ranked investigations, a sourced answer, and the path lit in the graph
 *  - the 11 conclusions underneath; clicking one lights its sources
 *  - the coverage map appears as part of the answer when the question is about a habitat or about what is missing
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { api } from "../api";
import { MiniMarkdown } from "../components/ui";
import { useApp } from "../state";
import type { CoverageResponse, Insight, RankResponse } from "../types";

type NodeType = "document" | "concept" | "entity" | "data" | "research" | "query";
interface KNode { id: string; type: NodeType; label: string; description?: string; props: Record<string, any>; degree: number; x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null }
interface KEdge { id: string; src: string; dst: string; rel: string; basis: string; weight: number; n_evidence: number; quote?: string | null; source?: KNode; target?: KNode }
interface Research {
  id: string; query: string; answer: string; mode: string; warnings: string[];
  sources: { id: string; kind: string; node: string | null; title: string; text: string; used: boolean }[];
  path: { nodes: { id: string; used?: boolean }[]; edges: { src: string; dst: string; rel: string; used: boolean }[] };
}
const j = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) { let d = r.statusText; try { d = (await r.json()).detail; } catch { /* keep */ } throw new Error(`${r.status} ${d}`); }
  return r.json();
};

const TYPES: { id: Exclude<NodeType, "query">; label: string; one: string; color: string; help: string }[] = [
  { id: "document", label: "Investigations", one: "Investigation", color: "#e8e6df", help: "NASA experiments with data in PSI" },
  { id: "research", label: "Conclusions", one: "Conclusion", color: "#ff8a3d", help: "What the data says for fire safety" },
  { id: "concept", label: "Concepts", one: "Concept", color: "#a78bfa", help: "Phenomena: extinction, flame spread, soot…" },
  { id: "entity", label: "Places & hardware", one: "Place / hardware", color: "#4cc2b0", help: "ISS, Moon, Mars, racks, vehicles" },
  { id: "data", label: "Measured quantities", one: "Measured quantity", color: "#6f9bd1", help: "O₂, pressure, burning rate…" },
];
const COLOR: Record<string, string> = { ...Object.fromEntries(TYPES.map((t) => [t.id, t.color])), query: "#ffffff" };
const ACCENT = "#ffb066";
const REL: Record<string, string> = {
  mentions: "mentions", measures: "measures", supports: "supports", contradicts: "contradicts", extends: "extends", references: "cites",
  depends_on: "depends on", contains_related_data: "shares data with", describes: "describes", shares_concept: "shares a concept with",
};
const NEED: Record<string, string> = { materials: "Materials & flame spread", extinction: "Extinction & suppression", detection: "Smoke detection" };
const KIND: Record<string, string> = { psi_text: "Stated by NASA", computed_from_table: "Computed from test tables", hypothesis: "Hypothesis to test" };
const ASKS = ["Does turning off the fans put out a fire?", "What is missing for the Moon?", "Which materials burn at 34 % oxygen?", "How fast does a detector see smoke in microgravity?"];
const HAB_WORDS: [RegExp, string][] = [[/moon|lunar|artemis/i, "lunar_base"], [/mars|martian/i, "mars_habitat"], [/suit|eva\b/i, "eva_suit"], [/34 ?%|8\.2 ?psi/i, "exploration_34"], [/26\.5|10\.2 ?psi/i, "exploration_26"], [/iss|station/i, "iss"]];
const short = (n: KNode) => (n.type === "document" ? (n.props.acronym as string) || n.label.split(" — ")[0] : n.label);

// ------------------------------------------------------------------ small, readable charts
function RankBars({ rank, onOpen, onHover }: { rank: RankResponse; onOpen: (acc: string) => void; onHover: (acc: string | null) => void }) {
  const top = rank.results.slice(0, 6);
  return (
    <div className="ev-rank">
      {top.map((r, i) => (
        <button key={r.accession} onClick={() => onOpen(r.accession)} onMouseEnter={() => onHover(r.accession)} onMouseLeave={() => onHover(null)} title={r.why.join(" ")}>
          <span className="n mono">{i + 1}</span>
          <span className="a">{r.acronym ?? r.accession}</span>
          <span className="bar"><i style={{ width: `${Math.round(r.score * 100)}%` }} /></span>
          <span className="s mono">{Math.round(r.score * 100)}</span>
          <span className="w">{r.why[0]}</span>
        </button>
      ))}
      <p className="ev-note">Score out of 100 = how well the investigation matches the question and how much test data it holds. Click one to open its data.</p>
    </div>
  );
}

function CoverageChart({ cov, focus }: { cov: CoverageResponse; focus: string }) {
  const W = 380, H = 270, m = { l: 44, r: 10, t: 12, b: 36 };
  const x = (v: number) => m.l + ((v - 10) / 32) * (W - m.l - m.r), y = (v: number) => H - m.b - ((v - 20) / 100) * (H - m.t - m.b);
  const gap = cov.gaps.find((g) => g.habitat.id === focus) ?? cov.gaps[0];
  const h = gap.habitat;
  const inside = (p: { o2_pct: number; pressure_kpa: number }) => p.o2_pct >= h.o2_pct_min && p.o2_pct <= h.o2_pct_max && p.pressure_kpa >= h.pressure_kpa_min && p.pressure_kpa <= h.pressure_kpa_max;
  const pts = cov.points.filter((p) => !p.oxidizer_stream && p.o2_pct <= 42 && p.pressure_kpa <= 120 && p.pressure_kpa >= 20);
  const solidIn = Object.entries(gap.by_fuel_phase).find(([k]) => k === "solid")?.[1] ?? 0;
  const maxN = Math.max(...cov.gaps.map((g) => g.n_inside), 1);
  const offChart = h.o2_pct_min > 42;
  return (
    <div className="ev-cov">
      <h4>Where NASA has burned things, and where crews will live</h4>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Tests by oxygen and pressure">
        {[20, 40, 60, 80, 100, 120].map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} stroke="rgba(240,240,237,.08)" /><text x={m.l - 6} y={y(v) + 3} textAnchor="end" className="ax">{v}</text></g>)}
        {[10, 21, 30, 40].map((v) => <text key={v} x={x(v)} y={H - m.b + 14} textAnchor="middle" className="ax">{v} %</text>)}
        <text x={(m.l + W - m.r) / 2} y={H - 2} textAnchor="middle" className="axl">oxygen in the air</text>
        <text x={10} y={(H - m.b + m.t) / 2} textAnchor="middle" className="axl" transform={`rotate(-90 10 ${(H - m.b + m.t) / 2})`}>pressure (kPa)</text>
        {!offChart && <>
          <rect x={x(h.o2_pct_min)} y={y(h.pressure_kpa_max)} width={Math.max(6, x(h.o2_pct_max) - x(h.o2_pct_min))} height={Math.max(6, y(h.pressure_kpa_min) - y(h.pressure_kpa_max))} fill="rgba(255,176,102,.1)" stroke={ACCENT} strokeWidth={1.4} />
          <text x={x(h.o2_pct_min)} y={y(h.pressure_kpa_min) + 14} className="box">{h.name.split(" /")[0]}</text>
        </>}
        {pts.map((p) => <circle key={p.test_id} cx={x(p.o2_pct)} cy={y(p.pressure_kpa)} r={inside(p) ? 3.4 : 2.4} fill={inside(p) ? ACCENT : "#c9c8c2"} opacity={inside(p) ? 1 : 0.5} />)}
        <rect x={x(20.5)} y={y(103)} width={x(21.5) - x(20.5)} height={y(97) - y(103)} fill="none" stroke="rgba(240,240,237,.5)" strokeDasharray="3 2" />
        <text x={x(20.5)} y={y(103) - 6} className="ax" fill="#f0f0ed">ISS today</text>
      </svg>
      <p className="ev-note">Each dot is one NASA test (orange = inside the highlighted air). The box is the air planned for <b>{h.name}</b>: {h.o2_pct_min}–{h.o2_pct_max} % O₂ at {h.pressure_kpa_min}–{h.pressure_kpa_max} kPa.</p>
      <div className="ev-miss">
        <div><b className="mono">{gap.n_inside}</b><span>tests in this air</span></div>
        <div className={solidIn ? "" : "zero"}><b className="mono">{solidIn}</b><span>on solid materials</span></div>
        <div className="zero"><b className="mono">0</b><span>at {h.gravity === "microgravity" ? "partial" : h.gravity} gravity</span></div>
      </div>
      <h4>Tests inside each planned atmosphere</h4>
      <div className="ev-hbars">
        {cov.gaps.map((g) => (
          <div key={g.habitat.id} className={g.habitat.id === focus ? "on" : ""}>
            <span>{g.habitat.name.replace("Exploration atmosphere ", "Exploration ")}</span>
            <span className="bar"><i style={{ width: `${(g.n_inside / maxN) * 100}%` }} /></span>
            <b className="mono">{g.n_inside}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ page
export default function Evidence() {
  const { openDrawer, byAcc } = useApp();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<{ nodes: KNode[]; edges: KEdge[] } | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [cov, setCov] = useState<CoverageResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<Record<string, boolean>>({ document: true, research: true, concept: true, entity: true, data: false });
  const [focus, setFocus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Research | null>(null);
  const [rank, setRank] = useState<RankResponse | null>(null);
  const [covFocus, setCovFocus] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);        // node lit from the panel (hovering a source / ranking row)
  const [tip, setTip] = useState<{ n: KNode; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    j<{ nodes: KNode[]; edges: KEdge[] }>("/api/kg/graph").then(setData).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(() => { load(); api.insights().then(setInsights).catch(() => {}); api.coverage().then(setCov).catch(() => {}); }, [load]);

  // a selected bead whose type is switched off still has to be drawn
  const hiddenFocus = useMemo(() => { const n = focus && data ? data.nodes.find((q) => q.id === focus) : null; return n && !show[n.type] ? n.id : null; }, [focus, data, show]);
  const view = useMemo(() => {
    if (!data) return null;
    const forced = new Set<string>(res ? res.path.nodes.map((p) => p.id) : []); if (hiddenFocus) forced.add(hiddenFocus);
    const nodes = data.nodes.filter((n) => show[n.type] || forced.has(n.id));
    const ids = new Set(nodes.map((n) => n.id));
    const edges = data.edges.filter((e) => ids.has(e.src) && ids.has(e.dst) && e.basis !== "inferred");
    return { nodes, edges };
  }, [data, show, res, hiddenFocus]);

  const sel = useRef({ focus, res, peek }); sel.current = { focus, res, peek };
  const ctl = useRef<{ fit: (ids: string[] | null) => void; kick: () => void; redraw: () => void } | null>(null);
  const posRef = useRef(new Map<string, { x: number; y: number }>());

  // ---------------------------------------------------------------- graph: d3-force on canvas, drag + zoom + hover
  useEffect(() => {
    if (!view || !canvasRef.current || !wrapRef.current) return;
    const canvas = canvasRef.current, wrap = wrapRef.current, g = canvas.getContext("2d")!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = wrap.clientWidth, H = wrap.clientHeight;
    const size = () => { W = wrap.clientWidth; H = wrap.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = `${W}px`; canvas.style.height = `${H}px`; };
    size();
    const prev = posRef.current;
    const nodes: KNode[] = view.nodes.map((n) => { const p = prev.get(n.id); const a = Math.random() * 6.28, r = 60 + Math.random() * 260; return { ...n, x: p?.x ?? Math.cos(a) * r, y: p?.y ?? Math.sin(a) * r }; });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links: KEdge[] = view.edges.map((e) => ({ ...e, source: byId.get(e.src)!, target: byId.get(e.dst)! }));
    const r0 = sel.current.res;
    let qnode: KNode | null = null; const qlinks: { source: KNode; target: KNode }[] = [];
    if (r0) {
      qnode = { id: "query", type: "query", label: r0.query, props: {}, degree: 0, x: prev.get("query")?.x ?? 0, y: prev.get("query")?.y ?? 0 };
      nodes.push(qnode); byId.set("query", qnode);
      for (const p of r0.path.nodes) if (p.used && p.id !== "query" && byId.has(p.id)) qlinks.push({ source: qnode, target: byId.get(p.id)! });
    }
    const adj = new Map<string, Set<string>>();
    const link2 = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a); };
    links.forEach((e) => link2(e.src, e.dst)); qlinks.forEach((e) => link2("query", e.target.id));
    const radius = (n: KNode) => n.type === "query" ? 11 : n.type === "research" ? 7.5 : Math.max(3.2, Math.min(15, 3 + Math.sqrt(n.degree) * 1.35));

    const sim = d3.forceSimulation(nodes as any)
      .force("link", d3.forceLink([...links, ...qlinks] as any).distance((l: any) => (l.source.type === "query" ? 110 : 70)).strength((l: any) => (l.source.type === "query" ? 0.35 : l.rel === "mentions" ? 0.05 : 0.3)))
      .force("charge", d3.forceManyBody().strength((d: any) => -130 - radius(d) * 22).distanceMax(600))
      .force("x", d3.forceX(0).strength(0.045)).force("y", d3.forceY(0).strength(0.06))
      .force("collide", d3.forceCollide().radius((d: any) => radius(d) + 5).strength(0.9))
      .velocityDecay(0.3).alphaDecay(0.018).alpha(prev.size ? 0.4 : 1);

    let t = d3.zoomIdentity.translate(W / 2, H / 2 + 20).scale(0.95);
    let hover: KNode | null = null, dragging: KNode | null = null, moved = false;
    const find = (px: number, py: number) => {
      const [x, y] = t.invert([px, py]); let best: KNode | null = null, bd = 1e9;
      for (const n of nodes) { const d = Math.hypot(n.x! - x, n.y! - y) - radius(n); if (d < 8 / t.k && d < bd) { bd = d; best = n; } }
      return best;
    };
    const zoom = d3.zoom<HTMLCanvasElement, unknown>().scaleExtent([0.25, 5]).on("zoom", (ev) => { t = ev.transform; draw(); });
    const drag = d3.drag<HTMLCanvasElement, unknown>()
      .subject((ev) => { const n = find(ev.x, ev.y); return n ? { x: t.applyX(n.x!), y: t.applyY(n.y!), n } : (null as any); })
      .on("start", (ev) => { dragging = ev.subject.n; moved = false; sim.alphaTarget(0.3).restart(); dragging!.fx = dragging!.x; dragging!.fy = dragging!.y; canvas.style.cursor = "grabbing"; })
      .on("drag", (ev) => { moved = moved || Math.hypot(ev.dx, ev.dy) > 0.5; const [x, y] = t.invert([ev.x, ev.y]); dragging!.fx = x; dragging!.fy = y; setTip(null); })
      .on("end", (ev) => {
        const n = dragging!; dragging = null; sim.alphaTarget(0); canvas.style.cursor = "grab";
        if (n.type !== "query") { n.fx = null; n.fy = null; }
        if (!moved || Math.hypot(ev.x - ev.subject.x, ev.y - ev.subject.y) < 4) { if (n.type !== "query") setFocus((f) => (f === n.id ? null : n.id)); }
      });
    const cs = d3.select(canvas);
    cs.call(drag as any).call(zoom as any).call(zoom.transform as any, t).on("dblclick.zoom", null);
    const onMove = (ev: PointerEvent) => {
      if (dragging) return; const b = canvas.getBoundingClientRect(); const n = find(ev.clientX - b.left, ev.clientY - b.top);
      if (n !== hover) { hover = n; canvas.style.cursor = n ? "pointer" : "grab"; draw(); }
      setTip(n && n.type !== "query" ? { n, x: ev.clientX - b.left, y: ev.clientY - b.top } : null);
    };
    const onLeave = () => { hover = null; setTip(null); draw(); };
    const onBg = (ev: MouseEvent) => { const b = canvas.getBoundingClientRect(); if (!find(ev.clientX - b.left, ev.clientY - b.top)) setFocus(null); };
    canvas.addEventListener("pointermove", onMove); canvas.addEventListener("pointerleave", onLeave); canvas.addEventListener("click", onBg);

    function lit(): Set<string> | null {
      const { focus: f, res: r, peek: pk } = sel.current;
      const centre = dragging?.id ?? hover?.id ?? pk ?? f;
      if (centre && byId.has(centre)) return new Set([centre, ...(adj.get(centre) ?? [])]);
      if (r) return new Set(["query", ...r.path.nodes.filter((p) => p.used).map((p) => p.id)]);
      return null;
    }
    function draw() {
      const { focus: f, res: r, peek: pk } = sel.current;
      const on = lit(); const centre = dragging?.id ?? hover?.id ?? pk ?? f ?? null;
      const answer = new Set(r ? r.path.nodes.filter((p) => p.used).map((p) => p.id) : []);
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      g.save(); g.translate(t.x, t.y); g.scale(t.k, t.k);
      // links
      g.lineWidth = 0.7 / t.k;
      for (const e of links) {
        const a = e.source!, b = e.target!; const hot = on ? (centre ? (a.id === centre || b.id === centre) : on.has(a.id) && on.has(b.id)) : false;
        g.strokeStyle = hot ? "rgba(255,176,102,.75)" : on ? "rgba(240,240,237,.035)" : "rgba(240,240,237,.11)";
        g.lineWidth = (hot ? 1.3 : 0.7) / t.k;
        g.beginPath(); g.moveTo(a.x!, a.y!); g.lineTo(b.x!, b.y!); g.stroke();
      }
      if (qnode) { g.setLineDash([4 / t.k, 4 / t.k]); g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 1 / t.k; for (const e of qlinks) { g.beginPath(); g.moveTo(e.source.x!, e.source.y!); g.lineTo(e.target.x!, e.target.y!); g.stroke(); } g.setLineDash([]); }
      // beads
      for (const n of nodes) {
        const rr = radius(n), isOn = !on || on.has(n.id), c = COLOR[n.type];
        g.globalAlpha = isOn ? 1 : 0.16;
        if (isOn && (answer.has(n.id) || n.id === centre || n.type === "query")) { g.beginPath(); g.arc(n.x!, n.y!, rr + 5 / t.k + 2, 0, 6.2832); g.fillStyle = n.type === "query" ? "rgba(255,255,255,.16)" : "rgba(255,176,102,.22)"; g.fill(); }
        g.beginPath(); g.arc(n.x!, n.y!, rr, 0, 6.2832); g.fillStyle = c; g.fill();
        if (n.id === f) { g.lineWidth = 2 / t.k; g.strokeStyle = "#fff"; g.stroke(); }
      }
      // labels: always for lit beads, otherwise fade in with zoom (as in Obsidian)
      g.textAlign = "center"; g.textBaseline = "top";
      for (const n of nodes) {
        const isOn = !on || on.has(n.id); const rr = radius(n);
        const base = n.type === "document" || n.type === "research" || n.type === "query" ? 0.75 : 1.5;
        let a = on ? (on.has(n.id) ? 1 : 0) : Math.max(0, Math.min(1, (t.k - base) / 0.35));
        if (!on && n.type === "document" && n.degree > 30) a = Math.max(a, 0.85);
        if (a <= 0.02 || !isOn) continue;
        const fs = (n.type === "query" ? 13 : 11.5) / Math.max(0.8, Math.min(t.k, 1.6));
        g.font = `${n.id === centre || n.type === "query" ? 600 : 400} ${fs}px Inter, system-ui, sans-serif`;
        let txt = short(n); const cap = on ? 44 : 22; if (txt.length > cap) txt = txt.slice(0, cap - 2) + "…";
        g.globalAlpha = a; g.lineWidth = 3 / t.k; g.strokeStyle = "rgba(9,10,10,.9)"; g.strokeText(txt, n.x!, n.y! + rr + 3 / t.k); g.fillStyle = n.type === "query" ? "#fff" : "#dcdad4"; g.fillText(txt, n.x!, n.y! + rr + 3 / t.k);
      }
      g.globalAlpha = 1; g.restore();
    }
    sim.on("tick", () => { for (const n of nodes) prev.set(n.id, { x: n.x!, y: n.y! }); draw(); });
    const fit = (ids: string[] | null) => {
      const ns = ids ? nodes.filter((n) => ids.includes(n.id)) : nodes; if (!ns.length) return;
      const xs = ns.map((n) => n.x!), ys = ns.map((n) => n.y!); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const panel = W > 900 && (sel.current.focus || sel.current.res) ? 440 : 0; const k = Math.max(0.35, Math.min(1.25, 0.8 * Math.min((W - panel) / Math.max(60, x1 - x0), H / Math.max(60, y1 - y0))));
      cs.transition().duration(650).call(zoom.transform as any, d3.zoomIdentity.translate((W - panel) / 2 - ((x0 + x1) / 2) * k, H / 2 - ((y0 + y1) / 2) * k).scale(k));
    };
    ctl.current = { fit, kick: () => sim.alpha(0.5).restart(), redraw: draw };
    (window as unknown as { __ev?: unknown }).__ev = { screen: (id: string) => { const n = byId.get(id); return n ? [t.applyX(n.x!), t.applyY(n.y!)] : null; } };
    const ro = new ResizeObserver(() => { size(); draw(); }); ro.observe(wrap);
    const fitT = window.setTimeout(() => fit(r0 ? ["query", ...r0.path.nodes.filter((p) => p.used).map((p) => p.id)] : null), r0 ? 900 : 1400);
    return () => { window.clearTimeout(fitT); sim.stop(); ro.disconnect(); cs.on(".zoom", null).on(".drag", null); canvas.removeEventListener("pointermove", onMove); canvas.removeEventListener("pointerleave", onLeave); canvas.removeEventListener("click", onBg); };
  }, [view]);
  useEffect(() => { ctl.current?.redraw(); }, [focus, peek, res]);

  // ---------------------------------------------------------------- ask
  const ask = async (q: string) => {
    const text = q.trim(); if (text.length < 2 || busy) return;
    setQuery(text); setBusy(true); setErr(null); setFocus(null);
    try {
      const [r, rk] = await Promise.all([
        j<Research>("/api/kg/research", { method: "POST", body: JSON.stringify({ query: text }) }),
        api.rank({ query: text, include_ground_studies: true }),
      ]);
      const hab = HAB_WORDS.find(([re]) => re.test(text))?.[1] ?? null;
      setCovFocus(/missing|gap|coverage|lack|enough|not (yet )?tested|what.*(need|know)/i.test(text) || (hab && hab !== "iss") ? hab ?? "lunar_base" : null);
      setRes(r); setRank(rk);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const clear = () => { setRes(null); setRank(null); setCovFocus(null); setQuery(""); setFocus(null); window.setTimeout(() => ctl.current?.fit(null), 500); };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const payload = { files: await Promise.all([...files].map(async (f) => ({ name: f.name, content_base64: await new Promise<string>((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(",")[1]); fr.onerror = no; fr.readAsDataURL(f); }) }))) };
      const out = await j<any[]>("/api/kg/ingest", { method: "POST", body: JSON.stringify(payload) });
      setToast(`${out.length} document${out.length > 1 ? "s" : ""} added to the graph`); load();
    } catch (e) { setToast((e as Error).message); }
    window.setTimeout(() => setToast(null), 5000);
  };

  // ---------------------------------------------------------------- panel content
  const node = focus && data ? data.nodes.find((n) => n.id === focus) ?? null : null;
  const insight = node?.type === "research" ? insights.find((i) => `research:${i.id}` === node.id) ?? null : null;
  const neighbours = useMemo(() => {
    if (!node || !data) return [];
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const out: { n: KNode; rel: string; quote?: string | null; dir: "out" | "in" }[] = [];
    for (const e of data.edges) {
      if (e.basis === "inferred") continue;
      if (e.src === node.id && byId.has(e.dst)) out.push({ n: byId.get(e.dst)!, rel: e.rel, quote: e.quote, dir: "out" });
      else if (e.dst === node.id && byId.has(e.src)) out.push({ n: byId.get(e.src)!, rel: e.rel, quote: e.quote, dir: "in" });
    }
    const order = ["research", "document", "concept", "entity", "data"];
    return out.sort((a, b) => order.indexOf(a.n.type) - order.indexOf(b.n.type) || b.n.degree - a.n.degree);
  }, [node, data]);
  const typeOf = (id: string) => TYPES.find((t) => t.id === id)!;
  const counts = useMemo(() => Object.fromEntries(TYPES.map((t) => [t.id, data?.nodes.filter((n) => n.type === t.id).length ?? 0])), [data]);
  const pick = (id: string) => { setFocus(id); window.scrollTo({ top: 0, behavior: "smooth" }); window.setTimeout(() => ctl.current?.fit([id]), 120); };

  return (
    <div className="ev">
      <section className="ev-stage" ref={wrapRef}>
        <canvas ref={canvasRef} aria-label="Evidence graph" />
        {tip && !node && <div className="ev-tip" style={{ left: tip.x + 14, top: tip.y + 14 }}><i style={{ background: COLOR[tip.n.type] }} /><b>{short(tip.n)}</b><span>{typeOf(tip.n.type).one} · {tip.n.degree} links</span></div>}

        <form className="ev-ask" onSubmit={(e) => { e.preventDefault(); ask(query); }}>
          <div className="askbar">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask a fire-safety question, or describe a scenario: cotton, 34 % O₂, Moon base…" aria-label="Question" />
            {res && <button type="button" className="x" onClick={clear} aria-label="Clear">×</button>}
            <button type="submit" disabled={busy}>{busy ? "Searching…" : "Ask"}</button>
          </div>
          {!res && <div className="sug">{ASKS.map((a) => <button type="button" key={a} onClick={() => ask(a)}>{a}</button>)}</div>}
        </form>

        <div className="ev-legend">
          {TYPES.map((t) => (
            <button key={t.id} aria-pressed={show[t.id]} onClick={() => setShow({ ...show, [t.id]: !show[t.id] })} title={t.help}>
              <i style={{ background: t.color }} />{t.label}<span className="mono">{counts[t.id]}</span>
            </button>
          ))}
          <p className="mono">drag a bead · scroll to zoom · click to read</p>
          <button className="add" onClick={() => fileRef.current?.click()}>+ Add your own documents</button>
          <input ref={fileRef} type="file" multiple hidden accept=".pdf,.txt,.md,.csv,.json" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
        </div>
        {toast && <div className="ev-toast mono">{toast}</div>}
        {err && <div className="ev-toast mono">{err} — is the API running?</div>}

        {(node || res) && (
          <aside className="ev-panel">
            {node ? (
              <>
                <button className="back" onClick={() => setFocus(null)}>{res ? "← Back to the answer" : "× Close"}</button>
                <p className="kind"><i style={{ background: COLOR[node.type] }} />{typeOf(node.type).one}{insight && <> · {NEED[insight.need]}</>}</p>
                <h2>{insight ? insight.title : node.label}</h2>
                {insight ? (
                  <>
                    <p className="lead">{insight.observation}</p>
                    <dl className="ev-dl">
                      <div><dt>Design question</dt><dd>{insight.design_question}</dd></div>
                      <div><dt>Limit of the evidence</dt><dd>{insight.limitation}</dd></div>
                      <div><dt>What would settle it</dt><dd>{insight.next_validation}</dd></div>
                      <div><dt>Basis</dt><dd>{KIND[insight.evidence_kind]} · {insight.conditions}</dd></div>
                    </dl>
                  </>
                ) : node.description && <p className="lead">{node.description}</p>}
                {node.type === "document" && node.props.accession && (
                  <>
                    <dl className="ev-facts">
                      {byAcc[node.props.accession] && <div><dt>Test records</dt><dd className="mono">{byAcc[node.props.accession].profile.n_tests.toLocaleString()}</dd></div>}
                      {node.props.platform && <div><dt>Flown on</dt><dd>{node.props.platform}</dd></div>}
                      {node.props.dates?.[0] && <div><dt>Dates</dt><dd className="mono">{String(node.props.dates[0]).slice(-4)}–{String(node.props.dates[1] ?? "").slice(-4)}</dd></div>}
                    </dl>
                    <button className="cta" onClick={() => openDrawer(node.props.accession)}>Open the data and sources →</button>
                  </>
                )}
                <h3>Linked to <span className="mono">{neighbours.length}</span></h3>
                <ul className="ev-links">
                  {neighbours.slice(0, 40).map((x, i) => (
                    <li key={i}>
                      <button onClick={() => setFocus(x.n.id)} onMouseEnter={() => setPeek(x.n.id)} onMouseLeave={() => setPeek(null)}>
                        <i style={{ background: COLOR[x.n.type] }} /><span className="rel mono">{x.dir === "out" ? REL[x.rel] ?? x.rel : `← ${REL[x.rel] ?? x.rel}`}</span><b>{short(x.n)}</b>
                        {x.quote && <q>{x.quote.length > 150 ? x.quote.slice(0, 150) + "…" : x.quote}</q>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : res && (
              <>
                <p className="kind"><i style={{ background: "#fff" }} />Answer · every line is quoted from a source</p>
                <h2>{res.query}</h2>
                {covFocus && cov && <CoverageChart cov={cov} focus={covFocus} />}
                {rank && rank.results.length > 0 && <>
                  <h3>Most relevant investigations</h3>
                  <RankBars rank={rank} onOpen={openDrawer} onHover={(a) => setPeek(a ? `doc:${a}` : null)} />
                </>}
                <h3>What the sources say</h3>
                <ol className="ev-src">
                  {res.sources.filter((s) => s.used).slice(0, 8).map((s) => (
                    <li key={s.id} onMouseEnter={() => setPeek(s.node)} onMouseLeave={() => setPeek(null)}>
                      <button onClick={() => s.node && setFocus(s.node)}><span className="mono">{s.id}</span><b>{s.title}</b></button>
                      <p>{s.text.length > 320 ? s.text.slice(0, 320) + "…" : s.text}</p>
                    </li>
                  ))}
                </ol>
                <details className="ev-full"><summary>Full answer text</summary><MiniMarkdown text={res.answer} /></details>
                <p className="ev-note">{res.mode === "extractive" ? "Extractive answer: passages and numbers are quoted from NASA PSI records, not generated." : "Generated from the quoted sources."} The lit beads are the sources used; hover a line to find it in the graph.</p>
              </>
            )}
          </aside>
        )}
      </section>

      <section className="ev-conc">
        <header>
          <p className="mono meta">{insights.length} conclusions · each one traced to its NASA records</p>
          <h2>What the evidence says for fire safety.</h2>
        </header>
        {(["extinction", "materials", "detection"] as const).map((need) => (
          <div className="grp" key={need}>
            <h3>{NEED[need]}</h3>
            <div className="cards">
              {insights.filter((i) => i.need === need).map((i) => (
                <button key={i.id} className={focus === `research:${i.id}` ? "on" : ""} onClick={() => pick(`research:${i.id}`)}>
                  <span className={`k mono ${i.evidence_kind}`}>{KIND[i.evidence_kind]}</span>
                  <b>{i.title}</b>
                  <span className="q">{i.design_question}</span>
                  <span className="src mono">{[...new Set(i.sources.map((s) => (s.accession ? byAcc[s.accession]?.acronym ?? s.accession : null)).filter(Boolean))].join(" · ")}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
