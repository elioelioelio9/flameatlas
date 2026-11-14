# Fire Lab

**Fire-safety evidence from NASA microgravity combustion data.**
NASA Space Apps Challenge 2026 — *Flame in Freefall: SI-powered fire safety insights from microgravity combustion data.*

Fire Lab turns the combustion investigations of NASA's [Physical Sciences Informatics (PSI)](https://psi.nasa.gov/physci/repo/search?q=combustion) repository into answers an engineer can act on:

- **which experiments matter** for a given fire-safety need and habitat,
- **what their tested conditions actually cover** — and where the evidence stops,
- **modelling-ready data**, with every value traceable to its NASA file, row and DOI.

![Mission control](docs/img/mission.png)

---

## Four tabs

**Mission.** Earth, the ISS, the Moon and Mars. Each world carries a miniature base (launch pad with a rocket lifting off, the ISS in orbit, a Moon village, a Mars outpost) with astronauts and rovers moving around it. Click a world to fly to its base, scroll in on the base to enter its fire simulation. Below: the physics in one paragraph, two NASA flight photographs, and the applications on Earth.

**Simulation.** A 3-D fire simulation inside four habitats — ISS (Node 1 → US Lab → Node 2), a Moon base (lab, crew quarters, airlock), a two-deck Mars habitat, a crew capsule on the launch pad — each also shown from outside as a detailed diorama.

- **Physics**: 3-D low-Mach Navier–Stokes on a staggered (MAC) grid with immersed solids, buoyancy from the full temperature ratio, thermal expansion of the burnt gas (∇·u = S), MIC(0)-preconditioned conjugate-gradient pressure solve to max |∇·u − S| < 5·10⁻⁵ s⁻¹ (the residual is displayed live), clamped MacCormack advection of heat, O₂, CO₂ and smoke. Sealed cabins get a thermodynamic pressure rise; every closed gas region (e.g. behind a shut hatch) is solved with its own compatibility condition.
- **Fire**: one source — a fuel panel on any surface (click to move it), material-specific oxygen limits, spread (faster downstream and uphill), burnout, starvation.
- **Settings**: gravity, fan airflow and direction, oxygen, cabin pressure and temperature, burning material, fuel-panel size, igniter power, every hatch and door.
- **What you see**: ray-marched smoke from the computed smoke field, flame, velocity vectors on a movable plane with a reference scale, streamlines, colour planes (temperature, O₂, smoke, speed, vorticity), smoke-detector alarms, burning-rate history, CSV export.

**Evidence.** One page around an Obsidian-style graph: investigations, conclusions, concepts, places and hardware as beads; drag one and its links follow. One question bar (free text or a scenario) returns the ranked investigations, the quoted sources, and lights the path in the graph. A question about a habitat or about what is missing also shows the coverage map (tests by O₂ and pressure against the planned atmosphere) with the three numbers that matter. The 11 conclusions sit underneath; clicking one lights its sources. You can add your own documents (PDF, text, Markdown, CSV, JSON).

**Data & method.** The export tool (filtered table → ZIP with data dictionary, provenance and limitations) followed by the method, the ranking rules, the limits and the credits. The graph can be downloaded as an Obsidian vault.

The fire model is tuned to reproduce qualitative trends in the PSI data; it is labelled as an educational model, not a validated CFD code. Image and model provenance: [docs/CREDITS.md](docs/CREDITS.md).

| Earth: buoyant plume, ceiling alarm in seconds | Orbit, ventilation on: smoke follows the airflow |
|---|---|
| ![Earth](docs/img/firelab_earth.png) | ![ISS](docs/img/firelab_iss.png) |

## What it does

The three objectives of the challenge and its Earth add-on each map to a module:

| Challenge objective | Fire Lab module | What you get |
|---|---|---|
| Identify investigations most relevant to habitable crew environments | **Evidence** (question bar, coverage map) | Ranking with a visible score and reason, plus the tests that fall inside each planned atmosphere |
| Extract data that supports predictive modelling | **Data & method** | A unified table of 2,060 records / 7,688 measurements across 24 investigations, filtered and exported as a ZIP with data dictionary, provenance and limitations |
| Highlight research that informs next-generation fire-safety controls | **Evidence** (11 conclusions, sourced answers) | Conclusion cards (observation → design question → limitation → next validation) and answers quoted from their sources |
| Applications on Earth | **Mission** (On Earth) | Transfers to submarines, aircraft, mines, smoke detection, fire models, engines — each with the validation still required |

### Findings the data surfaced

All of these are computed from the NASA tables or quoted from PSI records, never typed by hand:

- **Exploration atmospheres are almost untested.** At 8.2 psia / 34 % O2 (a NASA-considered crew atmosphere), PSI holds only 9 tests with both O2 and pressure in range — all gaseous ACME CFI-G flames. None of them uses a solid or liquid fuel.
- **More oxygen, fewer self-extinctions.** In FLEX (N2-only atmospheres), methanol flames went out before burnout in 9 of 12 tests at 21 % O2, but in only 2 of 13 at 30–34 %. For heptane, the counts are 5 of 17 at 21 % versus 0 of 11.
- **Cutting ventilation may not be enough.** ACME BRE observed flames that emulate burning solids keep burning without airflow in elevated-O2 atmospheres. At 21 % O2, the same flames self-extinguished. PSI flags these results as preliminary.
- **1 g and microgravity can rank materials differently.** In SAFFIRE-II, all four silicone samples barely burned in microgravity at 20 cm/s, while two of the four matching 1-g reference burns were complete.
- **There are no partial-gravity combustion data yet.** Fire Lab never treats Moon or Mars conditions as microgravity: those results are shown as *bounded only*.

| Ranking with explanations | Coverage map |
|---|---|
| ![Find evidence](docs/img/find.png) | ![Conditions map](docs/img/map.png) |

---

## Quick start

Requirements: **Python ≥ 3.10**, **Node ≥ 20**.

**Windows:** double-click `setup.bat` once (installs everything, builds the database, runs the tests, builds the UI), then `start.bat` every time. After a `git pull`, run `rebuild_frontend.bat`.
**macOS:** double-click `setup.command` once, then `start.command`.

```bash
make setup      # venv + pip install + npm install
make test       # back-end tests (ETL, ranking criteria, export, assistant, API)
make api        # API on http://localhost:8000  (docs: /docs)
# macOS: or just double-click setup.command once, then start.command
make web        # UI on  http://localhost:5173  (second terminal)
```

Without `make`:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cd backend && uvicorn flameatlas.api.main:app --reload --port 8000
# second terminal
cd frontend && npm install && npm run dev
```

The SQLite database is built automatically on first start from `data/raw/psi_combustion_corpus.json` (or explicitly with `make data`).

**Optional language model.** Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`). Without a key, *Ask* returns an extractive answer quoted from the sources, and everything else works the same.

**Production / single server.** `make serve` builds the front-end and serves it from the API on port 8000. A `Dockerfile` is included (Render, Railway, Fly.io, Hugging Face Spaces…).

---

## Architecture

```mermaid
flowchart LR
  PSI[(NASA PSI API<br/>metadata + CSV tables)] -->|scripts/fetch_psi_corpus.py| RAW[data/raw<br/>corpus JSON]
  RAW --> ETL[ETL<br/>one adapter per table<br/>units, quality flags]
  CUR[Curation<br/>needs, habitats,<br/>text-grounded insights] --> ETL
  ETL --> DB[(SQLite<br/>investigation / test / measurement<br/>+ FTS5 index)]
  DB --> SVC[Services<br/>query parser · hybrid search · ranking<br/>coverage · compare · export · analysis]
  SVC --> API[FastAPI<br/>/api/*]
  SVC --> ASK[Assistant<br/>retrieval → optional LLM<br/>citations enforced]
  API --> UI[React + TypeScript + d3]
  ASK --> API
```

| Layer | Choice | Why |
|---|---|---|
| Data store | SQLite + FTS5 | One file, no server, full-text search with BM25, reproducible |
| ETL | Python, one adapter per PSI table | Every PSI table is shaped differently; each adapter records its interpretations as quality flags |
| Search | Rule-based query parser (EN/FR) + BM25 + TF-IDF (word + char n-grams), fused with RRF | Works offline and is explainable |
| Ranking | Deterministic rules: relevance · condition fit · data readiness | Reproducible and defensible — the LLM never scores |
| API | FastAPI + Pydantic | Typed, self-documenting (`/docs`) |
| Assistant | Retrieval + optional Claude / OpenAI, mandatory `[S#]` citations, extractive fallback | Grounded answers that do not depend on the API being up |
| Front-end | React 19, TypeScript, Vite, d3, three.js | Charts drawn from data; 3-D scenes and a real-time fluid solver (`frontend/src/sim/fluid.ts`) |

### Data model

Three levels are kept separate:

- `investigation` — a PSI programme (e.g. FLEX, PSI-69), with its DOI and curated classification.
- `test` — one run, session or test-matrix row, with `source_file` and `source_row`.
- `measurement` — one reported quantity with its unit and `source_column`.

Missing values are `NULL` (never 0). Every interpretation made while parsing is stored in `test.quality`:

| Flag | Meaning |
|---|---|
| `assumed_unit_cm_s` | BASS-II "Air display" assumed to be in cm/s |
| `typo_corrected_percent` | PSI wrote "3400%" for 34 % O2 |
| `typo_corrected_leading_zero` | "037 mm" read as 0.37 mm |
| `o2_is_oxidizer_stream_not_ambient` | Inverse flames: the O2 value is the burner stream, not the cabin atmosphere |
| `unit_inconsistency_across_tables` | SIBAL thickness is 0.37 cm in SAFFIRE-I but 0.37 mm in SAFFIRE-II |

### Ranking rules

`score = 0.5 × relevance + 0.3 × condition fit + 0.2 × data readiness`

- **Relevance**: the curated weight of the selected need for the investigation (shown in the UI), blended with the text match to the question.
- **Condition fit**: computed per factor from the tested ranges in the data:

  | Status | Score |
  |---|---|
  | covered | 1 |
  | close | 0.55 |
  | bounded only (partial gravity) | 0.5 |
  | not reported | 0.3 |
  | outside range | 0.1 |

- **Data readiness**: whether test-level records exist, how many there are, and whether the variables the need requires are present.

Reference criteria are encoded as tests (`backend/tests/test_ranking.py`, `benchmark_questions.json`):

- "materials" brings up solid-fuel studies;
- "liquid extinction" brings up FLEX;
- "smoke detection" brings up SAME-R, in English and in French;
- the Moon is never a microgravity match;
- unknown conditions stay unknown.

---

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/meta` | Counts, build info, needs and pillars |
| GET | `/api/investigations`, `/api/investigations/{PSI-ID}` | Catalogue and detail (profile, variation, publications, insights) |
| GET | `/api/investigations/{PSI-ID}/tests` | Test records with measurements |
| POST | `/api/rank` | Explained ranking for a scenario or a free-text question |
| GET | `/api/search?q=` | Parsed query, passages and ranking |
| GET | `/api/coverage` | Points, habitat envelopes and gap analysis |
| GET | `/api/compare?ids=` | Side-by-side comparison (max 4) |
| POST | `/api/extract/preview`, `/api/extract/export` | Filtered table / ZIP (data, dictionary, provenance, limitations, citations) |
| GET | `/api/analysis/scatter`, `/api/analysis/flex` | Variable-vs-variable plots; FLEX reference analysis |
| GET | `/api/insights`, `/api/earth`, `/api/habitats` | Curated and computed content |
| POST | `/api/ask` | Grounded Q&A with sources |

Interactive documentation is at `http://localhost:8000/docs`.

---

### Knowledge engine endpoints

| Method | Path | What it does |
|---|---|---|
| GET | `/api/kg/overview` · `/api/kg/graph` | Node/edge counts; the aggregated graph (filters: `types`, `rels`, `publications`) |
| GET | `/api/kg/node?id=` · `/api/kg/edge?id=` | Node with incoming/outgoing relationships and passages; edge with definition and evidence |
| POST | `/api/kg/research` | Question → concepts/entities → hybrid retrieval → evidence path + cited answer (stored) |
| GET | `/api/kg/research` · `/api/kg/research/{id}` | Research history; reopen a stored result |
| POST | `/api/kg/ingest` · DELETE `/api/kg/documents/{id}` | Add documents (base64 JSON; dedup by SHA-256, versioning by filename) · remove one |
| GET | `/api/kg/obsidian/export` · POST `/api/kg/obsidian/sync` · POST `/api/kg/obsidian/import` | Vault zip · write the vault into a local folder · import Markdown notes or a zipped vault |

## Repository layout

```
backend/
  flameatlas/
    etl/          parsing.py, adapters.py (one per PSI table), curation.py, build.py
    services/     query_parser, search, ranking, coverage, compare, export, analysis, assistant, llm
    api/main.py   FastAPI app (also serves frontend/dist in production)
  tests/          pytest suite + benchmark questions
frontend/         React + TypeScript + d3 (Vite)
data/
  raw/            psi_combustion_corpus.json  (NASA PSI, CC0-1.0)
  processed/      flat CSV copies of the database, for review
scripts/          fetch_psi_corpus.py — re-download the corpus from PSI
docs/             screenshots, demo script
```

---

## Data, citation and limits

- **Source.** NASA PSI repository, retrieved through its public API, together with each investigation's experimental-table CSV files. The data are released under **CC0-1.0**. NASA asks that every dataset be cited by its **DOI**; DOIs appear on every card, in every export and in `CITATION.txt`.
- **Scope.** All 24 combustion-science investigations returned by PSI, plus two keyword matches that are kept but marked out of scope (PSI-181 solders, PSI-108 thermocapillary flow).
- **Limits.**
  - Summary tables do not contain many results (spread rates, particle sizes, temperature fields) that exist only in raw PSI files.
  - All flight data are microgravity.
  - The Moon and Mars envelopes are planning assumptions taken from the challenge statement and from PSI-20.
  - Fits are descriptive and valid only inside the measured range.
  - Fire Lab does not predict whether a given material will burn.

## Use of AI

This project was built with the help of an AI coding assistant.

In the product, an optional language model only rephrases passages and numbers that the application has already retrieved and computed, and its citations are checked against the sources it was given. All rankings, statistics, unit conversions and exports are deterministic Python. The Flame Lab animation is a labelled schematic, not a simulation.

## License

Code: MIT. NASA PSI data: CC0-1.0 (cite DOIs).
