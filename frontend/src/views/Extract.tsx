import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Scatter, { type Pt } from "../components/Scatter";
import { ErrorBox, Loading, PageHead, fmt } from "../components/ui";
import { useApp, useAsync } from "../state";
import type { ExtractRequest, ExtractResponse } from "../types";

const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

function FlexCase() {
  const { data, error, loading } = useAsync(() => api.flex(), []);
  if (loading) return <Loading what="Computing the FLEX reference analysis" />;
  if (error) return <ErrorBox error={error} />;
  const pts: Pt[] = data.points
    .filter((p: any) => p.k_mm2_s != null && p.o2_pct != null)
    .map((p: any) => ({
      x: p.o2_pct, y: p.k_mm2_s, id: p.test_id, group: `${p.fuel} / ${p.diluent}`,
      info: (<><b>{p.label}</b> (row {p.source_row})<br />{p.fuel}, {p.diluent}, {fmt(p.pressure_kpa, 0)} kPa<br />
        K = {p.k_mm2_s} mm²/s, D0 = {p.d0_mm} mm<br />End: {p.outcome}</>),
    }));
  const fits = Object.entries(data.fits_k_vs_o2_1atm_n2).map(([fuel, f]: [string, any]) => ({ group: `${fuel} / N2 only`, ...f }));
  const byFuel: Record<string, any[]> = {};
  data.outcome_table.forEach((r: any) => { (byFuel[`${r.fuel} / ${r.diluent}`] ||= []).push(r); });
  return (
    <section className="section">
      <h2>Reference analysis: FLEX droplet extinction</h2>
      <p className="sub">
        The cleanest quantitative series in PSI: {data.n_tests} droplet tests with fuel, O2, pressure, CO2/He dilution,
        burning-rate constant and end state. Lines are descriptive fits (N2-only, ~1 atm) shown only over the measured O2 range.
      </p>
      <div className="grid-2">
        <Scatter points={pts} fits={fits} xLabel="O2 mole fraction (%)" yLabel="Burning-rate constant K (mm²/s)" height={380} />
        <div className="table-wrap" style={{ maxHeight: 440 }}>
          <table className="data">
            <thead><tr><th>Fuel / atmosphere</th><th className="num">O2 %</th><th className="num">n</th><th className="num">Extinction</th><th className="num">Burnout</th><th className="num">Disruption</th></tr></thead>
            <tbody>
              {Object.entries(byFuel).flatMap(([k, rows]) => rows.map((r: any, i: number) => (
                <tr key={`${k}-${r.o2_pct}`}>
                  <td>{i === 0 ? k : ""}</td><td className="num">{r.o2_pct}</td><td className="num">{r.n}</td>
                  <td className="num">{r.extinction ?? 0}</td><td className="num">{r.completion ?? 0}</td><td className="num">{r.disruption ?? 0}</td>
                </tr>)))}
            </tbody>
          </table>
        </div>
      </div>
      <ul className="small faint" style={{ paddingLeft: 18, marginTop: 10 }}>
        {Object.entries(data.fits_k_vs_o2_1atm_n2).map(([fuel, f]: [string, any]) => (
          <li key={fuel}>{fuel}: K ≈ {fmt(f.intercept, 3)} + {fmt(f.slope, 4)} × O2% (n = {f.n}, R² = {fmt(f.r2, 2)}, valid {f.x_min}–{f.x_max} %)</li>
        ))}
        {data.reading_guide.map((g: string) => <li key={g}>{g}</li>)}
      </ul>
    </section>
  );
}

export default function Extract() {
  const { investigations, extractIds, setExtractIds } = useApp();
  const [req, setReq] = useState<ExtractRequest>({ accessions: extractIds, record_types: ["test"], exclude_flags: ["o2_is_oxidizer_stream_not_ambient"] });
  const [res, setRes] = useState<ExtractResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const [x, setX] = useState("o2_pct");
  const [y, setY] = useState("m:burning_rate_constant");

  useEffect(() => { setReq((r) => ({ ...r, accessions: extractIds })); }, [extractIds]);
  useEffect(() => {
    if (!req.accessions.length) { setRes(null); return; }
    setError(null);
    api.preview(req, 60).then(setRes).catch((e: Error) => setError(e.message));
  }, [JSON.stringify(req)]);

  const vars = useAsync(() => api.variables(req.accessions), [req.accessions.join(",")]);
  const scat = useAsync(() => (req.accessions.length ? api.scatter(x, y, req.accessions, req.accessions.length === 1 ? "fuel" : "accession") : Promise.resolve(null)), [x, y, req.accessions.join(",")]);

  const usable = useMemo(() => investigations.filter((i) => i.in_scope && i.profile.n_records > 0)
    .sort((a, b) => (a.acronym ?? a.accession).localeCompare(b.acronym ?? b.accession)), [investigations]);
  const toggle = (acc: string) => setExtractIds(extractIds.includes(acc) ? extractIds.filter((a) => a !== acc) : [...extractIds, acc]);
  const set = (p: Partial<ExtractRequest>) => setReq((r) => ({ ...r, ...p }));

  const download = async () => {
    setBusy(true);
    try {
      const { blob, filename, rows } = await api.exportZip(req);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      setDownloaded(`${filename} — ${rows} rows`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const scatterPts: Pt[] = (scat.data?.points ?? []).map((p) => ({
    x: p.x, y: p.y, group: p.group, id: p.test_id,
    info: <><b>{p.test_id}</b><br />{p.fuel}{p.outcome ? `, ${p.outcome}` : ""}<br />row {p.source_row}</>,
  }));
  const fitLines = Object.entries(scat.data?.fits ?? {}).map(([g, f]) => ({ group: g, ...f }));
  const label = (id: string) => vars.data?.plottable.find((v) => v.id === id);

  return (
    <>
      <PageHead title="Extract data" actions={
        <button className="btn primary" onClick={download} disabled={busy || !res?.total}>
          {busy ? "Preparing…" : `Download ${res?.total ?? 0} rows (ZIP)`}
        </button>}>
        Build a modelling-ready table across investigations. The download contains the data, a data dictionary with
        units, the provenance of every row (PSI file, row, DOI), the filters and conversions applied, and the known limitations.
      </PageHead>
      {downloaded && <p className="small" style={{ color: "var(--match)" }}>Downloaded {downloaded}.</p>}
      <div className="extract">
        <aside className="stack">
          <div className="panel">
            <div className="small faint" style={{ marginBottom: 6 }}>Investigations with tabular data</div>
            <div className="acc-list">
              {usable.map((i) => (
                <label key={i.accession}>
                  <input type="checkbox" checked={extractIds.includes(i.accession)} onChange={() => toggle(i.accession)} />
                  <span>{i.acronym ?? i.accession}<br /><span className="faint">{i.fuel_phases.join(", ")}</span></span>
                  <span className="n">{i.profile.n_records}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="panel stack">
            <div className="grid-2" style={{ gap: 10 }}>
              <label className="field">O2 min (%)<input type="number" value={req.o2_pct_min ?? ""} onChange={(e) => set({ o2_pct_min: num(e.target.value) })} /></label>
              <label className="field">O2 max (%)<input type="number" value={req.o2_pct_max ?? ""} onChange={(e) => set({ o2_pct_max: num(e.target.value) })} /></label>
              <label className="field">Pressure min (kPa)<input type="number" value={req.pressure_kpa_min ?? ""} onChange={(e) => set({ pressure_kpa_min: num(e.target.value) })} /></label>
              <label className="field">Pressure max (kPa)<input type="number" value={req.pressure_kpa_max ?? ""} onChange={(e) => set({ pressure_kpa_max: num(e.target.value) })} /></label>
            </div>
            <label className="field">Fuel phase
              <select value={req.fuel_phase ?? ""} onChange={(e) => set({ fuel_phase: e.target.value || null })}>
                <option value="">Any</option><option value="solid">Solid</option><option value="liquid">Liquid</option><option value="gas">Gas</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={req.record_types.includes("session")}
                     onChange={(e) => set({ record_types: e.target.checked ? ["test", "session", "test_matrix"] : ["test"] })} />
              Include session and test-matrix records
            </label>
            <label className="check">
              <input type="checkbox" checked={(req.exclude_flags ?? []).includes("o2_is_oxidizer_stream_not_ambient")}
                     onChange={(e) => set({ exclude_flags: e.target.checked ? ["o2_is_oxidizer_stream_not_ambient"] : [] })} />
              Exclude inverse flames (O2 not ambient)
            </label>
          </div>
        </aside>
        <section>
          {error && <ErrorBox error={error} />}
          {!req.accessions.length && <div className="empty">Select one or more investigations to preview their data.</div>}
          {res && (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="small muted">{res.total} rows from {res.accessions.join(", ")}; preview of the first {res.rows.length}. Empty cells are not reported, never zero.</span>
              </div>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr>{res.columns.filter((c) => !["record_type", "gravity", "doi", "source_file"].includes(c)).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                  <tbody>
                    {res.rows.map((r) => (
                      <tr key={String(r.test_id)}>
                        {res.columns.filter((c) => !["record_type", "gravity", "doi", "source_file"].includes(c)).map((c) => {
                          const v = r[c];
                          return <td key={c} className={v === null || v === "" ? "null" : typeof v === "number" ? "num" : ""}>{v === null || v === "" ? "—" : typeof v === "number" ? fmt(v, 4) : String(v)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {req.accessions.length > 0 && vars.data && (
            <div className="section" style={{ marginTop: 26 }}>
              <h3 style={{ marginBottom: 8 }}>Explore relationships</h3>
              <div className="row" style={{ marginBottom: 10 }}>
                <label className="field" style={{ minWidth: 220 }}>X
                  <select value={x} onChange={(e) => setX(e.target.value)}>
                    {vars.data.plottable.map((v) => <option key={v.id} value={v.id}>{v.label}{v.unit ? ` (${v.unit})` : ""}</option>)}
                  </select>
                </label>
                <label className="field" style={{ minWidth: 220 }}>Y
                  <select value={y} onChange={(e) => setY(e.target.value)}>
                    {vars.data.plottable.map((v) => <option key={v.id} value={v.id}>{v.label}{v.unit ? ` (${v.unit})` : ""}</option>)}
                  </select>
                </label>
              </div>
              {scat.data && scat.data.n > 0 ? (
                <Scatter points={scatterPts} fits={fitLines} height={360}
                         xLabel={`${label(x)?.label ?? x}${label(x)?.unit ? ` (${label(x)?.unit})` : ""}`}
                         yLabel={`${label(y)?.label ?? y}${label(y)?.unit ? ` (${label(y)?.unit})` : ""}`} />
              ) : <div className="empty">No test reports both variables for this selection. Pick other variables or investigations.</div>}
              {scat.data && scat.data.n > 0 && <p className="faint small">{scat.data.n} tests plotted. Dashed lines: descriptive least-squares per investigation, inside the measured range only — not predictive models.</p>}
            </div>
          )}
        </section>
      </div>
      <FlexCase />
    </>
  );
}
