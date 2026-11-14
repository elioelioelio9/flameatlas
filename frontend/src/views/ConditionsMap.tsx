import { useMemo, useState } from "react";
import { api } from "../api";
import Scatter, { groupColors, type Pt, type Rect } from "../components/Scatter";
import { ErrorBox, Loading, PageHead, fmt } from "../components/ui";
import { useApp, useAsync } from "../state";

const TONE: Record<string, Rect["tone"]> = { documented: "ug", planning_assumption: "amber", hypothetical: "violet" };

export default function ConditionsMap() {
  const { scenario, openDrawer } = useApp();
  const [oxidizer, setOxidizer] = useState(false);
  const { data, error, loading } = useAsync(() => api.coverage(oxidizer), [oxidizer]);
  const [phase, setPhase] = useState<string>("");

  const view = useMemo(() => {
    if (!data) return null;
    const pts = data.points.filter((p) => !phase || p.fuel_phase === phase);
    const groups = Array.from(new Set(data.points.map((p) => p.acronym))).sort();
    const colors = groupColors(groups);
    const points: Pt[] = pts.map((p) => ({
      x: p.o2_pct, y: p.pressure_kpa, group: p.acronym, id: p.test_id, hollow: p.oxidizer_stream,
      info: (
        <>
          <b>{p.acronym}</b> <span className="faint">{p.test_id}</span><br />
          {p.fuel} ({p.fuel_phase})<br />
          O2 {fmt(p.o2_pct, 1)} %{p.oxidizer_stream ? " (oxidizer stream)" : ""}, {fmt(p.pressure_kpa, 1)} kPa<br />
          {p.outcome_class ? <>Outcome: {p.outcome_class.replace(/_/g, " ")}</> : <span className="faint">No outcome in table</span>}
        </>
      ),
    }));
    const SHOW: Record<string, { label: string; below?: boolean; right?: boolean }> = {
      iss: { label: "ISS / Earth cabin" },
      exploration_26: { label: "10.2 psia, 26.5 %", right: true },
      exploration_34: { label: "8.2 psia, 34 %", below: true },
      lunar_base: { label: "Moon base / rover (planning)" },
    };
    const rects: Rect[] = data.habitats.filter((h) => SHOW[h.id]).map((h) => ({
      x0: h.o2_pct_min, x1: h.o2_pct_max, y0: h.pressure_kpa_min, y1: h.pressure_kpa_max,
      label: SHOW[h.id].label, labelBelow: SHOW[h.id].below, labelRight: SHOW[h.id].right, tone: TONE[h.status] ?? "ug",
    }));
    if (scenario.o2_pct != null && scenario.pressure_kpa != null) {
      rects.push({ x0: scenario.o2_pct - 1, x1: scenario.o2_pct + 1, y0: scenario.pressure_kpa - 5, y1: scenario.pressure_kpa + 5, label: "Your scenario", tone: "grey" });
    }
    return { points, rects, colors };
  }, [data, phase, scenario.o2_pct, scenario.pressure_kpa]);

  return (
    <>
      <PageHead title="Conditions map">
        Every PSI test with a reported ambient O2 and pressure, against the atmospheres planned for crewed habitats.
        Dashed boxes are habitat envelopes; empty boxes are where new experiments are needed.
      </PageHead>
      {error && <ErrorBox error={error} />}
      {loading && !data && <Loading what="Loading coverage" />}
      {data && view && (
        <div className="mapwrap">
          <div>
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="segmented" role="group" aria-label="Fuel phase">
                {["", "liquid", "gas", "solid"].map((p) => (
                  <button key={p || "all"} aria-pressed={phase === p} onClick={() => setPhase(p)}>{p || "All fuels"}</button>
                ))}
              </div>
              <label className="check">
                <input type="checkbox" checked={oxidizer} onChange={(e) => setOxidizer(e.target.checked)} />
                Show inverse flames (O2 of the burner stream, hollow markers)
              </label>
            </div>
            <Scatter points={view.points} rects={view.rects} colors={view.colors} xLabel="O2 in the atmosphere (%)"
                     yLabel="Pressure (kPa)" xDomain={oxidizer ? [10, 90] : [10, 42]} yDomain={[30, 330]} />
            <p className="faint small" style={{ marginTop: 6 }}>Boxes: blue = atmosphere documented in PSI-20, amber = planning assumption from the challenge statement. Mars and spacesuit envelopes are listed on the right (the suit, 100 % O2, is off this chart).</p>
            {phase === "solid" && view.points.length === 0 && (
              <div className="empty" style={{ marginTop: 10 }}>
                No solid-fuel test in PSI reports both O2 and pressure. Solid-fuel tables give O2 only — see the strip below.
              </div>
            )}
            <div className="o2strip panel-flat">
              <h3 style={{ marginBottom: 4 }}>Tests with O2 but no pressure in the table</h3>
              <p className="faint small">These cannot be placed on the map; each tick is a reported O2 level.</p>
              {data.o2_only.map((o) => (
                <div className="line" key={o.accession}>
                  <button className="btn ghost small" style={{ justifyContent: "flex-start" }} onClick={() => openDrawer(o.accession)}>
                    {o.acronym} <span className="faint">({o.fuel_phase})</span>
                  </button>
                  <svg viewBox="0 0 600 20" preserveAspectRatio="none" style={{ width: "100%", height: 20 }}>
                    <line x1={0} x2={600} y1={10} y2={10} stroke="#2c2f31" />
                    {data.habitats.filter((h) => h.o2_pct_max <= 45).map((h) => (
                      <rect key={h.id} x={((h.o2_pct_min - 10) / 32) * 600} width={((h.o2_pct_max - h.o2_pct_min) / 32) * 600} y={2} height={16} fill="#F0F0ED" opacity={0.06} />
                    ))}
                    {o.o2_pct.map((v) => <rect key={v} x={((v - 10) / 32) * 600 - 1} y={3} width={2.4} height={14} fill={view.colors[o.acronym] ?? "#F0F0ED"} />)}
                  </svg>
                </div>
              ))}
              <div className="line faint small"><span /><div className="row" style={{ justifyContent: "space-between" }}><span>10 %</span><span>21 %</span><span>34 %</span><span>42 %</span></div></div>
            </div>
          </div>
          <aside>
            <h3 style={{ marginBottom: 10 }}>Gap analysis by habitat</h3>
            {data.gaps.map((g) => (
              <div className="gapcard" key={g.habitat.id}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h4>{g.habitat.name}</h4>
                  <span className={`badge ${g.n_inside === 0 ? "mismatch" : "ug"}`}>{g.n_inside} tests</span>
                </div>
                <div className="faint small">{g.habitat.o2_pct_min}–{g.habitat.o2_pct_max} % O2, {g.habitat.pressure_kpa_min}–{g.habitat.pressure_kpa_max} kPa, {g.habitat.gravity}</div>
                <p className="small muted" style={{ margin: "6px 0 4px" }}>{g.summary}</p>
                <div className="faint small">Envelope: {g.habitat.status.replace("_", " ")} — {g.habitat.source}</div>
              </div>
            ))}
            <p className="faint small" style={{ marginTop: 12 }}>{data.notes.join(" ")}</p>
          </aside>
        </div>
      )}
    </>
  );
}
