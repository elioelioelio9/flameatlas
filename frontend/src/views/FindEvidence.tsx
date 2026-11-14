import { useEffect, useState } from "react";
import { api } from "../api";
import { Doi, ErrorBox, FactorChip, Loading, NEED_LABEL, PageHead, ScoreBar, fmt } from "../components/ui";
import { useApp } from "../state";
import type { Need, RankResponse, Scenario } from "../types";

const EXAMPLES = [
  "How does ventilation influence the burning of a solid material in a microgravity habitat?",
  "Agents d'extinction pour des combustibles liquides",
  "Smoke particle data to qualify detectors",
  "Moon base at 34% O2 and 8.2 psi: which data on fabric flammability?",
];

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export default function FindEvidence() {
  const { scenario, setScenario, patchScenario, habitats, openDrawer, toggleCompare, compareIds, setExtractIds, go } = useApp();
  const [question, setQuestion] = useState(scenario.query ?? "");
  const [res, setRes] = useState<RankResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const run = (sc: Scenario) => {
    setLoading(true);
    setError(null);
    api.rank(sc)
      .then((r) => {
        setRes(r);
        // adopt what the parser understood, so the scenario strip reflects it
        const s = r.scenario;
        setScenario({ ...sc, need: s.need ?? null, fuel_phase: s.fuel_phase ?? null, gravity: s.gravity ?? null,
          habitat: s.habitat ?? null, o2_pct: s.o2_pct ?? null, pressure_kpa: s.pressure_kpa ?? null,
          flow_cm_s: s.flow_cm_s ?? null, query: sc.query ?? null });
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // rank whenever the structured scenario changes (the question is applied on submit)
  const key = JSON.stringify({ ...scenario, query: undefined });
  useEffect(() => { run(scenario); /* eslint-disable-next-line */ }, [key]);

  const submit = (q: string) => {
    setQuestion(q);
    // a new question resets the structured fields so that the parser can fill them
    run({ include_ground_studies: scenario.include_ground_studies ?? true, query: q });
  };

  const setNeed = (n: Need | null) => patchScenario({ need: n });
  const onHabitat = (id: string) => {
    const h = habitats.find((x) => x.id === id);
    if (!h) { patchScenario({ habitat: null }); return; }
    patchScenario({
      habitat: id, gravity: h.gravity, o2_pct: (h.o2_pct_min + h.o2_pct_max) / 2,
      pressure_kpa: Math.round(((h.pressure_kpa_min + h.pressure_kpa_max) / 2) * 10) / 10,
    });
  };

  return (
    <>
      <PageHead title="Find evidence">
        Describe a fire-safety need and an environment. Investigations are ranked on three visible criteria — relevance,
        how well the tested conditions cover your scenario, and whether usable data exist — never on keywords alone.
      </PageHead>
      <div className="find">
        <aside>
          <form className="panel stack" onSubmit={(e) => { e.preventDefault(); submit(question); }}>
            <label className="field">
              Ask in plain language (English or French)
              <textarea rows={3} value={question} onChange={(e) => setQuestion(e.target.value)}
                        placeholder="e.g. fabric flammability in a Moon base at 34 % O2" />
            </label>
            <div className="row">
              <button className="btn primary" type="submit" disabled={!question.trim()}>Rank investigations</button>
              {question && <button type="button" className="btn ghost small" onClick={() => { setQuestion(""); setScenario({ include_ground_studies: true }); }}>Reset</button>}
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="faint small">Examples</span>
              {EXAMPLES.map((q) => (
                <button key={q} type="button" className="btn ghost small" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }}
                        onClick={() => submit(q)}>{q}</button>
              ))}
            </div>
          </form>

          <div className="panel stack">
            <div className="field">
              Safety need
              <div className="segmented" role="group" aria-label="Safety need">
                {(Object.keys(NEED_LABEL) as Need[]).map((n) => (
                  <button key={n} type="button" aria-pressed={scenario.need === n} onClick={() => setNeed(scenario.need === n ? null : n)}>
                    {n === "materials" ? "Materials" : n === "extinction" ? "Extinction" : "Detection"}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              Habitat preset
              <select value={scenario.habitat ?? ""} onChange={(e) => onHabitat(e.target.value)}>
                <option value="">None</option>
                {habitats.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
            <div className="grid-2" style={{ gap: 10 }}>
              <label className="field">
                Fuel phase
                <select value={scenario.fuel_phase ?? ""} onChange={(e) => patchScenario({ fuel_phase: e.target.value || null })}>
                  <option value="">Any</option><option value="solid">Solid</option><option value="liquid">Liquid</option><option value="gas">Gas</option>
                </select>
              </label>
              <label className="field">
                Gravity
                <select value={scenario.gravity ?? ""} onChange={(e) => patchScenario({ gravity: e.target.value || null })}>
                  <option value="">Any</option><option value="microgravity">Microgravity</option><option value="lunar">Moon (1/6 g)</option>
                  <option value="martian">Mars (0.38 g)</option><option value="earth">Earth (1 g)</option>
                </select>
              </label>
              <label className="field">
                O2 (%)
                <input type="number" step="0.5" min={0} max={100} value={scenario.o2_pct ?? ""} onChange={(e) => patchScenario({ o2_pct: num(e.target.value) })} />
              </label>
              <label className="field">
                Pressure (kPa)
                <input type="number" step="1" min={0} value={scenario.pressure_kpa ?? ""} onChange={(e) => patchScenario({ pressure_kpa: num(e.target.value) })} />
              </label>
              <label className="field">
                Flow (cm/s)
                <input type="number" step="1" min={0} value={scenario.flow_cm_s ?? ""} onChange={(e) => patchScenario({ flow_cm_s: num(e.target.value) })} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={scenario.include_ground_studies ?? true}
                     onChange={(e) => patchScenario({ include_ground_studies: e.target.checked })} />
              Include ground and modelling studies
            </label>
          </div>
        </aside>

        <section aria-live="polite">
          {res?.parsed && res.parsed.detected.length > 0 && (
            <div className="panel-flat" style={{ marginBottom: 14 }}>
              <div className="small faint" style={{ marginBottom: 6 }}>Understood from your question</div>
              <div className="parsed">
                {res.parsed.detected.map((d) => (
                  <span className="chip" key={d.field} title={`because: ${d.because}`}>{d.field.replace("_", " ")} <strong>{d.value}</strong></span>
                ))}
              </div>
            </div>
          )}
          {res && res.notes.length > 0 && <p className="faint small">{res.notes.join("; ")}</p>}
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div className="legend">
              <span><i style={{ background: "var(--ug)" }} />Relevance ({res ? res.weights.relevance * 100 : 50} %)</span>
              <span><i style={{ background: "#A7A9AA" }} />Condition fit ({res ? res.weights.fit * 100 : 30} %)</span>
              <span><i style={{ background: "#62676A" }} />Data readiness ({res ? res.weights.data * 100 : 20} %)</span>
            </div>
            {res && <span className="faint small">{res.results.length} investigations</span>}
          </div>
          {error && <ErrorBox error={error} />}
          {loading && !res && <Loading what="Ranking" />}
          {res && res.results.length === 0 && <div className="empty">No investigation addresses this need. Try another need or remove a condition.</div>}
          {res?.results.map((r, i) => (
            <article className="result" key={r.accession}>
              <div className="rank">{i + 1}</div>
              <div>
                <h3><span className="acr">{r.acronym ?? r.accession}</span><span className="faint small">{r.accession}</span></h3>
                <div className="title">{r.title}</div>
                {r.factors.length > 0 && <div className="factors">{r.factors.map((f) => <FactorChip key={f.factor} f={f} />)}</div>}
                {r.top_passage && <div className="passage">“{r.top_passage.text.length > 240 ? r.top_passage.text.slice(0, 237) + "…" : r.top_passage.text}”</div>}
                {open === r.accession && (
                  <>
                    <ul className="whylist">{r.why.map((w, j) => <li key={j}>{w}</li>)}</ul>
                    {r.gaps.length > 0 && <ul className="whylist gaps">{r.gaps.map((g, j) => <li key={j}>{g}</li>)}</ul>}
                  </>
                )}
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn small" onClick={() => setOpen(open === r.accession ? null : r.accession)} aria-expanded={open === r.accession}>
                    {open === r.accession ? "Hide reasoning" : "Why this rank, and what limits it"}
                  </button>
                  <button className="btn small ghost" onClick={() => openDrawer(r.accession)}>Details</button>
                  <button className={`btn small ghost ${compareIds.includes(r.accession) ? "on" : ""}`} onClick={() => toggleCompare(r.accession)}>
                    {compareIds.includes(r.accession) ? "In comparison" : "Compare"}
                  </button>
                  <button className="btn small ghost" onClick={() => { setExtractIds([r.accession]); go("extract"); }}>Extract</button>
                </div>
              </div>
              <div className="scores">
                <span className="total">{fmt(r.score * 100, 0)}</span>
                <ScoreBar relevance={r.relevance} fit={r.fit} data={r.data} weights={res.weights} />
                <span>relevance {fmt(r.relevance)}, fit {r.fit === null ? "n/a" : fmt(r.fit)}, data {fmt(r.data)}</span>
                {r.matching_tests > 0 && <span className="badge ug">{r.matching_tests} tests near your conditions</span>}
                <Doi doi={r.doi} />
              </div>
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
