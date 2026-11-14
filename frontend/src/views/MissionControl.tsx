import { useMemo } from "react";
import { api } from "../api";
import { useApp, useAsync } from "../state";
import FlameHero from "./FlameHero";
import type { CoverageResponse, EarthApp, Investigation } from "../types";

type BodyId = "iss" | "earth" | "moon" | "mars";

interface BodyInfo { id: BodyId; name: string; sub: string; gravity: string; atmosphere: string; preset: string; presetLabel: string }
const SIM: Record<BodyId, { photo: string; credit: string; habitat: string; scenarios: { id: string; label: string; text: string }[] }> = {
  iss: { photo: "/assets/photos/nasa_iss042e021318.jpg", credit: "Destiny at night · NASA ISS042-E-021318", habitat: "Node 1, the US Lab and Node 2: three modules joined by hatches, swept by cabin air.",
    scenarios: [{ id: "iss", label: "Ventilation on", text: "Today's station: the airflow feeds the flame and carries smoke downstream." }, { id: "ventoff", label: "Fans shut down", text: "The standard response: does the flame starve in still air?" }, { id: "explo", label: "34 % O₂ exploration cabin", text: "Oxygen-rich, low-pressure air planned for future vehicles." }] },
  moon: { photo: "/assets/photos/nasa_jsc2004e20304.jpg", credit: "Taurus-Littrow, Apollo 17 · NASA JSC2004E20304", habitat: "A 10 m surface module — laboratory, crew quarters, airlock — at 1/6 g in oxygen-rich air.",
    scenarios: [{ id: "moon", label: "Fire in the crew quarters", text: "Cotton in a sleep station; does the smoke reach the lab detector in time?" }, { id: "moon-off", label: "Fans off", text: "Weak buoyancy alone: does the flame survive?" }] },
  mars: { photo: "/assets/photos/nasa_PIA25176.jpg", credit: "Gale crater, Curiosity Mastcam · NASA/JPL-Caltech/MSSS PIA25176", habitat: "A two-deck, 6 m habitat. At 0.38 g, does smoke climb through the deck hatch?",
    scenarios: [{ id: "mars", label: "Fire on the lab bench", text: "Lower-deck fire, crew sleeping upstairs." }, { id: "mars-off", label: "Fans off", text: "Does smoke still climb through the deck hatch at 0.38 g?" }] },
  earth: { photo: "/assets/photos/nasa_jsc2013e028042.jpg", credit: "Space Vehicle Mockup Facility · NASA JSC2013E028042", habitat: "A crew capsule on the launch pad, at 1 g: the reference every Earth standard is written for.",
    scenarios: [{ id: "earth", label: "Fire in the capsule, cabin air", text: "Buoyant plume: the ceiling detector goes first." }, { id: "apollo1", label: "100 % oxygen at 115 kPa", text: "The Apollo 1 atmosphere, on the pad in 1967." }, { id: "liftoff", label: "During liftoff, 3 g", text: "Stronger buoyancy, faster plume." }] },
};
const BODIES: BodyInfo[] = [
  { id: "iss", name: "International Space Station", sub: "Low Earth orbit · where NASA's fire experiments flew", gravity: "≈ 0 g", atmosphere: "21 % O₂ · 101 kPa", preset: "iss", presetLabel: "Start a fire on the ISS" },
  { id: "moon", name: "Moon base", sub: "Artemis surface habitat and rovers", gravity: "0.17 g", atmosphere: "≥ 30 % O₂ · ≤ 70 kPa (planned)", preset: "moon", presetLabel: "Start a fire in a Moon base" },
  { id: "mars", name: "Mars habitat", sub: "Long-duration surface outpost", gravity: "0.38 g", atmosphere: "Not yet defined", preset: "mars", presetLabel: "Start a fire in a Mars habitat" },
  { id: "earth", name: "Earth launch complex", sub: "Crew vehicle lifting off · reference fires at 1 g", gravity: "1 g (3 g at liftoff)", atmosphere: "21 % O₂ · 101 kPa", preset: "earth", presetLabel: "Start the same fire on Earth" },
];

const PHOTOS = {
  candle: { src: "/assets/photos/nasa_GRC-1998-C-00485_crop.jpg", id: "GRC-1998-C-00485", cap: "The same candle in normal gravity (left) and in microgravity (right).", who: "NASA Glenn Research Center" },
  bass: { src: "/assets/photos/nasa_iss035e016429.jpg", id: "ISS035-E-16429", cap: "Chris Cassidy runs a BASS flame test in the Microgravity Science Glovebox, 9 April 2013.", who: "NASA / Expedition 35", acr: "BASS" },
  bass2: { src: "/assets/photos/nasa_iss040e072900.jpg", id: "ISS040-E-072900", cap: "BASS-II: a 4 mm acrylic slab burning in a controlled airflow, July 2014.", who: "NASA / Expedition 40", acr: "BASS-II" },
  saffire: { src: "/assets/photos/nasa_jsc2023e046631.jpg", id: "JSC2023E046631", cap: "Saffire-IV: plexiglass burning inside a Cygnus cargo vehicle after it left the station.", who: "NASA", acr: "SAFFIRE" },
  acme: { src: "/assets/photos/nasa_GRC-2016-C-05051.jpg", id: "GRC-2016-C-05051", cap: "Inspecting the ACME gas-jet burner insert before flight, Glenn Research Center.", who: "NASA", acr: "ACME" },
  destiny: { src: "/assets/photos/nasa_iss042e021318.jpg", id: "ISS042-E-021318", cap: "Destiny, the US Laboratory, at night with the main lights off. 3 December 2014.", who: "NASA / Expedition 42" },
};

function hardwareGroup(inv: Investigation): string {
  const h = `${inv.hardware ?? ""} ${inv.flight_platform ?? ""}`.toLowerCase();
  if (h.includes("cygnus") || h.includes("saffire")) return "Cygnus cargo vehicle";
  if (h.includes("combustion integrated rack") || h.includes("cir")) return "Combustion Integrated Rack";
  if (h.includes("glovebox") || h.includes("msg")) return "Microgravity Science Glovebox";
  return "Other ISS hardware";
}

export default function MissionControl() {
  const { investigations, openDrawer, go, setFirePreset } = useApp();
  const cov = useAsync<CoverageResponse>(() => api.coverage(), []);
  const earthApps = useAsync<EarthApp[]>(() => api.earth(), []);
  const flight = useMemo(() => investigations.filter((i) => i.in_scope && (i.project_type ?? "").startsWith("Microgravity")), [investigations]);
  const ground = useMemo(() => investigations.filter((i) => i.in_scope && (i.project_type ?? "").startsWith("Ground")), [investigations]);
  const groups = useMemo(() => {
    const m: Record<string, Investigation[]> = {};
    flight.forEach((i) => { (m[hardwareGroup(i)] ||= []).push(i); });
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [flight]);
  const flightTests = flight.reduce((s, i) => s + i.profile.n_tests, 0);
  const gap = (id: string) => cov.data?.gaps.find((g) => g.habitat.id === id);
  const byAcr = (acr?: string) => investigations.find((i) => (i.acronym ?? "").toUpperCase() === (acr ?? "").toUpperCase());
  const simulate = (preset: string) => { setFirePreset(`${preset}:inside`); go("firelab"); };

  const Photo = ({ p, className }: { p: (typeof PHOTOS)[keyof typeof PHOTOS]; className?: string }) => {
    const inv = "acr" in p ? byAcr(p.acr) : undefined;
    return (
      <figure className={`ph ${className ?? ""}`}>
        <img src={p.src} alt={p.cap} loading="lazy" />
        <figcaption>
          <span>{p.cap}</span>
          <span className="mono meta">{p.who} · {p.id}{inv && <> · <button className="tlink inline" onClick={() => openDrawer(inv.accession)}>{inv.acronym} data</button></>}</span>
        </figcaption>
      </figure>
    );
  };

  return (
    <div className="mission">
      <FlameHero onSimulate={() => go("firelab")} onEvidence={() => go("evidence")} />

      <section className="bases">
        <header>
          <p className="mono meta">The tool</p>
          <h2>Four bases, each with rooms you can set on fire.</h2>
          <p>Open a base, zoom from the outside into a room, choose the material and the air, and ignite. The flow, the smoke and the oxygen are computed live with the gravity of that world.</p>
        </header>
        <div className="bases-grid">
          {BODIES.map((b) => (
            <article key={b.id}>
              <h3>{b.name}</h3>
              <dl className="facts">
                <div><dt>Gravity</dt><dd>{b.gravity}</dd></div>
                <div><dt>Cabin air</dt><dd>{b.atmosphere}</dd></div>
                <div><dt>NASA fire tests</dt><dd>{b.id === "iss" ? flightTests.toLocaleString() : b.id === "earth" ? `${ground.length} ground studies` : "None yet"}</dd></div>
              </dl>
              <p>{SIM[b.id].habitat}</p>
              <ul>{SIM[b.id].scenarios.map((sc) => <li key={sc.id}><button className="tlink" onClick={() => simulate(sc.id)}>{sc.label}</button></li>)}</ul>
            </article>
          ))}
        </div>
        <p className="small faint">No combustion experiment has run at lunar or martian gravity. Only {gap("lunar_base")?.n_inside ?? "a few"} microgravity tests in NASA's records fall inside the atmosphere planned for a Moon base. Between the data points, the simulation is physics, labelled as a model.</p>
      </section>

      <section className="editorial">
        <div className="ed-split">
          <Photo p={PHOTOS.candle} className="tall" />
          <div className="ed-text">
            <p className="mono meta">The physics</p>
            <h2>Take away buoyancy and a flame changes shape, colour and speed.</h2>
            <p>On Earth, hot gas rises and pulls fresh air in below: the teardrop. In orbit nothing rises — oxygen only reaches the flame by slow diffusion or by the cabin fans. The flame becomes a dim blue sphere that can starve on its own exhaust.</p>
            <div className="links">
              <button className="tlink strong" onClick={() => go("firelab")}>See it in the simulation</button>
              <button className="tlink" onClick={() => go("evidence")}>Read the evidence</button>
            </div>
          </div>
        </div>
        <div className="ed-rows">
          <div className="ed-row">
            <Photo p={PHOTOS.bass2} />
            <div className="ed-text">
              <p className="mono meta">How NASA studies it</p>
              <h3>Small samples, burned on purpose, inside sealed hardware.</h3>
              <p>Since the 1990s NASA has run hundreds of controlled burns in orbit: candles, fuel droplets, gas jets, acrylic slabs, cotton fabric. Most run in two pieces of hardware on the station, the Microgravity Science Glovebox and the Combustion Integrated Rack, where cameras and sensors record how fast the flame spreads, how hot it gets, and at what airflow or oxygen level it goes out.</p>
              <p>BASS-II, above, burned a 4 mm acrylic slab in a duct with a slow, controlled airflow. The result that matters for a crew: in a slow breeze a flame in orbit can keep burning at oxygen levels where the same material self-extinguishes on Earth. Ground flammability tests can therefore rate a material as safe when it is not, in orbit.</p>
            </div>
          </div>
          <div className="ed-row">
            <Photo p={PHOTOS.saffire} />
            <div className="ed-text">
              <p className="mono meta">Why it matters</p>
              <h3>A cabin fire is the one emergency with nowhere to go.</h3>
              <p>On the pad in 1967, Apollo 1 burned in pure oxygen in seconds. In 1997, an oxygen-generator canister caught fire on Mir and filled the station with smoke. A crew in orbit, on the Moon or on Mars cannot step outside: the fire has to be detected early, starved or put out, and the air cleaned, in the same closed volume they breathe.</p>
              <p>Small samples do not answer how large fires grow, so the Saffire series burned big sheets of fabric and plexiglass inside empty Cygnus cargo ships after they left the station. Those runs, with the glovebox and rack tests, are the data behind this site.</p>
            </div>
          </div>
          <div className="ed-text ed-qs">
            <p className="mono meta">The three questions this tool answers</p>
            <dl>
              <div><dt>Which materials can fly?</dt><dd>How easily a fabric, plastic or foam ignites and spreads flame at the gravity, oxygen and pressure of each habitat.</dd></div>
              <div><dt>How do you put it out?</dt><dd>When a flame dies on its own (too little oxygen, too little flow, too much heat loss), and what turning off the fans or flooding the cabin with CO₂ does.</dd></div>
              <div><dt>How do you see it early?</dt><dd>Without buoyancy, smoke does not rise to the ceiling. Where it goes depends on the ventilation, and that decides where a detector has to be.</dd></div>
            </dl>
            <p className="small faint">Moon and Mars gravity, and their planned low-pressure, oxygen-rich cabin air, have never been tested with fire. The simulation fills the gap with physics and says so wherever it does.</p>
          </div>
        </div>
      </section>

      <section className="onearth">
        <header>
          <p className="mono meta">On Earth</p>
          <h2>What orbit teaches about fires down here.</h2>
          <p>Microgravity strips buoyancy out of a fire, which makes flames simpler to measure and to model. Each card says what could transfer to confined places on Earth, and what still has to be validated first.</p>
        </header>
        <div className="oe-grid">
          {(earthApps.data ?? []).map((e) => (
            <article key={e.id}>
              <span className="mono meta">{e.domain}</span>
              <h3>{e.title}</h3>
              <p>{e.contribution}</p>
              <p className="need"><b>Still to validate.</b> {e.validation_needed}</p>
              <div className="src">
                {e.sources.filter((q) => q.accession).map((q, i) => <button key={i} className="tlink inline" onClick={() => openDrawer(q.accession!)}>{investigations.find((v) => v.accession === q.accession)?.acronym ?? q.accession}</button>)}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
