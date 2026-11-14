/**
 * The physics behind Fire Lab, for the jury: the scaling laws the simulation rests on, worked out with numbers
 * computed live from the same constants, plus a small calculator. Every formula here is either a textbook scaling
 * (order of magnitude, not a prediction) or the exact relation coded in sim/firesim.ts.
 */
import { useMemo, useState } from "react";
import { MATERIALS } from "../sim/firesim";

const WORLDS = [
  { id: "iss", name: "ISS", g: 9.81e-6, o2: 0.21, p: 101.3, note: "residual µg ≈ 10⁻⁶ g" },
  { id: "moon", name: "Moon base", g: 1.62, o2: 0.34, p: 56.5, note: "planned 34 % O₂ at 56.5 kPa" },
  { id: "mars", name: "Mars habitat", g: 3.71, o2: 0.3, p: 70, note: "assumed 30 % O₂ at 70 kPa" },
  { id: "earth", name: "Earth", g: 9.81, o2: 0.21, p: 101.3, note: "sea level" },
];
const T_INF = 293, DT_FLAME = 1500;           // ambient (K), flame-to-ambient temperature difference (K)
const NU0 = 1.5e-5, D0 = 2.1e-5, P0 = 101.3;  // air kinematic viscosity and O₂ diffusivity at 1 atm, 20 °C (m²/s)
const nu = (p: number) => NU0 * (P0 / p);     // μ does not depend on p, ρ ∝ p
const dO2 = (p: number) => D0 * (P0 / p);     // kinetic theory: D ∝ 1/p
/** reduced gravity g·Δρ/ρ with Δρ/ρ = ΔT/(T∞+ΔT): the Boussinesq βΔT overestimates when ΔT is larger than T∞ */
const dr = (dT = DT_FLAME) => dT / (T_INF + dT);
const ub = (g: number, L: number, dT = DT_FLAME) => Math.sqrt(g * dr(dT) * L);

function f(v: number, d = 2) {
  if (!isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) { const e = Math.floor(Math.log10(a)); return `${(v / 10 ** e).toFixed(1)} × 10${sup(e)}`; }
  return v.toLocaleString("en-GB", { maximumFractionDigits: d });
}
const sup = (e: number) => String(e).split("").map((c) => "⁰¹²³⁴⁵⁶⁷⁸⁹"["0123456789".indexOf(c)] ?? (c === "-" ? "⁻" : c)).join("");

function Eq({ children, label }: { children: React.ReactNode; label?: string }) {
  return <div className="th-eq"><span className="f">{children}</span>{label && <span className="l mono">{label}</span>}</div>;
}

function Calculator() {
  const [g, setG] = useState(1.62), [L, setL] = useState(0.1), [U, setU] = useState(0.1), [p, setP] = useState(56.5), [o2, setO2] = useState(34), [dT, setDT] = useState(1500);
  const u = ub(g, L, dT), Gr = (g * dr(dT) * L ** 3) / nu(p) ** 2, Ri = U > 0 ? (g * dr(dT) * L) / U ** 2 : Infinity;
  const tD = (L * L) / dO2(p), Pe = (U * L) / dO2(p), pO2 = (o2 / 100) * p;
  const burns = MATERIALS.filter((m) => o2 / 100 > m.limitO2).map((m) => m.label.split(" (")[0]);
  const regime = U === 0 && g < 1e-3 ? "diffusion only: the flame is fed by diffusion and its own expansion" : Ri > 10 ? "buoyancy dominates: plume rises, fresh air drawn in from below" : Ri < 0.1 ? "forced flow dominates: the fans set where heat and smoke go" : "mixed: buoyancy and fans are comparable";
  const row = (label: string, v: number, min: number, max: number, step: number, set: (x: number) => void, unit: string) => (
    <label className="range"><span>{label} <b className="mono">{f(v, 3)} {unit}</b></span><input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} /></label>
  );
  return (
    <div className="th-calc">
      <div className="in">
        {row("Gravity g", g, 0, 9.81, 0.01, setG, "m/s²")}
        <div className="seg marks">{WORLDS.map((w) => <button key={w.id} aria-pressed={Math.abs(g - w.g) < 0.005} onClick={() => { setG(w.g); setP(w.p); setO2(w.o2 * 100); }}>{w.name}</button>)}</div>
        {row("Flame or plume size L", L, 0.005, 1, 0.005, setL, "m")}
        {row("Fan airflow U", U, 0, 0.5, 0.01, setU, "m/s")}
        {row("Cabin pressure p", p, 20, 120, 0.5, setP, "kPa")}
        {row("Oxygen X(O₂)", o2, 12, 100, 0.5, setO2, "%")}
        {row("Flame temperature rise ΔT", dT, 300, 2000, 50, setDT, "K")}
      </div>
      <dl className="out">
        <div><dt>Buoyant velocity √(g Δρ/ρ L)</dt><dd className="mono">{f(u * 100, 3)} cm/s</dd></div>
        <div><dt>Time for smoke to rise 2 m by buoyancy</dt><dd className="mono">{u > 0 ? `${f(2 / u, 3)} s` : "never"}</dd></div>
        <div><dt>Grashof number Gr</dt><dd className="mono">{f(Gr)}</dd></div>
        <div><dt>Richardson number Ri = g (Δρ/ρ) L / U²</dt><dd className="mono">{U > 0 ? f(Ri, 3) : "∞ (no fan)"}</dd></div>
        <div><dt>O₂ diffusion time L² / D</dt><dd className="mono">{f(tD, 3)} s</dd></div>
        <div><dt>Péclet number U L / D</dt><dd className="mono">{f(Pe, 3)}</dd></div>
        <div><dt>O₂ partial pressure</dt><dd className="mono">{f(pO2, 3)} kPa</dd></div>
        <div className="wide"><dt>Regime</dt><dd>{regime}</dd></div>
        <div className="wide"><dt>Simulation materials above their oxygen limit</dt><dd>{burns.length ? burns.join(", ") : "none"}</dd></div>
      </dl>
    </div>
  );
}

export default function Theory() {
  const table = useMemo(() => WORLDS.map((w) => {
    const u1 = ub(w.g, 0.01), u2 = ub(w.g, 0.5);
    return { ...w, u1, u2, rise: 2 / u2, Ri: (w.g * dr() * 0.1) / 0.1 ** 2, Gr: (w.g * dr() * 0.1 ** 3) / nu(w.p) ** 2, tD: 0.01 ** 2 / dO2(w.p), pO2: w.o2 * w.p };
  }), []);
  const lab = { V: 106, Q: 1000 };            // US Lab free volume (m³, order of magnitude) and a 1 kW fire
  const dpdt = (0.4 * lab.Q) / lab.V;
  return (
    <section className="theory">
      <header className="th-head">
        <h2>The physics behind the tool</h2>
        <p>Everything the simulation shows follows from a few relations. Here they are with the numbers worked out for each habitat, so they can be checked by hand. Scalings give orders of magnitude, not predictions; where a formula is the one coded in the solver, it says so.</p>
      </header>

      <div className="th-block">
        <h3>Why gravity changes a flame</h3>
        <div className="th-cols">
          <div>
            <p>A flame heats the gas around it by about 1 500 K. Hot gas is lighter, and in gravity it rises at a speed set by the density difference. That rising plume pulls fresh air in from below and gives the candle its teardrop. The speed scales as:</p>
            <Eq label="Δρ/ρ = ΔT / (T∞ + ΔT), ideal gas">u<sub>b</sub> ≈ √( g · Δρ/ρ · L )</Eq>
            <p>With ΔT = 1 500 K and T∞ = 293 K, the hot gas is 84 % lighter than the cabin air: Δρ/ρ ≈ 0.84. (The small-ΔT form β ΔT, used in the solver, is the same law for the gentler temperature rises away from the flame.) Gravity enters under a square root, so dividing g by a million divides the flow by a thousand: on the ISS buoyant flow falls below a millimetre per second, slower than the air the crew stirs by moving.</p>
          </div>
          <table className="th-tab">
            <thead><tr><th>Habitat</th><th className="num">g (m/s²)</th><th className="num">u<sub>b</sub>, candle L = 1 cm</th><th className="num">u<sub>b</sub>, fire L = 0.5 m</th><th className="num">smoke rises 2 m in</th></tr></thead>
            <tbody>{table.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num mono">{f(r.g)}</td><td className="num mono">{f(r.u1 * 100, 1)} cm/s</td><td className="num mono">{f(r.u2 * 100, 0)} cm/s</td><td className="num mono">{r.rise > 120 ? `${f(r.rise / 60, 0)} min` : `${f(r.rise, 1)} s`}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="th-block">
        <h3>Buoyancy against the fans</h3>
        <div className="th-cols">
          <div>
            <p>In a cabin two flows compete: the plume of the fire and the ventilation. Their ratio is the Richardson number. Above about 10, buoyancy decides where heat and smoke go; below about 0.1, the fans do. The Grashof number says whether a natural plume would be smooth or turbulent (above about 10⁹).</p>
            <Eq label="U = fan airflow">Ri = g (Δρ/ρ) L / U²</Eq>
            <Eq label="ν = kinematic viscosity, ∝ 1/p">Gr = g (Δρ/ρ) L³ / ν²</Eq>
            <p>Worked for a 10 cm flame in a 10 cm/s cabin breeze, the airflow on the ISS: even on the Moon buoyancy still wins by about a factor of ten, so a lunar fire behaves more like an Earth fire than like an orbital one, only slower. Only in orbit do the fans take over.</p>
          </div>
          <table className="th-tab">
            <thead><tr><th>Habitat</th><th className="num">Ri (L = 10 cm, U = 10 cm/s)</th><th className="num">Gr (L = 10 cm)</th><th>Regime</th></tr></thead>
            <tbody>{table.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num mono">{f(r.Ri, 1)}</td><td className="num mono">{f(r.Gr, 0)}</td><td>{r.Ri > 10 ? "buoyancy" : r.Ri < 0.1 ? "fans" : "mixed"}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="th-block">
        <h3>Oxygen reaches the flame by diffusion</h3>
        <div className="th-cols">
          <div>
            <p>Without buoyancy and with the fans off, oxygen only reaches the flame by molecular diffusion, which takes a time L²/D. The flame consumes oxygen faster than diffusion brings it, surrounds itself with its own CO₂ and water, and often goes out. The Péclet number compares the fan flow with diffusion.</p>
            <Eq label="D(O₂) ≈ 2.1 × 10⁻⁵ m²/s at 1 atm, ∝ 1/p">t<sub>D</sub> = L² / D  ·  Pe = U L / D</Eq>
            <p>For a 1 cm flame, diffusion needs a few seconds. A 10 cm/s fan gives Pe ≈ 50 at that scale: the slightest breeze feeds the flame far better than diffusion, which is why NASA tests fan speed so carefully. Lower cabin pressure speeds up diffusion, which helps a small flame survive.</p>
            <p className="faint small">In the solver the diffusivity is an effective value, D = 1.2 × 10⁻³ m²/s at 1 atm (molecular plus the mixing a 16 cm cell cannot resolve), scaled by (p₀/p)<sup>½</sup> because only part of it is molecular.</p>
          </div>
          <table className="th-tab">
            <thead><tr><th>Habitat</th><th className="num">p (kPa)</th><th className="num">t<sub>D</sub>, L = 1 cm</th><th className="num">X(O₂)</th><th className="num">p(O₂)</th></tr></thead>
            <tbody>{table.map((r) => <tr key={r.id}><td>{r.name}</td><td className="num mono">{f(r.p)}</td><td className="num mono">{f(r.tD, 1)} s</td><td className="num mono">{f(r.o2 * 100)} %</td><td className="num mono">{f(r.pO2, 1)} kPa</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="th-block">
        <h3>Why 34 % oxygen at low pressure is a fire risk</h3>
        <div className="th-cols">
          <div>
            <p>Exploration habitats lower the pressure so that suits need less pre-breathing, and raise the oxygen fraction so the crew still breathes the same oxygen partial pressure: 34 % of 56.5 kPa is 19.2 kPa, close to 21 % of 101.3 kPa. The lungs see almost the same air.</p>
            <p>A flame does not. It burns according to the oxygen <i>fraction</i>: with less nitrogen to soak up heat, the flame is hotter, spreads faster, and materials that self-extinguish at 21 % keep burning. Each material has a limiting oxygen fraction below which it does not sustain a flame.</p>
            <Eq label="burns when">X(O₂) &gt; X<sub>lim</sub>(material, flow, gravity)</Eq>
            <p>Apollo 1 is the extreme case: 100 % oxygen at about 115 kPa on the pad, a partial pressure more than five times that of sea-level air. In microgravity BASS found that in a slow flow some materials burn below the limit measured on Earth, so a ground test can call a material safe when it is not, in orbit.</p>
          </div>
          <table className="th-tab">
            <thead><tr><th>Material in the simulation</th><th className="num">X<sub>lim</sub></th><th className="num">21 %</th><th className="num">30 %</th><th className="num">34 %</th></tr></thead>
            <tbody>{MATERIALS.map((m) => <tr key={m.id}><td>{m.label}</td><td className="num mono">{f(m.limitO2 * 100, 1)} %</td>{[0.21, 0.3, 0.34].map((x) => <td key={x} className="num">{x > m.limitO2 ? "burns" : "—"}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className="th-block">
        <h3>How a flame goes out</h3>
        <div className="th-cols">
          <div>
            <p>A flame survives if it releases heat faster than it loses it. The Damköhler number compares the time the gas spends in the flame with the time the chemistry needs. Too much flow and the gas leaves before it reacts (blow-off). Too little and the flame grows thick and slow, and radiation carries off more heat than it makes (quenching). Microgravity flames sit near the second limit, which on Earth is hidden by buoyancy.</p>
            <Eq label="extinction when Da drops below a critical value">Da = t<sub>flow</sub> / t<sub>chem</sub></Eq>
            <p>The solver uses the same idea in its simplest form: a burning cell whose burning rate stays below a critical value R<sub>crit</sub> = 0.006 (O₂ fraction per second) for 2 s goes out. Turning off the fans, diluting with CO₂ or lowering the oxygen all push the rate below it.</p>
          </div>
          <div>
            <p>In a sealed cabin, the burnt gas expands and has nowhere to go: the whole cabin pressure rises. The solver computes it from the mean volume source S̄ of the fire:</p>
            <Eq label="coded in firesim.ts">dp/dt = γ p S̄  =  (γ − 1) Q / V</Eq>
            <p>Worked: a {f(lab.Q / 1000)} kW fire in the {lab.V} m³ US Laboratory raises the pressure by {f(dpdt)} Pa/s, about {f(dpdt * 60, 0)} Pa per minute. Small for the hull, but enough to push smoke through every leak and open hatch.</p>
          </div>
        </div>
      </div>

      <div className="th-block">
        <h3>How the solver computes the flow</h3>
        <div className="th-cols">
          <div>
            <p>The cabin is cut into cubes of 16 cm (20 cm for Mars). In each step the solver moves the air, adds buoyancy and the fire's expansion, then corrects the velocities so that mass is conserved. Fire speeds are tiny compared with sound, so the low-Mach form of the equations applies:</p>
            <Eq label="momentum">∂u/∂t + (u·∇)u = −∇p/ρ + g (ΔT / T) ŷ</Eq>
            <Eq label="mass with expansion">∇·u = S = (1/T) DT/Dt</Eq>
            <Eq label="projection">∇²φ = ∇·u* − S  ·  u = u* − ∇φ</Eq>
          </div>
          <div>
            <p>The pressure equation is solved by preconditioned conjugate gradients (MIC(0)) until |∇·u − S| &lt; 5 × 10⁻⁵ s⁻¹, and the residual is shown live under the readouts. The time step is Δt = 0.06 s, so the Courant number CFL = u<sub>max</sub> Δt / Δx stays below 1 up to about {f(0.16 / 0.06)} m/s, far above any cabin flow. Heat and smoke are carried by second-order MacCormack advection. The "pressure max / min" marks in the simulation are ρ φ / Δt relative to the cabin mean.</p>
            <p className="faint small">The model is tuned to reproduce the trends in the NASA data, not validated against measured temperatures. Times and temperatures are indicative.</p>
          </div>
        </div>
      </div>

      <div className="th-block">
        <h3>How the investigations are ranked</h3>
        <div className="th-cols">
          <div>
            <p>Each NASA investigation gets three scores between 0 and 1, always shown separately, then combined with fixed weights:</p>
            <Eq label="weights fixed in ranking.py">score = 0.5 R + 0.3 F + 0.2 D</Eq>
            <p>R is relevance: how central the fire-safety question is to the investigation, blended with the text match. F is condition fit: covered = 1, close = 0.55, bounded = 0.5, not reported = 0.3, outside = 0.1, averaged over gravity, oxygen, pressure and flow; when the question gives no conditions it counts as 0.5. D is data readiness: whether test-level records exist, how many, and whether the needed variables are present.</p>
          </div>
          <div>
            <p>Worked, for "Does turning off the fans put out a fire?": FLEX has R = 0.93, no conditions so F = 0.5, D = 0.99.</p>
            <Eq>0.5 × 0.93 + 0.3 × 0.5 + 0.2 × 0.99 = 0.81</Eq>
            <p>That is the 81 shown on the Evidence page. The language model never computes or changes a score.</p>
          </div>
        </div>
      </div>

      <div className="th-block">
        <h3>Try the numbers</h3>
        <p className="th-sub">Move the sliders or pick a habitat: the same formulas as above, recomputed.</p>
        <Calculator />
      </div>
    </section>
  );
}
