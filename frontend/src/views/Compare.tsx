import type { ReactNode } from "react";
import { api } from "../api";
import { Doi, ErrorBox, Loading, NEED_LABEL, PageHead, range } from "../components/ui";
import { useApp, useAsync } from "../state";
import type { Need } from "../types";

export default function Compare() {
  const { compareIds, toggleCompare, investigations, openDrawer } = useApp();
  const { data, error, loading } = useAsync(
    () => (compareIds.length ? api.compare(compareIds) : Promise.resolve({ items: [], shared_varied_variables: [] })),
    [compareIds.join(",")]);
  const shared: string[] = data?.shared_varied_variables ?? [];
  const items: any[] = data?.items ?? [];

  const rows: { label: string; render: (it: any) => ReactNode }[] = [
    { label: "Dataset", render: (it) => <><Doi doi={it.doi} /><br /><button className="btn small ghost" onClick={() => openDrawer(it.accession)}>Details</button></> },
    { label: "Platform", render: (it) => `${it.platform ?? "—"}${it.hardware ? `, ${it.hardware}` : ""}` },
    { label: "Fuel phase", render: (it) => it.fuel_phases.join(", ") || "—" },
    { label: "Configuration", render: (it) => it.configuration },
    { label: "Scale", render: (it) => it.scale },
    { label: "Serves", render: (it) => Object.entries(it.needs).map(([k, v]) => `${NEED_LABEL[k as Need]} (${(v as number).toFixed(1)})`).join(", ") || "—" },
    { label: "Records", render: (it) => Object.entries(it.record_types).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") || "none" },
    { label: "O2 range", render: (it) => it.ranges.o2_pct ? range(it.ranges.o2_pct, 1, " %") : <span className="faint">not reported</span> },
    { label: "Pressure range", render: (it) => it.ranges.pressure_kpa ? range(it.ranges.pressure_kpa, 1, " kPa") : <span className="faint">not reported</span> },
    { label: "Flow range", render: (it) => it.ranges.flow_cm_s ? range(it.ranges.flow_cm_s, 1, " cm/s") : <span className="faint">not reported</span> },
    {
      label: "Varied between tests",
      render: (it) => it.variation.varied.length ? it.variation.varied.map((v: any) => (
        <span key={v.variable} className={`tag ${shared.includes(v.variable) ? "shared" : ""}`} title={v.min !== undefined ? `${v.min}–${v.max}` : (v.examples ?? []).join(", ")}>
          {v.variable} ({v.n_levels})
        </span>)) : <span className="faint">—</span>,
    },
    { label: "Held constant", render: (it) => it.variation.fixed.map((v: any) => <span key={v.variable} className="tag">{v.variable}: {String(v.value)}</span>) },
    { label: "Not reported", render: (it) => <span className="faint">{it.variation.not_reported.join(", ")}</span> },
    { label: "Outcomes recorded", render: (it) => Object.entries(it.outcomes).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") || <span className="faint">none in table</span> },
    { label: "Measured quantities", render: (it) => it.measured.map((m: any) => <span key={m.quantity} className="tag">{m.quantity.replace(/_/g, " ")}</span>) },
    { label: "Sensors", render: (it) => it.sensors.join(", ") || "—" },
    { label: "Key variables (curated)", render: (it) => it.key_variables.join(", ") },
  ];

  return (
    <>
      <PageHead title="Compare experiments">
        Up to four investigations side by side: what changed between their tests, what stayed fixed and what was
        measured. Variables varied by every selected investigation are outlined — that is where results can be compared directly.
      </PageHead>
      <div className="panel-flat" style={{ marginBottom: 16 }}>
        <div className="small faint" style={{ marginBottom: 8 }}>Selected ({compareIds.length}/4) — click to add or remove</div>
        <div className="row">
          {investigations.filter((i) => i.in_scope).map((i) => (
            <button key={i.accession} className={`btn small ${compareIds.includes(i.accession) ? "on" : "ghost"}`} onClick={() => toggleCompare(i.accession)}
                    aria-pressed={compareIds.includes(i.accession)}>
              {i.acronym ?? i.accession}
            </button>
          ))}
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {items.length === 0 && !loading && <div className="empty">Select at least one investigation above.</div>}
      {items.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: "none" }}>
          <table className="compare">
            <thead>
              <tr>
                <th />
                {items.map((it) => <th key={it.accession} scope="col">{it.acronym ?? it.accession}<div className="faint small" style={{ fontFamily: "var(--font)", fontWeight: 400 }}>{it.title}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {items.map((it) => <td key={it.accession}>{r.render(it)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {shared.length > 0 && <p className="small muted" style={{ marginTop: 10 }}>Varied in all selected investigations: {shared.join(", ")}.</p>}
    </>
  );
}
