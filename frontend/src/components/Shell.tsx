import { useEffect, useState, type ReactNode } from "react";
import { useApp, type Route } from "../state";

const NAV: { id: Route; label: string }[] = [
  { id: "mission", label: "Mission" },
  { id: "firelab", label: "Fire lab" },
  { id: "evidence", label: "Evidence" },
  { id: "data", label: "Data & method" },
];

export function TopNav() {
  const { route, go } = useApp();
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
            {it.label}
          </button>
        ))}
      </nav>
    </header>
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
        Data: <a href="https://psi.nasa.gov/physci/repo/search?q=combustion" target="_blank" rel="noreferrer">NASA PSI</a> (CC0) · Imagery: NASA · <button className="tlink inline" onClick={() => go("data")}>Sources and credits</button>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { route } = useApp();
  const immersive = route !== "data";
  return (
    <div className={`shell r-${route}`}>
      <TopNav />
      <main className={immersive ? "content wide" : "content"} id="main">{children}</main>
      <Footer />
    </div>
  );
}
