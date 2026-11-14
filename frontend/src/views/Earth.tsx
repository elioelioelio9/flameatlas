import { api } from "../api";
import { ErrorBox, Loading, PageHead } from "../components/ui";
import { useApp, useAsync } from "../state";

export default function Earth() {
  const { data, error, loading } = useAsync(() => api.earth(), []);
  const { openDrawer, byAcc } = useApp();
  return (
    <>
      <PageHead title="On Earth">
        Microgravity strips buoyancy out of a fire, which makes flames simpler to measure and to model. Some of what
        PSI learned can transfer to confined places on Earth — each card says what still has to be validated first.
      </PageHead>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      <div className="grid-3">
        {(data ?? []).map((e) => (
          <article className="earth-card" key={e.id}>
            <span className="faint small">{e.domain}</span>
            <h3>{e.title}</h3>
            <div className="pair">
              <div><b>Potential contribution.</b> {e.contribution}</div>
              <div className="need"><b>Validation needed.</b> {e.validation_needed}</div>
            </div>
            <div className="row">
              {e.sources.map((s, i) => s.accession ? (
                <button key={i} className="btn small ghost" onClick={() => openDrawer(s.accession!)}>{byAcc[s.accession]?.acronym ?? s.accession}</button>
              ) : <a key={i} className="small" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>)}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
