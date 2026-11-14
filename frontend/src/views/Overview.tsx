import { api } from "../api";
import FlameLab from "../components/FlameLab";
import { Loading } from "../components/ui";
import { useApp, useAsync } from "../state";
import type { Need } from "../types";

const NEEDS: { id: Need; title: string; body: string; lead: string; preset: Record<string, unknown> }[] = [
  {
    id: "materials", title: "Will this material burn?",
    body: "Flame spread and flammability limits of fabrics and plastics in low-speed airflow, from cm-scale samples to a 1 m fire in a cargo vehicle.",
    lead: "BASS, BASS-II, SAFFIRE I–III, ACME BRE",
    preset: { need: "materials", fuel_phase: "solid", gravity: "microgravity" },
  },
  {
    id: "extinction", title: "What puts it out?",
    body: "Extinction limits and gaseous agents (CO2, helium) measured on 274 burning droplets, plus burning without ventilation.",
    lead: "FLEX, FLEX-2, CFI, ACME BRE",
    preset: { need: "extinction", gravity: "microgravity" },
  },
  {
    id: "detection", title: "Will we see it in time?",
    body: "Smoke particles from spacecraft materials, how they age and travel, and whether particle counters work without gravity.",
    lead: "SAME, SAME-R, DAFT, SPICE",
    preset: { need: "detection", gravity: "microgravity" },
  },
];

const HISTORY = [
  { yr: "1967", text: "Apollo 1: fire in a pure-oxygen cabin during a ground test; the crew of three died." },
  { yr: "1970", text: "Apollo 13: an oxygen tank explodes on the way to the Moon; the crew survives." },
  { yr: "1997", text: "Mir: an oxygen generator fire fills the station with smoke; a multinational crew survives." },
  { yr: "2026", text: "Artemis II: a smoke alarm sounds about 80,000 miles from Earth." },
];

export default function Overview() {
  const { meta, go, setScenario } = useApp();
  const cov = useAsync(() => api.coverage(), []);

  const start = (preset: Record<string, unknown>) => {
    setScenario({ include_ground_studies: true, ...preset });
    go("find");
  };

  return (
    <>
      <section className="hero">
        <div>
          <h1>How does fire behave when nothing rises?</h1>
          <p className="lede">
            FlameAtlas turns NASA's microgravity combustion experiments into evidence for fire-safety decisions:
            which results apply to your vehicle or Moon base, what the data really cover, and what is still unknown.
          </p>
          <div className="row">
            <button className="btn primary" onClick={() => go("find")}>Find evidence for a scenario</button>
            <button className="btn" onClick={() => go("map")}>See what the data cover</button>
          </div>
          <div className="hero-facts">
            {meta ? (
              <>
                <span><b>{meta.counts.in_scope}</b> NASA PSI investigations</span>
                <span><b>{meta.counts.tests.toLocaleString()}</b> experiment records</span>
                <span><b>{meta.counts.measurements.toLocaleString()}</b> measurements, each traceable to file and row</span>
              </>
            ) : <span>Connecting to the evidence base…</span>}
          </div>
        </div>
        <FlameLab />
      </section>

      <section>
        <h2 style={{ marginBottom: 6 }}>Start from a safety need</h2>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          NASA's fire-safety work rests on prevention, detection and suppression. Pick the question you are working on;
          the ranking, map and extracts adapt to it.
        </p>
        <div className="needs">
          {NEEDS.map((n) => (
            <button key={n.id} className="need-card" onClick={() => start(n.preset)}>
              <h3>{n.title}</h3>
              <p>{n.body}</p>
              <span className="lead">{n.lead}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>What the data do not cover yet</h2>
        <p className="sub">
          Future habitats will run richer, thinner atmospheres than the ISS. Counting PSI tests whose reported O2 and
          pressure both fall inside each candidate atmosphere shows where the evidence stops.
        </p>
        {cov.loading && <Loading what="Computing coverage" />}
        {cov.data && (
          <div className="panel-flat">
            {cov.data.gaps.map((g) => (
              <div className="gapline" key={g.habitat.id}>
                <div>
                  <div className="name">{g.habitat.name}</div>
                  <div className="faint small">
                    {g.habitat.o2_pct_min}–{g.habitat.o2_pct_max} % O2, {g.habitat.pressure_kpa_min}–{g.habitat.pressure_kpa_max} kPa
                  </div>
                  <div className={`n ${g.n_inside === 0 ? "zero" : ""}`}>{g.n_inside} tests</div>
                </div>
                <div className="small muted">
                  {g.summary}
                  <div className="faint" style={{ marginTop: 4 }}>Source of the envelope: {g.habitat.source}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>Why it matters</h2>
        <p className="sub">Fire has shaped human spaceflight since its first crewed missions.</p>
        <div className="timeline">
          {HISTORY.map((h) => (
            <div key={h.yr}>
              <div className="yr">{h.yr}</div>
              <p>{h.text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
