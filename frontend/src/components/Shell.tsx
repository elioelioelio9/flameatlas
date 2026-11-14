import { useEffect, useState, type ReactNode } from "react";
import { useApp, type Route } from "../state";
import { NEED_LABEL, fmt } from "./ui";

const NAV: { id: Route; label: string }[] = [
  { id: "mission", label: "Mission" },
  { id: "firelab", label: "Fire lab" },
  { id: "knowledge", label: "Knowledge" },
  { id: "find", label: "Evidence" },
  { id: "map", label: "Coverage" },
  { id: "insights", label: "Insights" },
  { id: "extract", label: "Data" },
  { id: "compare", label: "Compare" },
  { id: "earth", label: "On Earth" },
  { id: "method", label: "Method" },
];

export function TopNav() {
  const { route, go, compareIds } = useApp();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const overlay = route === "mission" && !scrolled;
  return (
    <header className={`topnav ${overlay ? "over" : ""}`}>
      <button className="wordmark" onClick={() => go("mission")}>FlameAtlas</button>
      <button className="menu-toggle tlink" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
      <nav aria-label="Sections" className={open ? "open" : ""}>
        {NAV.map((it) => (
          <button key={it.id} onClick={() => { go(it.id); setOpen(false); }} aria-current={route === it.id ? "page" : undefined}>
            {it.label}{it.id === "compare" && compareIds.length > 0 && <sup className="mono">{compareIds.length}</sup>}
          </button>
        ))}
      </nav>
    </header>
  );
}

export function ScenarioStrip() {
  const { scenario, patchScenario, habitats, go, route } = useApp();
  const h = habitats.find((x) => x.id === scenario.habitat);
  const items: { key: keyof typeof scenario; label: string; value: string | null }[] = [
    { key: "need", label: "Need", value: scenario.need ? NEED_LABEL[scenario.need] : null },
    { key: "habitat", label: "Habitat", value: h ? h.name : null },
    { key: "fuel_phase", label: "Fuel", value: scenario.fuel_phase ?? null },
    { key: "gravity", label: "Gravity", value: scenario.gravity ?? null },
    { key: "o2_pct", label: "O₂", value: scenario.o2_pct != null ? `${fmt(scenario.o2_pct, 1)} %` : null },
    { key: "pressure_kpa", label: "Pressure", value: scenario.pressure_kpa != null ? `${fmt(scenario.pressure_kpa, 1)} kPa` : null },
    { key: "flow_cm_s", label: "Flow", value: scenario.flow_cm_s != null ? `${fmt(scenario.flow_cm_s, 1)} cm/s` : null },
  ];
  const set = items.filter((i) => i.value);
  return (
    <div className="scenario-strip" aria-label="Current scenario">
      <span className="label mono">Scenario</span>
      {set.length === 0 && (
        <button className="tlink" onClick={() => go("find")}>None yet — describe one in Evidence</button>
      )}
      {set.map((i) => (
        <span className="chip" key={i.key}>
          <span className="faint">{i.label}</span> {i.value}
          <button aria-label={`Clear ${i.label}`} onClick={() => patchScenario({ [i.key]: null })}>×</button>
        </span>
      ))}
      {set.length > 0 && route !== "find" && <button className="tlink" onClick={() => go("find")}>Edit scenario</button>}
    </div>
  );
}

export function Footer() {
  const { meta, go } = useApp();
  return (
    <footer className="foot">
      <div>
        <div className="wordmark static">FlameAtlas</div>
        <p className="small faint">Fire-safety evidence from NASA microgravity combustion data. NASA Space Apps Challenge 2026 · Flame in Freefall.</p>
      </div>
      <div className="small faint mono">
        {meta ? `${meta.counts.in_scope} investigations · ${meta.counts.tests.toLocaleString()} test records` : "Connecting to the API…"}<br />
        Data: <a href="https://psi.nasa.gov/physci/repo/search?q=combustion" target="_blank" rel="noreferrer">NASA PSI</a> (CC0) · Imagery: NASA · <button className="tlink inline" onClick={() => go("method")}>Sources and credits</button>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { route } = useApp();
  const immersive = route === "mission" || route === "firelab" || route === "knowledge";
  return (
    <div className={`shell r-${route}`}>
      <TopNav />
      {!immersive && <ScenarioStrip />}
      <main className={immersive ? "content wide" : "content"} id="main">{children}</main>
      <Footer />
    </div>
  );
}
