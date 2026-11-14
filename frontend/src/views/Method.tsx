import { Doi, PageHead } from "../components/ui";
import { useApp } from "../state";

export default function Method() {
  const { investigations, meta, openDrawer } = useApp();
  return (
    <>
      <PageHead title="Method & sources">
        How Fire Lab turns NASA records into rankings, maps and extracts — and where its limits are.
      </PageHead>
      <div className="prose">
        <h3>Data</h3>
        <p>
          The corpus is every investigation returned by the NASA Physical Sciences Informatics (PSI) repository for
          combustion-related searches, retrieved through PSI's public API with each investigation's experimental-table
          CSV files. PSI data are released under CC0-1.0. Built {meta?.database.built_at ?? "—"}.
        </p>
        <p>
          Records are kept at three levels: <b>investigation</b> (a science programme, cited by DOI), <b>test</b> (one run,
          session or test-matrix row, with its source file and row number) and <b>measurement</b> (one reported quantity
          with its unit and source column). Units are converted to kPa, cm/s, mm and mole fraction. A value missing from
          a table stays empty — it is never set to zero or guessed.
        </p>
        <p>
          Every interpretation made while parsing is recorded as a quality flag on the row, for example
          <code>assumed_unit_cm_s</code>, <code>typo_corrected_percent</code> ('3400%' read as 34 %) or
          <code>o2_is_oxidizer_stream_not_ambient</code> (inverse flames, where O2 flows from the burner). Two PSI
          investigations matched the search only by keyword (solders, thermocapillary flow) and are kept but marked out of scope.
        </p>

        <h3>Fire simulation model</h3>
        <p>
          The simulation solves the flow in four habitats on a uniform 3-D grid (16–20 cm cells): the ISS Node 1 → US Lab → Node 2
          (92 × 13 × 13 cells), a Moon base with lab, crew quarters and airlock (62 × 15 × 20), a two-deck Mars habitat
          (30 × 24 × 30 cells of 20 cm, round hull) and a conical crew capsule on the launch pad at 1 g (32 × 21 × 32). Bulkheads, partitions, benches, bunks and decks are solid cells;
          hatches and doors are openings you can close. The 3-D interior is generated from the same grid, so what you see is what the flow sees.
        </p>
        <ul>
          <li><b>Flow</b>: ∂u/∂t + (u·∇)u = −∇p/ρ + g ΔT/T ŷ + f<sub>vc</sub>, with ∇·u = S. The source S = (1/T) DT/Dt of the burning cells is the
            low-Mach thermal expansion of burnt gas: it pushes air away from a flame even in orbit, where buoyancy is zero. Stam's stable-fluids scheme:
            semi-Lagrangian momentum advection, pressure projection solved by conjugate gradients with a modified incomplete Cholesky preconditioner (warm-started), optional vorticity confinement f<sub>vc</sub>.
            With the fans off the cabin is sealed: the net expansion becomes a uniform pressure rise, reported in the diagnostics.</li>
          <li><b>Transport</b>: heat and smoke use second-order MacCormack advection with min/max clamping (sharper plumes), O₂ and CO₂ first-order;
            diffusivity grows as pressure falls (∝ p<sup>−½</sup>). Supply vents impose their airflow and fresh-air composition; return grilles are open boundaries.</li>
          <li><b>Fire</b>: up to four fuel panels on solid surfaces burn the O₂ above the material's limit (surface cell and the gas cell just off it), releasing
            heat, CO₂ and smoke. Burning spreads to neighbouring fuel cells, faster downstream and uphill, stops when a cell's fuel load is used, and goes out
            when the local burning rate stays below a critical value for 2 s (radiative-loss extinction). A CO₂ extinguisher dilutes O₂ and cools within ~0.5 m.</li>
          <li><b>Checks</b>: the maximum of |∇·u − S| after projection, the CFL number and the kinetic energy are shown live; vectors, streamlines (RK2) and the probe
            interpolate the computed velocity field trilinearly — nothing is drawn that the solver did not compute.</li>
        </ul>
        <p>
          Constants were tuned so the model reproduces the <i>qualitative</i> trends in the NASA data: in still air at 21 % O₂ a microgravity flame starves and
          goes out, at 34 % / 56.5 kPa it keeps burning (ACME BRE, FLEX); with ventilation it creeps as a front (BASS, SAFFIRE); Nomex resists at 21 %;
          at 1 g the plume rises and the fuel burns out fast. It is <b>not a validated fire code</b>: temperatures are model values and times are indicative.
        </p>

        <h3>Knowledge engine</h3>
        <p>
          The knowledge graph is stored next to the evidence database (SQLite): documents, passages (FTS5 index), extracted values, nodes, typed edges and
          research results. Concepts and entities come from a controlled bilingual vocabulary; a <i>mentions</i> link exists only where a passage contains the term,
          and that passage is stored as evidence. <i>Measures</i> links carry the count and range of values from the test tables. <i>Shares concept</i> links are
          marked as inferred. Research combines BM25, TF-IDF and the graph, keeps only retrieved passages as sources, and refuses to answer without evidence.
          Obsidian works through its real format — a folder of Markdown notes with frontmatter and wikilinks — so the vault can be exported, written into a
          local folder, or imported back. Uploaded documents are data only: instructions inside them are never followed.
        </p>

        <h3>Ranking</h3>
        <p>Three scores, combined with fixed weights, are always shown separately:</p>
        <ul>
          <li><b>Relevance (50 %)</b>: how central the selected need is to the investigation (a curated, visible weight from 0 to 1), blended with the text match to your question.</li>
          <li><b>Condition fit (30 %)</b>: computed from the tested ranges in the data, factor by factor. Covered = 1, close = 0.55, bounded only = 0.5, not reported = 0.3, outside range = 0.1. Partial gravity is never scored as covered, because PSI has no lunar or martian data.</li>
          <li><b>Data readiness (20 %)</b>: whether test-level records exist, how many, and whether the variables needed for the selected need are present.</li>
        </ul>
        <p>The language model never computes or changes a score.</p>

        <h3>Search and Ask</h3>
        <p>
          Questions in English or French are parsed by rules for the need, fuel phase, gravity, habitat, O2, pressure
          and flow. Passages are retrieved by fusing two rankings: SQLite FTS5 / BM25 with stemming, and TF-IDF cosine
          similarity on words and character n-grams. Answers may cite only the numbered sources they are given. Without
          an API key, Fire Lab returns an extractive answer quoted from those sources.
        </p>

        <h3>What Fire Lab does not do</h3>
        <ul>
          <li>It does not predict whether a given material will burn. Fits are descriptive, within the measured range.</li>
          <li>It does not turn single observations into procedures; insight cards pose design questions.</li>
          <li>Summary tables omit many results (spread rates, particle sizes) that exist only in raw PSI files.</li>
          <li>Habitat envelopes for the Moon and Mars are planning assumptions taken from the challenge statement and PSI-20, labelled as such.</li>
        </ul>

        <h3>Use of AI</h3>
        <p>
          Fire Lab was built with help from an AI coding assistant. In the product, an optional language model only
          rephrases retrieved passages and computed numbers, with mandatory citations. All rankings, statistics, unit
          conversions and exports are deterministic Python.
        </p>
      </div>

      <section className="section">
        <h2>Datasets</h2>
        <p className="sub">Cite each dataset you use with its DOI.</p>
        <div className="table-wrap" style={{ maxHeight: "none" }}>
          <table className="data">
            <thead><tr><th>PSI</th><th>Investigation</th><th>Type</th><th className="num">Records</th><th>DOI</th><th>Scope</th></tr></thead>
            <tbody>
              {investigations.map((i) => (
                <tr key={i.accession}>
                  <td><button className="btn small ghost" onClick={() => openDrawer(i.accession)}>{i.accession}</button></td>
                  <td>{i.acronym ? <b>{i.acronym} </b> : null}{i.title}</td>
                  <td className="faint">{i.project_type}</td>
                  <td className="num">{i.profile.n_records}</td>
                  <td><Doi doi={i.doi} /></td>
                  <td>{i.in_scope ? <span className="badge match">in scope</span> : <span className="badge mismatch" title={i.scope_note ?? ""}>out of scope</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="section prose">
        <h3>Image credits</h3>
        <p>All photographs are authentic NASA images from the NASA Image and Video Library: GRC-1998-C-00485 (candle in 1 g and microgravity),
          ISS035-E-016429 and ISS040-E-072900 (BASS, BASS-II), JSC2023E046631 (Saffire-IV), GRC-2016-C-05051 (ACME), ISS042-E-021318 (Destiny).
          Simulation backdrops: Apollo 17 Taurus-Littrow panorama (JSC2004E20304), Curiosity Mastcam panorama (PIA25176, NASA/JPL-Caltech/MSSS), ISS Earth limb (ISS040-E-080833), JSC mockup facility (JSC2013E028042). Planet textures: NASA Blue Marble, LRO LROC WAC colour mosaic, Viking MDIM 2.1 (NASA / JPL / USGS). ISS model: NASA 3D Resources.
          Full provenance in <code>docs/CREDITS.md</code>.</p>
      </section>
    </>
  );
}
