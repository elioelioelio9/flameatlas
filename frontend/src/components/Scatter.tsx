import * as d3 from "d3";
import { useMemo, useRef, useState, type ReactNode } from "react";

export interface Pt {
  x: number;
  y: number;
  group: string;
  id: string;
  hollow?: boolean;
  info?: ReactNode;
}
export interface Rect { x0: number; x1: number; y0: number; y1: number; label: string; tone: "ug" | "amber" | "violet" | "grey"; labelBelow?: boolean; labelRight?: boolean }
export interface FitLine { group: string; slope: number; intercept: number; x_min: number; x_max: number }

const PALETTE = ["#F0F0ED", "#A7A9AA", "#8C9AA6", "#B3A58C", "#8FA08E", "#A08E99", "#62676A", "#C9C4B6", "#7D8B99", "#D6D6D1"];
const TONE: Record<Rect["tone"], string> = { ug: "#F0F0ED", amber: "#A7A9AA", violet: "#8C9AA6", grey: "#62676A" };

export function groupColors(groups: string[]): Record<string, string> {
  return Object.fromEntries(groups.map((g, i) => [g, PALETTE[i % PALETTE.length]]));
}

export default function Scatter({
  points, xLabel, yLabel, xDomain, yDomain, rects = [], fits = [], height = 440, colors, yLog = false,
}: {
  points: Pt[];
  xLabel: string;
  yLabel: string;
  xDomain?: [number, number];
  yDomain?: [number, number];
  rects?: Rect[];
  fits?: FitLine[];
  height?: number;
  colors?: Record<string, string>;
  yLog?: boolean;
}) {
  const width = 860;
  const m = { t: 16, r: 18, b: 46, l: 60 };
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ p: Pt; left: number; top: number } | null>(null);
  const groups = useMemo(() => Array.from(new Set(points.map((p) => p.group))).sort(), [points]);
  const col = colors ?? groupColors(groups);

  const xd = xDomain ?? (d3.extent([...points.map((p) => p.x), ...rects.flatMap((r) => [r.x0, r.x1])]) as [number, number]);
  const yd = yDomain ?? (d3.extent([...points.map((p) => p.y), ...rects.flatMap((r) => [r.y0, r.y1])]) as [number, number]);
  const pad = (d: [number, number]): [number, number] => {
    if (d[0] === undefined) return [0, 1];
    const s = (d[1] - d[0]) * 0.06 || 1;
    return [d[0] - s, d[1] + s];
  };
  const x = d3.scaleLinear().domain(xDomain ?? pad(xd)).range([m.l, width - m.r]).nice();
  const y = (yLog ? d3.scaleLog().domain(yDomain ?? [Math.max(1e-3, yd[0] * 0.8), yd[1] * 1.2]) : d3.scaleLinear().domain(yDomain ?? pad(yd)))
    .range([height - m.b, m.t]).nice();
  const xt = x.ticks(8);
  const yt = (y as d3.ScaleLinear<number, number>).ticks(6);

  const onMove = (p: Pt, e: React.MouseEvent) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setHover({ p, left: e.clientX - box.left + 12, top: e.clientY - box.top + 12 });
  };

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${yLabel} versus ${xLabel}`}>
        <defs>
          <clipPath id="plot"><rect x={m.l} y={m.t} width={width - m.l - m.r} height={height - m.t - m.b} /></clipPath>
        </defs>
        <g className="grid">
          {xt.map((t) => <line key={`gx${t}`} x1={x(t)} x2={x(t)} y1={m.t} y2={height - m.b} />)}
          {yt.map((t) => <line key={`gy${t}`} x1={m.l} x2={width - m.r} y1={y(t)} y2={y(t)} />)}
        </g>
        <g clipPath="url(#plot)">
          {rects.map((r) => (
            <g key={r.label}>
              <rect x={x(r.x0)} y={y(r.y1)} width={Math.max(2, x(r.x1) - x(r.x0))} height={Math.max(2, y(r.y0) - y(r.y1))}
                    fill={TONE[r.tone]} fillOpacity={0.14} stroke={TONE[r.tone]} strokeDasharray="4 3" strokeWidth={1.5} />
              <text x={r.labelRight ? x(r.x1) + 6 : x(r.x0)} y={r.labelBelow ? y(r.y0) + 14 : y(r.y1) - 5}
                    style={{ fill: TONE[r.tone], fontSize: 11.5, fontWeight: 500 }}>{r.label}</text>
            </g>
          ))}
          {fits.map((f) => (
            <line key={`fit-${f.group}`} x1={x(f.x_min)} x2={x(f.x_max)} y1={y(f.intercept + f.slope * f.x_min)}
                  y2={y(f.intercept + f.slope * f.x_max)} stroke={col[f.group] ?? "#ccc"} strokeWidth={2} strokeDasharray="6 4" />
          ))}
          {points.map((p) => (
            <circle key={p.id} cx={x(p.x)} cy={y(p.y)} r={4.2} fill={p.hollow ? "transparent" : col[p.group]}
                    fillOpacity={0.78} stroke={col[p.group]} strokeWidth={p.hollow ? 1.5 : 0.6}
                    onMouseMove={(e) => onMove(p, e)} onMouseLeave={() => setHover(null)} />
          ))}
        </g>
        <g className="axis">
          <line x1={m.l} x2={width - m.r} y1={height - m.b} y2={height - m.b} stroke="#2c2f31" />
          <line x1={m.l} x2={m.l} y1={m.t} y2={height - m.b} stroke="#2c2f31" />
          {xt.map((t) => <text key={`x${t}`} x={x(t)} y={height - m.b + 16} textAnchor="middle">{d3.format("~g")(t)}</text>)}
          {yt.map((t) => <text key={`y${t}`} x={m.l - 8} y={y(t) + 4} textAnchor="end">{d3.format("~g")(t)}</text>)}
          <text x={(m.l + width - m.r) / 2} y={height - 8} textAnchor="middle" style={{ fill: "#A7A9AA", fontSize: 12 }}>{xLabel}</text>
          <text transform={`translate(16 ${(m.t + height - m.b) / 2}) rotate(-90)`} textAnchor="middle" style={{ fill: "#A7A9AA", fontSize: 12 }}>{yLabel}</text>
        </g>
      </svg>
      <div className="legend" style={{ padding: "4px 8px 2px" }}>
        {groups.map((g) => <span key={g}><i style={{ background: col[g] }} />{g}</span>)}
      </div>
      {hover && <div className="tooltip" style={{ left: hover.left, top: hover.top }}>{hover.p.info}</div>}
    </div>
  );
}
