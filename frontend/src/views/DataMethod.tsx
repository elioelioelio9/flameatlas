import Extract from "./Extract";
import Method from "./Method";
import Theory from "./Theory";

/** Data & method: what this page is for, the physics with worked numbers, the export tool, then how every number was obtained. */
export default function DataMethod() {
  return (
    <div className="datamethod">
      <header className="dm-intro">
        <h1>Data &amp; method</h1>
        <p className="lede">This page is for checking our work. Everything else on the site, the simulation and the evidence, is built from what is here.</p>
        <dl>
          <div><dt><a href="#theory">The physics</a></dt><dd>The few relations that explain why fire behaves differently in orbit, on the Moon and on Mars, with every number worked out.</dd></div>
          <div><dt><a href="#extract">The data extractor</a></dt><dd>NASA's Physical Sciences Informatics (PSI) repository holds the test records of every combustion experiment flown. Pick investigations, filter by gravity, oxygen or pressure, and download a CSV in which each row names its source file and row number.</dd></div>
          <div><dt><a href="#method">The method</a></dt><dd>How the records were cleaned, how the investigations are ranked, how the simulation is built, and what the tool does not claim.</dd></div>
        </dl>
      </header>
      <section className="dm-check">
        <h2>How Fire Lab answers the challenge</h2>
        <table className="th-tab">
          <thead><tr><th>The challenge asks for</th><th>Where it is in Fire Lab</th></tr></thead>
          <tbody>
            <tr><td>An AI-powered, web-based dashboard that summarizes, ranks and interprets combustion investigations</td><td>Evidence: plain-language questions, answers written from NASA records with their sources, investigations ranked out of 100, conclusions per safety need</td></tr>
            <tr><td>Identify the investigations most relevant to the fire-safety needs of crew habitats</td><td>Evidence ranking: relevance, fit to the gravity, oxygen and pressure asked, and data available, shown separately</td></tr>
            <tr><td>Extract data that supports predictive modeling of flammability and fire scenarios</td><td>Data extractor (CSV with the source of every row) and the fire simulation, which runs any case at the gravity and atmosphere of each habitat</td></tr>
            <tr><td>Highlight research that informs next-generation fire-safety controls and equipment</td><td>Evidence conclusions grouped by materials, extinction and suppression, and detection, each with its design question; the simulation shows when a detector alarms and how ventilation and CO₂ act</td></tr>
            <tr><td>Earth add-on: applications of the PSI data to fire safety on Earth</td><td>Mission page “On Earth”, and the Earth base (crew capsule, launch control room) simulated at 1 g</td></tr>
          </tbody>
        </table>
      </section>
      <div id="theory"><Theory /></div>
      <div className="dm-sep" id="extract" />
      <Extract />
      <div className="dm-sep" id="method" />
      <Method />
      <p className="small faint" style={{ marginTop: 32 }}>
        The evidence graph can be opened in Obsidian: <a href="/api/kg/obsidian/export">download the vault (.zip)</a>.
      </p>
    </div>
  );
}
