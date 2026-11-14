export type Need = "materials" | "extinction" | "detection";
export type Status = "match" | "partial" | "bounded" | "unknown" | "mismatch";

export interface Scenario {
  need?: Need | null;
  fuel_phase?: string | null;
  gravity?: string | null;
  habitat?: string | null;
  o2_pct?: number | null;
  pressure_kpa?: number | null;
  flow_cm_s?: number | null;
  query?: string | null;
  include_ground_studies?: boolean;
}

export interface Profile {
  n_tests: number;
  n_records: number;
  record_types: Record<string, number>;
  fuel_phases: string[];
  ranges: Record<string, [number, number]>;
  coverage: Record<string, number>;
  measured_quantities: { quantity: string; n: number }[];
  outcome_classes: Record<string, number>;
}

export interface Investigation {
  accession: string;
  acronym: string | null;
  title: string;
  doi: string | null;
  family: string | null;
  project_type: string | null;
  flight_platform: string | null;
  hardware: string | null;
  fuel_phases: string[];
  pillars: string[];
  needs: Partial<Record<Need, number>>;
  scale: string | null;
  summary: string | null;
  in_scope: boolean;
  scope_note: string | null;
  start_date: string | null;
  end_date: string | null;
  psi_url: string;
  profile: Profile;
  uses_data_from: string[];
  sub_research_area: string | null;
  configuration: string | null;
  key_variables: string[];
}

export interface InvestigationDetail extends Investigation {
  objective: string;
  approach: string;
  hypothesis: string;
  research_impacts: string;
  sensors: string[];
  related: string[];
  publications: { title: string; authors: string; doi: string }[];
  insights: Insight[];
  file_categories: Record<string, { n: number; bytes: number; examples: string[] }>;
  total_file_bytes: number;
  variation: Variation;
  test_preview: TestRow[];
  license: string;
  psi_version: number;
}

export interface Variation {
  varied: { variable: string; n_levels: number; min?: number; max?: number; examples?: (string | number)[] }[];
  fixed: { variable: string; value: string | number }[];
  not_reported: string[];
}

export interface TestRow {
  test_id: string;
  accession: string;
  record_type: string;
  source_file: string;
  source_row: number;
  label: string | null;
  fuel: string | null;
  fuel_phase: string | null;
  material_class: string | null;
  configuration: string | null;
  thickness_mm: number | null;
  o2_mole_frac: number | null;
  pressure_kpa: number | null;
  flow_cm_s: number | null;
  flow_direction: string | null;
  diluent: string | null;
  outcome: string | null;
  outcome_class: string | null;
  quality: string[];
  notes: string | null;
}

export interface Factor {
  factor: string;
  label: string;
  target: string;
  tested: string;
  status: Status;
  detail: string;
}

export interface Ranked {
  accession: string;
  acronym: string | null;
  title: string;
  doi: string | null;
  family: string | null;
  project_type: string | null;
  score: number;
  relevance: number;
  fit: number | null;
  data: number;
  factors: Factor[];
  why: string[];
  gaps: string[];
  matching_tests: number;
  top_passage: { section: string; text: string } | null;
}

export interface ParsedQuery {
  text: string;
  detected: { field: string; value: string; because: string }[];
  keywords: string[];
}

export interface RankResponse {
  scenario: Scenario;
  parsed: ParsedQuery | null;
  notes: string[];
  weights: Record<string, number>;
  status_scores: Record<Status, number>;
  results: Ranked[];
}

export interface Habitat {
  id: string;
  name: string;
  o2_pct_min: number;
  o2_pct_max: number;
  pressure_kpa_min: number;
  pressure_kpa_max: number;
  gravity: string;
  gravity_g: number;
  status: string;
  source: string;
  note: string;
}

export interface Insight {
  id: string;
  need: Need;
  pillar: string;
  title: string;
  observation: string;
  conditions: string;
  design_question: string;
  limitation: string;
  next_validation: string;
  sources: { accession?: string; url?: string; field: string }[];
  evidence_kind: "psi_text" | "computed_from_table" | "hypothesis";
}

export interface EarthApp {
  id: string;
  title: string;
  domain: string;
  contribution: string;
  validation_needed: string;
  sources: { accession?: string; url?: string; label: string }[];
}

export interface CoveragePoint {
  test_id: string;
  accession: string;
  acronym: string;
  fuel: string | null;
  fuel_phase: string | null;
  o2_pct: number;
  pressure_kpa: number;
  flow_cm_s: number | null;
  outcome_class: string | null;
  oxidizer_stream: boolean;
}

export interface CoverageResponse {
  points: CoveragePoint[];
  o2_only: { accession: string; acronym: string; fuel_phase: string; o2_pct: number[]; n: number; o2_pct_min: number; o2_pct_max: number }[];
  habitats: Habitat[];
  gaps: { habitat: Habitat; n_inside: number; by_investigation: Record<string, number>; by_fuel_phase: Record<string, number>; summary: string }[];
  notes: string[];
}

export interface Meta {
  version: string;
  llm: string;
  counts: { investigations: number; in_scope: number; tests: number; measurements: number; insights: number };
  database: Record<string, string>;
  needs: Record<Need, string>;
  pillars: Record<string, string>;
}

export interface AskSource {
  id: string;
  kind: string;
  accession: string | null;
  acronym: string | null;
  doi: string | null;
  title: string;
  text: string;
}

export interface AskResponse {
  answer: string;
  mode: string;
  model?: string | null;
  warnings: string[];
  sources: AskSource[];
  all_sources?: AskSource[];
  ranking?: { accession: string; acronym: string | null; title: string; score: number }[];
}

export interface ExtractRequest {
  accessions: string[];
  record_types: string[];
  fuel_phase?: string | null;
  o2_pct_min?: number | null;
  o2_pct_max?: number | null;
  pressure_kpa_min?: number | null;
  pressure_kpa_max?: number | null;
  flow_cm_s_min?: number | null;
  flow_cm_s_max?: number | null;
  outcome_classes?: string[];
  exclude_flags?: string[];
}

export interface ExtractResponse {
  columns: string[];
  rows: Record<string, string | number | null>[];
  total: number;
  accessions: string[];
  quantities: { quantity: string; unit: string | null; n: number }[];
}

export interface Fit {
  n: number;
  slope: number;
  intercept: number;
  r2: number;
  x_min: number;
  x_max: number;
}

export interface ScatterResponse {
  x: string;
  y: string;
  n: number;
  points: { x: number; y: number; test_id: string; accession: string; group: string; fuel: string | null; outcome: string | null; source_row: number }[];
  fits: Record<string, Fit>;
}
