import type {
  AskResponse, CoverageResponse, EarthApp, ExtractRequest, ExtractResponse, Habitat, Insight, Investigation,
  InvestigationDetail, Meta, RankResponse, Scenario, ScatterResponse,
} from "./types";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* keep statusText */ }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

const clean = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== "")) as Partial<T>;

export const api = {
  meta: () => request<Meta>("/api/meta"),
  investigations: () => request<Investigation[]>("/api/investigations"),
  investigation: (acc: string) => request<InvestigationDetail>(`/api/investigations/${acc}`),
  habitats: () => request<Habitat[]>("/api/habitats"),
  rank: (sc: Scenario) => request<RankResponse>("/api/rank", { method: "POST", body: JSON.stringify(clean(sc)) }),
  coverage: (includeOxidizer = false) =>
    request<CoverageResponse>(`/api/coverage?include_oxidizer_stream=${includeOxidizer}`),
  compare: (ids: string[]) => request<any>(`/api/compare?ids=${ids.join(",")}`),
  variables: (accs: string[]) =>
    request<{ dictionary: any[]; plottable: { id: string; label: string; unit: string | null; level: string; n?: number }[] }>(
      `/api/variables${accs.length ? `?accessions=${accs.join(",")}` : ""}`),
  preview: (req: ExtractRequest, limit = 60) =>
    request<ExtractResponse>(`/api/extract/preview?limit=${limit}`, { method: "POST", body: JSON.stringify(clean(req)) }),
  exportZip: async (req: ExtractRequest): Promise<{ blob: Blob; filename: string; rows: number }> => {
    const res = await fetch(`${BASE}/api/extract/export`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(clean(req)),
    });
    if (!res.ok) throw new Error(`${res.status} export failed`);
    const cd = res.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? "flameatlas_extract.zip";
    return { blob: await res.blob(), filename, rows: Number(res.headers.get("x-rows") ?? 0) };
  },
  scatter: (x: string, y: string, accs: string[], color = "accession") =>
    request<ScatterResponse>(
      `/api/analysis/scatter?x=${encodeURIComponent(x)}&y=${encodeURIComponent(y)}&color=${color}` +
      (accs.length ? `&accessions=${accs.join(",")}` : "")),
  flex: () => request<any>("/api/analysis/flex"),
  insights: () => request<Insight[]>("/api/insights"),
  earth: () => request<EarthApp[]>("/api/earth"),
  ask: (question: string, scenario?: Scenario) =>
    request<AskResponse>("/api/ask", { method: "POST", body: JSON.stringify({ question, scenario: scenario ? clean(scenario) : undefined }) }),
};
