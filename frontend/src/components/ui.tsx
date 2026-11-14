import type { ReactNode } from "react";
import type { Factor, Need, Status } from "../types";

export const NEED_LABEL: Record<Need, string> = {
  materials: "Materials & flame spread",
  extinction: "Extinction & suppression",
  detection: "Smoke & fire detection",
};

export const STATUS_LABEL: Record<Status, string> = {
  match: "covered",
  partial: "close",
  bounded: "bounded only",
  unknown: "not reported",
  mismatch: "outside range",
};

export function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(2);
  return Number(v.toFixed(digits)).toString();
}

export function range(r: [number, number] | null | undefined, scale = 1, unit = "", digits = 1): string {
  if (!r) return "not reported";
  const [a, b] = [r[0] * scale, r[1] * scale];
  return Math.abs(a - b) < 1e-9 ? `${fmt(a, digits)}${unit}` : `${fmt(a, digits)}–${fmt(b, digits)}${unit}`;
}

export function bytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function Doi({ doi }: { doi: string | null }) {
  if (!doi) return null;
  return (
    <span className="doi">
      DOI <a href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">{doi}</a>
    </span>
  );
}

export function ScoreBar({ relevance, fit, data, weights }: { relevance: number; fit: number | null; data: number; weights: Record<string, number> }) {
  const f = fit ?? 0.5;
  return (
    <div className="scorebar" role="img" aria-label={`relevance ${fmt(relevance)}, fit ${fmt(fit)}, data ${fmt(data)}`}>
      <span className="rel" style={{ width: `${relevance * weights.relevance * 100}%` }} />
      <span className="fit" style={{ width: `${f * weights.fit * 100}%`, opacity: fit === null ? 0.35 : 1 }} />
      <span className="dat" style={{ width: `${data * weights.data * 100}%` }} />
    </div>
  );
}

export function FactorChip({ f }: { f: Factor }) {
  return (
    <span className={`factor ${f.status}`} title={`${f.detail}\nTested: ${f.tested}`}>
      <b>{f.label}</b> {f.target} <span className="st">{STATUS_LABEL[f.status]}</span>
    </span>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="loading" role="status">{what}…</div>;
}

export function ErrorBox({ error }: { error: string }) {
  return (
    <div className="error" role="alert">
      The API returned an error: {error}. Check that the backend is running on port 8000 (see README).
    </div>
  );
}

export function PageHead({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function EvidenceBadge({ kind }: { kind: string }) {
  if (kind === "computed_from_table") return <span className="badge ug">Computed from NASA tables</span>;
  if (kind === "hypothesis") return <span className="badge amber">Hypothesis under test</span>;
  return <span className="badge match">Stated in PSI record</span>;
}

/** Minimal, safe Markdown for assistant answers: paragraphs, bullets, **bold**, _italic_, [S#] citations. */
export function MiniMarkdown({ text, onCite }: { text: string; onCite?: (id: string) => void }) {
  const inline = (s: string, key: number): ReactNode[] => {
    const parts = s.split(/(\*\*[^*]+\*\*|_[^_]+_|\[S\d+\])/g).filter(Boolean);
    return parts.map((p, i) => {
      if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
      if (/^_[^_]+_$/.test(p)) return <em key={`${key}-${i}`} className="faint">{p.slice(1, -1)}</em>;
      if (/^\[S\d+\]$/.test(p)) {
        const id = p.slice(1, -1);
        return <button key={`${key}-${i}`} className="cite" onClick={() => onCite?.(id)} aria-label={`source ${id}`}>{id}</button>;
      }
      return <span key={`${key}-${i}`}>{p}</span>;
    });
  };
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(<ul key={`ul${blocks.length}`}>{list.map((l, i) => <li key={i}>{inline(l, i)}</li>)}</ul>);
      list = [];
    }
  };
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (/^[-*]\s+/.test(t)) { list.push(t.replace(/^[-*]\s+/, "")); return; }
    flush();
    if (!t) return;
    if (/^#{1,4}\s/.test(t)) { blocks.push(<p key={i}><strong>{t.replace(/^#+\s/, "")}</strong></p>); return; }
    blocks.push(<p key={i}>{inline(t, i)}</p>);
  });
  flush();
  return <div className="answer">{blocks}</div>;
}
