import { useMemo, useState } from "react";

/**
 * Schematic flame (not a simulation). Gravity drives buoyancy: tall, flickering, yellow (soot-luminous)
 * at 1 g; compact, round, blue and steady in quiescent microgravity. Forced flow bends it downstream.
 */
const STOPS = [
  { g: 0, label: "Orbit (0 g)" },
  { g: 0.166, label: "Moon (0.17 g)" },
  { g: 0.38, label: "Mars (0.38 g)" },
  { g: 1, label: "Earth (1 g)" },
];

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export default function FlameLab() {
  const [gi, setGi] = useState(3);
  const [flow, setFlow] = useState(0);
  const g = STOPS[gi].g;
  const t = Math.sqrt(g); // buoyant velocity scales roughly with sqrt(g)

  const shape = useMemo(() => {
    // Teardrop curve x = a·sinθ·sin^m(θ/2), y = -b·cosθ : m = 0 gives an ellipse (a circle when a = b).
    const cx = 200, base = 200;
    const R = 46;
    const m = 1.7 * t;
    const a = R * (1 - 0.18 * t) + flow * 0.45;
    const b = R * (1 + 1.25 * t);
    const cy = base - b * 0.62 * t;
    const lean = flow * 0.9;
    const pts: string[] = [];
    for (let i = 0; i <= 96; i++) {
      const th = (i / 96) * 2 * Math.PI;
      const xr = a * Math.sin(th) * Math.pow(Math.abs(Math.sin(th / 2)), m);
      const yr = -b * Math.cos(th);
      const up = (1 - Math.cos(th)) / 2; // 0 at the tip, 1 at the base
      pts.push(`${(cx + xr + lean * (1 - up) + flow * 0.35).toFixed(1)},${(cy + yr).toFixed(1)}`);
    }
    return { path: `M ${pts.join(" L ")} Z`, cx, cy, base, w: a, h: 2 * b, lean };
  }, [t, flow]);

  const outer = mix([108, 184, 255], [245, 150, 40], t);
  const mid = mix([150, 205, 255], [255, 196, 87], t);
  const core = mix([233, 245, 255], [255, 240, 200], t);

  let verdict: string;
  if (g === 0 && flow === 0) {
    verdict = "Quiescent microgravity: no buoyant flow, oxygen arrives by diffusion — some flames become near-spherical, dimmer and may self-extinguish. Covered by PSI flight data.";
  } else if (g === 0) {
    verdict = "Microgravity with ventilation: forced flow now feeds the flame. This is the regime of BASS, SAFFIRE and SPICE. Covered by PSI flight data.";
  } else if (g < 1) {
    verdict = `${STOPS[gi].label}: weak buoyancy. No PSI combustion data exist at partial gravity yet — microgravity and 1-g results only bound this case.`;
  } else {
    verdict = "Normal gravity: hot gases rise, pulling fresh air in — a tall, flickering, sooty-yellow flame. This is how spacecraft materials are screened today (NASA-STD-6001).";
  }

  return (
    <figure className="flamelab" aria-label="Schematic flame under different gravity levels">
      <svg viewBox="0 0 400 270" role="img" aria-describedby="flamelab-verdict">
        <defs>
          <radialGradient id="glow" cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={outer} stopOpacity="0.45" />
            <stop offset="1" stopColor={outer} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="body" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={core} />
            <stop offset="0.35" stopColor={mid} />
            <stop offset="1" stopColor={outer} stopOpacity={0.85} />
          </linearGradient>
          <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={2 + 2 * t} />
          </filter>
        </defs>
        {flow > 0 && [60, 110, 160, 210].map((y) => (
          <line key={y} x1={20} x2={20 + 40 + flow * 3} y1={y} y2={y} stroke="#3a5582" strokeWidth={1.2} markerEnd="" opacity={0.7} />
        ))}
        <ellipse cx={shape.cx + shape.lean * 0.4} cy={shape.cy} rx={shape.w * 2.3} ry={shape.h * 0.8 + 20} fill="url(#glow)" />
        <g className="flicker" style={{ ["--flick" as string]: t, ["--flick-dur" as string]: `${0.5 + 0.6 * (1 - t)}s` }}>
          <path d={shape.path} fill="url(#body)" filter="url(#soft)" opacity={0.95} />
        </g>
        <ellipse cx={shape.cx} cy={shape.base + 6} rx={6} ry={3} fill="#2a3a59" />
        <line x1={shape.cx} x2={shape.cx} y1={shape.base + 6} y2={256} stroke="#2a3a59" strokeWidth={2} />
        <text x={392} y={262} textAnchor="end" style={{ fill: "#7d8ca8", fontSize: 10 }}>Schematic, not a simulation</text>
      </svg>
      <div className="controls">
        <label>
          <div className="readout"><span>Gravity</span><b>{STOPS[gi].label}</b></div>
          <input type="range" min={0} max={3} step={1} value={gi} onChange={(e) => setGi(Number(e.target.value))}
                 aria-valuetext={STOPS[gi].label} />
        </label>
        <label>
          <div className="readout"><span>Ventilation</span><b>{flow === 0 ? "off" : `${flow} cm/s`}</b></div>
          <input type="range" min={0} max={40} step={5} value={flow} onChange={(e) => setFlow(Number(e.target.value))} />
        </label>
      </div>
      <p className="verdict" id="flamelab-verdict">{verdict}</p>
    </figure>
  );
}
