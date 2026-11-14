import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";
import type { Habitat, Investigation, Meta, Scenario } from "./types";

export type Route = "mission" | "firelab" | "knowledge" | "overview" | "find" | "map" | "compare" | "extract" | "insights" | "earth" | "method";
export const ROUTES: Route[] = ["mission", "firelab", "knowledge", "overview", "find", "map", "compare", "extract", "insights", "earth", "method"];

interface AppState {
  route: Route;
  go: (r: Route) => void;
  scenario: Scenario;
  setScenario: (s: Scenario) => void;
  patchScenario: (p: Partial<Scenario>) => void;
  meta: Meta | null;
  investigations: Investigation[];
  habitats: Habitat[];
  byAcc: Record<string, Investigation>;
  compareIds: string[];
  toggleCompare: (acc: string) => void;
  setCompareIds: (ids: string[]) => void;
  extractIds: string[];
  setExtractIds: (ids: string[]) => void;
  drawer: string | null;
  openDrawer: (acc: string | null) => void;
  loadError: string | null;
  firePreset: string | null;
  setFirePreset: (p: string | null) => void;
}

const Ctx = createContext<AppState | null>(null);

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.includes(h) ? h : "mission";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(readRoute);
  const [scenario, setScenario] = useState<Scenario>({ include_ground_studies: true });
  const [meta, setMeta] = useState<Meta | null>(null);
  const [investigations, setInvestigations] = useState<Investigation[]>([]);
  const [habitats, setHabitats] = useState<Habitat[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>(["PSI-25", "PSI-69"]);
  const [extractIds, setExtractIds] = useState<string[]>(["PSI-69"]);
  const [drawer, setDrawer] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [firePreset, setFirePreset] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    Promise.all([api.meta(), api.investigations(), api.habitats()])
      .then(([m, i, h]) => { setMeta(m); setInvestigations(i); setHabitats(h); })
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const go = useCallback((r: Route) => {
    window.location.hash = `/${r}`;
    window.scrollTo({ top: 0 });
  }, []);
  const patchScenario = useCallback((p: Partial<Scenario>) => setScenario((s) => ({ ...s, ...p })), []);
  const toggleCompare = useCallback((acc: string) => {
    setCompareIds((ids) => (ids.includes(acc) ? ids.filter((x) => x !== acc) : [...ids, acc].slice(-4)));
  }, []);
  const byAcc = useMemo(() => Object.fromEntries(investigations.map((i) => [i.accession, i])), [investigations]);

  const value: AppState = {
    route, go, scenario, setScenario, patchScenario, meta, investigations, habitats, byAcc,
    compareIds, toggleCompare, setCompareIds, extractIds, setExtractIds, drawer, openDrawer: setDrawer, loadError,
    firePreset, setFirePreset,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fn().then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
