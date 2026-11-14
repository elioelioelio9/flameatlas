import { useState } from "react";
import { api } from "../api";
import { ErrorBox, EvidenceBadge, Loading, MiniMarkdown, NEED_LABEL, PageHead } from "../components/ui";
import { useApp, useAsync } from "../state";
import type { AskResponse, Need } from "../types";

const SUGGESTED = [
  "Is cutting ventilation enough to stop a fire in a Moon base at 34% oxygen?",
  "Which gaseous agent extinguished droplet flames more often, CO2 or helium?",
  "Do smoke particles behave differently in microgravity, and why does it matter for detectors?",
  "Les matériaux brûlent-ils mieux en microgravité que sur Terre ?",
];

function Ask() {
  const { scenario, byAcc, openDrawer } = useApp();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hl, setHl] = useState<string | null>(null);
  const [useScenario, setUseScenario] = useState(false);

  const ask = (question: string) => {
    setQ(question); setBusy(true); setError(null); setHl(null);
    api.ask(question, useScenario ? { ...scenario, query: undefined } : undefined).then(setRes).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };
  const sources = res?.all_sources ?? res?.sources ?? [];
  const cite = (id: string) => {
    setHl(id);
    document.getElementById(`src-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  return (
    <section className="section" id="ask">
      <h2>Ask the evidence</h2>
      <p className="sub">
        Answers are assembled only from PSI records, curated insights and numbers computed by Fire Lab. Every
        statement links to its source; questions outside the corpus are declined.
      </p>
      <div className="ask">
        <div className="stack">
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (q.trim()) ask(q); }}>
            <input className="input" style={{ flex: 1, minWidth: 240 }} value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Ask a question about fire safety in microgravity" aria-label="Question" />
            <button className="btn primary" disabled={busy || !q.trim()}>{busy ? "Searching…" : "Ask"}</button>
          </form>
          <label className="check">
            <input type="checkbox" checked={useScenario} onChange={(e) => setUseScenario(e.target.checked)} />
            Also apply my current scenario (need, habitat, conditions) to the answer
          </label>
          <div className="row">
            {SUGGESTED.map((s) => <button key={s} className="btn small ghost" style={{ whiteSpace: "normal", textAlign: "left" }} onClick={() => ask(s)}>{s}</button>)}
          </div>
          {error && <ErrorBox error={error} />}
          {busy && <Loading what="Retrieving passages and ranking investigations" />}
          {res && !busy && (
            <div className="panel">
              <div className="row" style={{ marginBottom: 10 }}>
                <span className={`badge ${res.mode === "llm" ? "ug" : res.mode === "extractive" ? "match" : "amber"}`}>
                  {res.mode === "llm" ? `Written by ${res.model ?? "a language model"} from cited sources` :
                    res.mode === "extractive" ? "Extractive answer (quoted from sources)" : res.mode.replace("_", " ")}
                </span>
              </div>
              {res.warnings.map((w) => <p key={w} className="small" style={{ color: "var(--onegee)" }}>{w}</p>)}
              <MiniMarkdown text={res.answer} onCite={cite} />
            </div>
          )}
        </div>
        <aside>
          <h3 style={{ marginBottom: 6 }}>Sources</h3>
          {!res && <p className="faint small">Sources appear here, numbered as in the answer.</p>}
          {sources.map((s) => (
            <div key={s.id} id={`src-${s.id}`} className={`source ${hl === s.id ? "hl" : ""}`}>
              <b>{s.id}</b> <span className="k">{s.kind.replace("_", " ")}</span>{" "}
              {s.accession && byAcc[s.accession] ? (
                <button className="btn small ghost" onClick={() => openDrawer(s.accession!)}>{s.acronym ?? s.accession}</button>
              ) : null}
              <div className="muted">{s.title}</div>
              <div className="faint">{s.text.length > 220 ? s.text.slice(0, 217) + "…" : s.text}</div>
              {s.doi && <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">doi:{s.doi}</a>}
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
}

export default function Insights() {
  const { data, error, loading } = useAsync(() => api.insights(), []);
  const { openDrawer, byAcc } = useApp();
  const [need, setNeed] = useState<Need | "">("");
  const items = (data ?? []).filter((i) => !need || i.need === need);
  return (
    <>
      <PageHead title="Safety insights">
        Each card links an observation to the design question it informs, states what cannot be concluded, and names
        the next validation. Badges show whether a card was computed from NASA tables, stated in a PSI record, or is a
        hypothesis being tested.
      </PageHead>
      <div className="segmented" role="group" aria-label="Filter by need" style={{ marginBottom: 16 }}>
        <button aria-pressed={need === ""} onClick={() => setNeed("")}>All</button>
        {(Object.keys(NEED_LABEL) as Need[]).map((n) => <button key={n} aria-pressed={need === n} onClick={() => setNeed(n)}>{NEED_LABEL[n]}</button>)}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      <div className="grid-2">
        {items.map((i) => (
          <article className="insight" key={i.id}>
            <div className="row"><EvidenceBadge kind={i.evidence_kind} /><span className="faint small">{NEED_LABEL[i.need]}</span></div>
            <h3>{i.title}</h3>
            <dl>
              <dt>Observation</dt><dd>{i.observation}</dd>
              <dt>Conditions</dt><dd>{i.conditions}</dd>
              <dt>Design question</dt><dd className="q">{i.design_question}</dd>
              <dt>Cannot conclude</dt><dd>{i.limitation}</dd>
              <dt>Next validation</dt><dd>{i.next_validation}</dd>
              <dt>Sources</dt>
              <dd>
                {i.sources.map((s, k) => s.accession ? (
                  <button key={k} className="btn small ghost" onClick={() => openDrawer(s.accession!)}>
                    {byAcc[s.accession]?.acronym ?? s.accession}, {s.field}
                  </button>
                ) : <a key={k} href={s.url} target="_blank" rel="noreferrer">{s.field}</a>)}
              </dd>
            </dl>
          </article>
        ))}
      </div>
      <Ask />
    </>
  );
}
