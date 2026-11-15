/**
 * The opening of the site: one candle flame, computed live (sim/candle.ts), at the gravity the reader picks.
 * Four views of the same computation: what a camera would see, temperature, velocity, vorticity.
 */
import { useEffect, useRef, useState } from "react";
import { Candle, DX, GEOM, NR, NY, T_INF, Z_ST } from "../sim/candle";
import { cmap, cmapCss } from "./firelab/colormaps";

type View = "flame" | "temperature" | "velocity" | "vorticity";
const VIEWS: { id: View; label: string; text: string }[] = [
  { id: "flame", label: "Flame", text: "What a camera would see: the blue reaction zone where fuel vapour meets oxygen, and the yellow glow of soot where the fuel-rich side is hot enough." },
  { id: "temperature", label: "Temperature", text: "Gas temperature in a slice through the axis. The white line is the flame sheet, where fuel and oxygen meet in exact proportion." },
  { id: "velocity", label: "Velocity", text: "Gas speed, with arrows for direction. Buoyancy drives all of it: hot gas rises and pulls fresh air in from below and from the sides." },
  { id: "vorticity", label: "Vorticity", text: "Local rotation of the gas. It is produced where hot and cold gas shear past each other, at the edge of the plume." },
];
const WORLDS = [{ g: 0, label: "ISS", sub: "0 g" }, { g: 1.62, label: "Moon", sub: "0.17 g" }, { g: 3.71, label: "Mars", sub: "0.38 g" }, { g: 9.81, label: "Earth", sub: "1 g" }];
const DT = 0.0025, W = 2 * NR, LX = 2 * NR * DX, LY = NY * DX;
/** dark diverging map for signed fields: blue (negative), black (zero), orange (positive) */
const divDark = (t: number): [number, number, number] => { const a = Math.sqrt(Math.abs(t)); return t >= 0 ? [0.04 + 0.96 * a, 0.045 + 0.5 * a, 0.045 + 0.1 * a] : [0.04 + 0.2 * a, 0.045 + 0.5 * a, 0.045 + 0.95 * a]; };
const DIV_CSS = "linear-gradient(90deg, rgb(61,139,254), rgb(10,11,11) 50%, rgb(255,139,37))";
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

interface Read { Tf: number; h: number; w: number; v: number; fuel: number; rate: number; uref: number; vortMax: number }

export default function FlameHero({ onSimulate, onEvidence }: { onSimulate: () => void; onEvidence: () => void }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const [g, setG] = useState(9.81);
  const [view, setView] = useState<View>("flame");
  const [arrows, setArrows] = useState(true);
  const [read, setRead] = useState<Read>({ Tf: 1640, h: 0.018, w: 0.01, v: 0.7, fuel: 1.8e-6, rate: 0.25, uref: 0.5, vortMax: 100 });
  const live = useRef({ g, view, arrows }); live.current = { g, view, arrows };

  useEffect(() => {
    const cv = cvRef.current!; const ctx = cv.getContext("2d")!;
    const sim = new Candle();
    const off = document.createElement("canvas"); off.width = W; off.height = NY; const octx = off.getContext("2d")!; const img = octx.createImageData(W, NY);
    // chord length of the line of sight at lateral position m through the ring of radius index i (Abel projection)
    const chord = new Float32Array(NR * NR);
    for (let m = 0; m < NR; m++) for (let i = m; i < NR; i++) { const x = (m + 0.5) * DX, r0 = Math.max(x, i * DX), r1 = (i + 1) * DX; chord[m * NR + i] = 2 * (Math.sqrt(r1 * r1 - x * x) - Math.sqrt(Math.max(0, r0 * r0 - x * x))); }
    const eb = new Float32Array(NR), es = new Float32Array(NR);
    const tracers = Array.from({ length: 260 }, () => ({ x: 0, y: 0, px: 0, py: 0, life: 0 }));
    const seed = (p: (typeof tracers)[number]) => { p.x = p.px = (Math.random() * 2 - 1) * LX * 0.5; p.y = p.py = Math.random() * LY; p.life = 0.4 + Math.random() * 1.2; };
    tracers.forEach(seed);
    let zoom = 0.066; let raf = 0, last = performance.now(), hudT = 0, simT = 0, wallT = 0, uref = 0.5, vortMax = 50, visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }); io.observe(cv);
    const resize = () => { const r = cv.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio); cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); };
    const ro = new ResizeObserver(resize); ro.observe(cv); resize();

    const paint = () => {
      const { view } = live.current; const d = img.data; const { Z, T, uc, vc, vort, solid, Tf } = sim;
      if (view === "vorticity") { sim.computeVorticity(); let m = 1; for (let c = 0; c < NR * NY; c++) if (!solid[c]) m = Math.max(m, Math.abs(vort[c])); vortMax += (m - vortMax) * 0.1; }
      for (let j = 0; j < NY; j++) {
        const row = (NY - 1 - j) * W * 4;
        if (view === "flame") {
          for (let i = 0; i < NR; i++) {
            const c = i + NR * j, z = Z[c]; if (solid[c]) { eb[i] = es[i] = 0; continue; }
            const q = (z - Z_ST) / (0.3 * Z_ST);
            eb[i] = Math.exp(-q * q) * ((Tf - T_INF) / 1350);
            es[i] = sstep(1400, 1620, T[c]) * sstep(Z_ST, 1.5 * Z_ST, z) * (1 - sstep(3 * Z_ST, 7 * Z_ST, z));
          }
          for (let m = 0; m < NR; m++) {
            let b = 0, s = 0; for (let i = m; i < NR; i++) { const w = chord[m * NR + i]; b += eb[i] * w; s += es[i] * w; }
            const ib = 1 - Math.exp(-b * 230), is = 1 - Math.exp(-s * 520);
            const R = 255 * Math.min(1, 0.16 * ib + 1.0 * is + 0.25 * is * is), G = 255 * Math.min(1, 0.38 * ib + 0.74 * is + 0.25 * is * is), B = 255 * Math.min(1, 1.0 * ib + 0.3 * is + 0.3 * is * is);
            const A = Math.max(R, G, B, 1), k = 255 / A; // transparent where dark, so the page flow shows behind the flame
            for (const px of [NR + m, NR - 1 - m]) { const o = row + px * 4; d[o] = R * k; d[o + 1] = G * k; d[o + 2] = B * k; d[o + 3] = A; }
          }
        } else for (let i = 0; i < NR; i++) {
          const c = i + NR * j; let rgb: [number, number, number];
          if (solid[c]) rgb = [0.1, 0.1, 0.1];
          else if (view === "temperature") rgb = cmap("inferno", Math.min(1, (T[c] - T_INF) / (1700 - T_INF)));
          else if (view === "velocity") rgb = cmap("viridis", Math.min(1, Math.hypot(uc[c], vc[c]) / uref));
          else rgb = divDark(Math.max(-1, Math.min(1, vort[c] / vortMax)));
          for (const px of [NR + i, NR - 1 - i]) {
            const o = row + px * 4; const mir = view === "vorticity" && px < NR ? divDark(-Math.max(-1, Math.min(1, vort[c] / vortMax))) : rgb;
            d[o] = (solid[c] ? rgb : mir)[0] * 255; d[o + 1] = (solid[c] ? rgb : mir)[1] * 255; d[o + 2] = (solid[c] ? rgb : mir)[2] * 255; d[o + 3] = 255;
          }
        }
      }
      octx.putImageData(img, 0, 0);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dtw = Math.min(0.05, (now - last) / 1000); last = now; if (!visible) return;
      sim.g = live.current.g;
      const t0 = performance.now(); let n = 0; while (n < 3 && performance.now() - t0 < 11) { sim.step(DT); n++; }
      simT += n * DT; wallT += dtw;
      uref += (Math.max(0.02, sim.vmax) - uref) * 0.08;
      paint();
      // ---- compose
      const Wc = cv.width, Hc = cv.height, viewH = live.current.view === "flame" ? 0.066 : LY;
      zoom += (viewH - zoom) * 0.12; const s = Math.min(Hc / zoom, Wc / LX * (LY / zoom)) * 0.985, x0 = Wc / 2 - (LX * s) / 2, y0 = Hc - 2;
      const X = (x: number) => Wc / 2 + x * s, Y = (y: number) => y0 - y * s;
      ctx.clearRect(0, 0, Wc, Hc); if (live.current.view !== "flame") { ctx.fillStyle = "#050606"; ctx.fillRect(0, 0, Wc, Hc); }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      const v = live.current.view;
      if (v === "flame") { ctx.globalCompositeOperation = "lighter"; ctx.filter = `blur(${Math.max(1, s * DX * 0.6)}px)`; ctx.drawImage(off, x0, y0 - LY * s, LX * s, LY * s); ctx.filter = `blur(${s * DX * 7}px)`; ctx.globalAlpha = 0.35; ctx.drawImage(off, x0, y0 - LY * s, LX * s, LY * s); ctx.filter = "none"; ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; }
      else ctx.drawImage(off, x0, y0 - LY * s, LX * s, LY * s);
      // candle and wick
      const cr = GEOM.CANDLE_R * DX, ch = GEOM.CANDLE_H * DX, wh = GEOM.WICK_H * DX;
      const lit = Math.min(1, (sim.Tf - 1000) / 700);
      const gr = ctx.createLinearGradient(0, Y(ch), 0, Y(0)); gr.addColorStop(0, v === "flame" ? `rgba(${90 + 70 * lit},${84 + 50 * lit},${74 + 20 * lit},1)` : "#3a3a38"); gr.addColorStop(1, v === "flame" ? "#141413" : "#2a2a29");
      ctx.fillStyle = gr; ctx.fillRect(X(-cr), Y(ch), 2 * cr * s, ch * s + (Hc - y0) + 2);
      ctx.strokeStyle = "#0c0c0c"; ctx.lineWidth = Math.max(2, GEOM.WICK_R * DX * s * 0.7); ctx.beginPath(); ctx.moveTo(X(0), Y(ch)); ctx.lineTo(X(0), Y(ch + wh)); ctx.stroke();
      // flame sheet contour on the field views
      if (v !== "flame") {
        ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 1.2; ctx.beginPath();
        for (let j = 1; j < NY - 1; j++) for (let i = 0; i < NR - 1; i++) {
          const c = i + NR * j, a = sim.Z[c] - Z_ST, b = sim.Z[c + 1] - Z_ST, cc = sim.Z[c + NR] - Z_ST;
          if (a * b < 0) { const f = a / (a - b), xr = (i + 0.5 + f) * DX, y = (j + 0.5) * DX; for (const sg of [-1, 1]) { ctx.moveTo(X(sg * xr) - 0.8, Y(y)); ctx.lineTo(X(sg * xr) + 0.8, Y(y - DX)); } }
          if (a * cc < 0) { const f = a / (a - cc), xr = (i + 0.5) * DX, y = (j + 0.5 + f) * DX; for (const sg of [-1, 1]) { ctx.moveTo(X(sg * xr - DX / 2), Y(y)); ctx.lineTo(X(sg * xr + DX / 2), Y(y)); } }
        }
        ctx.stroke();
      }
      // tracers carried by the computed velocity (all views), arrows on the field views
      const simDt = n * DT;
      ctx.strokeStyle = v === "flame" ? "rgba(240,240,237,.16)" : "rgba(255,255,255,.4)"; ctx.lineWidth = 1; ctx.beginPath();
      for (const p of tracers) {
        const [u1, v1] = sim.velocity(p.x, p.y); p.px = p.x; p.py = p.y; p.x += u1 * simDt; p.y += v1 * simDt; p.life -= simDt * (0.3 + Math.hypot(u1, v1) * 3);
        if (p.life < 0 || p.y > LY || p.y < 0 || Math.abs(p.x) > LX / 2 || (Math.abs(p.x) < cr && p.y < ch)) { seed(p); continue; }
        const tl = Math.max(0.02, Math.hypot(u1, v1)) * (v === "flame" ? 0.012 : 0.03); const k = tl / Math.max(1e-6, Math.hypot(u1, v1));
        ctx.moveTo(X(p.x - u1 * k), Y(p.y - v1 * k)); ctx.lineTo(X(p.x), Y(p.y));
      }
      ctx.stroke();
      if (live.current.arrows && v !== "flame") {
        ctx.strokeStyle = ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = Math.max(1, s * DX * 0.22);
        const stepM = 0.005, len = stepM * 0.95 * s;
        for (let y = stepM / 2; y < LY; y += stepM) for (let x = -LX / 2 + stepM / 2; x < LX / 2; x += stepM) {
          if (Math.abs(x) < cr + DX && y < ch + DX) continue;
          const [u1, v1] = sim.velocity(x, y), sp = Math.hypot(u1, v1); if (sp < 0.003) continue;
          const L = Math.min(1.3, sp / uref) * len, ax = (u1 / sp) * L, ay = (-v1 / sp) * L, px = X(x), py = Y(y), hd = Math.min(L * 0.4, len * 0.28);
          ctx.beginPath(); ctx.moveTo(px - ax / 2, py - ay / 2); ctx.lineTo(px + ax / 2, py + ay / 2); ctx.stroke();
          const nx = ax / L, ny = ay / L; ctx.beginPath(); ctx.moveTo(px + ax / 2, py + ay / 2); ctx.lineTo(px + ax / 2 - nx * hd - ny * hd * 0.5, py + ay / 2 - ny * hd + nx * hd * 0.5); ctx.lineTo(px + ax / 2 - nx * hd + ny * hd * 0.5, py + ay / 2 - ny * hd - nx * hd * 0.5); ctx.closePath(); ctx.fill();
        }
      }
      // scale bar: 1 cm
      ctx.strokeStyle = "rgba(240,240,237,.55)"; ctx.lineWidth = 1; ctx.beginPath(); const bx = x0 + 14, by = y0 - 14; ctx.moveTo(bx, by); ctx.lineTo(bx + 0.01 * s, by); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4); ctx.moveTo(bx + 0.01 * s, by - 4); ctx.lineTo(bx + 0.01 * s, by + 4); ctx.stroke();
      ctx.fillStyle = "rgba(240,240,237,.6)"; ctx.font = `${11 * Math.min(2, window.devicePixelRatio)}px ui-monospace, monospace`; ctx.fillText("1 cm", bx + 0.01 * s + 8, by + 4);

      if (now - hudT > 300) {
        hudT = now;
        setRead({ Tf: sim.Tf, h: sim.height, w: sim.width, v: sim.vmax, fuel: sim.fuelRate, rate: wallT > 0 ? simT / wallT : 0, uref, vortMax });
        if (wallT > 3) { simT *= 0.5; wallT *= 0.5; }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, []);

  const vw = VIEWS.find((q) => q.id === view)!;
  const still = read.v < 0.005;
  return (
    <section className="fh">
      <div className="fh-text">
        <p className="mono meta">NASA Space Apps 2026 · Flame in Freefall</p>
        <h1>Fire behaves differently without gravity.</h1>
        <p className="lede">This candle flame is computed as you watch. Lower the gravity: the hot gas stops rising, the flame rounds off, cools and turns blue. That change is what every fire-safety rule for the Moon and Mars has to account for.</p>

        <div className="fh-ctl">
          <div className="fh-row">
            <span className="k">Gravity</span>
            <div className="seg">{WORLDS.map((w) => <button key={w.label} aria-pressed={Math.abs(g - w.g) < 0.01} onClick={() => setG(w.g)}>{w.label} <span className="mono">{w.sub}</span></button>)}</div>
          </div>
          <label className="range"><span>&nbsp;<b className="mono">{(g / 9.81).toFixed(2)} g</b></span><input type="range" min={0} max={9.81} step={0.01} value={g} onChange={(e) => setG(Number(e.target.value))} aria-label="Gravity" /></label>
          <div className="fh-row">
            <span className="k">View</span>
            <div className="seg">{VIEWS.map((q) => <button key={q.id} aria-pressed={view === q.id} onClick={() => setView(q.id)}>{q.label}</button>)}</div>
          </div>
          <p className="fh-cap">{vw.text}{view === "velocity" && still ? " At 0 g nothing moves: oxygen reaches the flame by diffusion alone." : ""}</p>
          {view !== "flame" && <label className="check"><input type="checkbox" checked={arrows} onChange={(e) => setArrows(e.target.checked)} />Velocity vectors</label>}
        </div>

        <dl className="fh-read">
          <div><dt>Flame temperature</dt><dd className="mono">{read.Tf.toFixed(0)} K</dd></div>
          <div><dt>Height × width</dt><dd className="mono">{(read.h * 1000).toFixed(0)} × {(read.w * 1000).toFixed(0)} mm</dd></div>
          <div><dt>Fastest gas</dt><dd className="mono">{(read.v * 100).toFixed(read.v < 0.1 ? 1 : 0)} cm/s</dd></div>
          <div><dt>Wax burned</dt><dd className="mono">{(read.fuel * 1e6).toFixed(2)} mg/s</dd></div>
        </dl>
        <div className="links">
          <button className="tlink strong" onClick={onSimulate}>Simulate a fire in a habitat</button>
          <button className="tlink" onClick={onEvidence}>What NASA measured</button>
        </div>
      </div>

      <div className="fh-stage">
        <canvas ref={cvRef} aria-label="Candle flame simulation" />
        {view !== "flame" && (
          <div className="fh-legend">
            <div className="bar" style={{ background: view === "vorticity" ? DIV_CSS : cmapCss(view === "temperature" ? "inferno" : "viridis") }} />
            <div className="ticks mono">
              {view === "temperature" ? <><span>293 K</span><span>1000</span><span>1700 K</span></> : view === "velocity" ? <><span>0</span><span>{(read.uref * 50).toFixed(1)}</span><span>{(read.uref * 100).toFixed(1)} cm/s</span></> : <><span>−{read.vortMax.toFixed(0)}</span><span>0</span><span>+{read.vortMax.toFixed(0)} s⁻¹</span></>}
            </div>
          </div>
        )}
        <p className="fh-note mono">live computation · axisymmetric flame-sheet model, {NR}×{NY} cells of {(DX * 1000).toFixed(3)} mm · shown {read.rate > 0 ? `${(1 / Math.max(0.01, read.rate)).toFixed(0)}× slower than real time` : ""} · model, not a measurement</p>
      </div>
    </section>
  );
}
