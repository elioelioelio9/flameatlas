import { Fragment, useEffect } from "react";
import { api } from "../api";
import { useApp, useAsync } from "../state";
import { Doi, ErrorBox, EvidenceBadge, Loading, NEED_LABEL, bytes, fmt, range } from "./ui";
import type { Need } from "../types";

export default function Drawer() {
  const { drawer, openDrawer, setExtractIds, go } = useApp();
  const { data, error, loading } = useAsync(() => (drawer ? api.investigation(drawer) : Promise.resolve(null)), [drawer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openDrawer(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDrawer]);

  if (!drawer) return null;
  const p = data?.profile;
  return (
    <>
      <div className="drawer-backdrop" onClick={() => openDrawer(null)} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Investigation ${drawer}`}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="faint small">{drawer}</span>
          <button className="btn small ghost" onClick={() => openDrawer(null)}>Close</button>
        </div>
        {loading && <Loading />}
        {error && <ErrorBox error={error} />}
        {data && p && (
          <>
            <h2 style={{ marginTop: 6 }}>{data.acronym ? `${data.acronym} — ` : ""}{data.title}</h2>
            <div className="row" style={{ margin: "8px 0 14px" }}>
              <Doi doi={data.doi} />
              <a className="small" href={data.psi_url} target="_blank" rel="noreferrer">Open in NASA PSI</a>
              {!data.in_scope && <span className="badge mismatch">Out of scope</span>}
            </div>
            <p className="muted">{data.summary}</p>
            <div className="row" style={{ margin: "12px 0" }}>
              <button className="btn small" onClick={() => { setExtractIds([data.accession]); openDrawer(null); go("data"); }}>
                Extract its data
              </button>
            </div>

            <h4>At a glance</h4>
            <dl className="kv">
              <dt>Platform</dt><dd>{data.flight_platform ?? "—"}{data.hardware ? `, ${data.hardware}` : ""}</dd>
              <dt>Period</dt><dd>{data.start_date ?? "?"} → {data.end_date ?? "?"}</dd>
              <dt>Configuration</dt><dd>{data.configuration ?? "—"}</dd>
              <dt>Scale</dt><dd>{data.scale ?? "—"}</dd>
              <dt>Serves</dt><dd>{Object.entries(data.needs).map(([k, v]) => `${NEED_LABEL[k as Need]} (${fmt(v as number, 1)})`).join(", ") || "—"}</dd>
              <dt>Records</dt><dd>{Object.entries(p.record_types).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") || "no experimental table"}</dd>
              <dt>O2 (ambient)</dt><dd>{range(p.ranges.o2_mole_frac, 100, " %")}</dd>
              {p.ranges.o2_oxidizer_stream && <><dt>O2 (oxidizer stream)</dt><dd>{range(p.ranges.o2_oxidizer_stream, 100, " %")}</dd></>}
              <dt>Pressure</dt><dd>{range(p.ranges.pressure_kpa, 1, " kPa")}</dd>
              <dt>Flow</dt><dd>{range(p.ranges.flow_cm_s, 1, " cm/s")}</dd>
              <dt>Sensors</dt><dd>{data.sensors.join(", ") || "—"}</dd>
              <dt>Files in PSI</dt><dd>{bytes(data.total_file_bytes)} — {Object.entries(data.file_categories).map(([k, v]) => `${k} (${v.n})`).join(", ")}</dd>
            </dl>

            {data.variation.varied.length > 0 && (
              <>
                <h4>How tests differed / what stayed fixed</h4>
                <dl className="kv">
                  {data.variation.varied.map((v) => (
                    <Fragment key={v.variable}><dt>{v.variable}</dt><dd>{v.min !== undefined ? `${fmt(v.min, 3)} – ${fmt(v.max, 3)} (${v.n_levels} levels)` : `${v.n_levels} values: ${(v.examples ?? []).join(", ")}`}</dd></Fragment>
                  ))}
                  {data.variation.fixed.map((v) => (<Fragment key={v.variable}><dt>{v.variable}</dt><dd>fixed: {String(v.value)}</dd></Fragment>))}
                  {data.variation.not_reported.length > 0 && <><dt>Not reported</dt><dd className="faint">{data.variation.not_reported.join(", ")}</dd></>}
                </dl>
              </>
            )}

            {data.insights.length > 0 && (
              <>
                <h4>Safety insights</h4>
                {data.insights.map((i) => (
                  <div key={i.id} style={{ marginBottom: 10 }}>
                    <EvidenceBadge kind={i.evidence_kind} /> <b>{i.title}</b>
                    <div className="small muted">{i.observation}</div>
                  </div>
                ))}
              </>
            )}

            {[["Objective", data.objective], ["Approach", data.approach], ["Hypothesis", data.hypothesis], ["Research impacts / Earth benefits", data.research_impacts]]
              .filter(([, t]) => t).map(([h, t]) => (<div key={h}><h4>{h}</h4><div className="text">{t}</div></div>))}

            {data.publications.length > 0 && (
              <>
                <h4>Publications ({data.publications.length})</h4>
                <ul className="small muted" style={{ paddingLeft: 18 }}>
                  {data.publications.slice(0, 12).map((pub, i) => (
                    <li key={i}>{pub.title}{pub.doi ? <> — <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer">{pub.doi}</a></> : null}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="faint small" style={{ marginTop: 20 }}>
              PSI version {data.psi_version}, licence {data.license}. Cite this dataset with its DOI.
            </p>
          </>
        )}
      </aside>
    </>
  );
}
