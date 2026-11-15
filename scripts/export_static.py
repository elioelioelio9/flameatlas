"""Export every API answer the web app needs into static JSON files, so the site can be hosted
without a server (GitHub Pages). Run from the repository root:

    python scripts/export_static.py frontend/dist/static-api

GET endpoints are exported as they are. The parts that depend on what a visitor types are handled as follows:
  * questions (research + ranking): a set of prepared questions is answered here; in the browser a free-text
    question is matched to the closest prepared one (and the page says so);
  * data extraction, variables and scatter plots: the full table (every record, every measured quantity) is
    exported once, and the browser applies the same filters as services/export.py and services/analysis.py.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from flameatlas import __version__  # noqa: E402
from flameatlas.config import settings  # noqa: E402
from flameatlas.db import connect  # noqa: E402
from flameatlas.etl.curation import NEEDS, PILLARS  # noqa: E402
from flameatlas.knowledge import store as kg, research  # noqa: E402
from flameatlas.services import analysis, compare as compare_svc, coverage as coverage_svc, export as export_svc  # noqa: E402
from flameatlas.services.ranking import Scenario, rank  # noqa: E402
from flameatlas.services.repository import Repository  # noqa: E402
from flameatlas.services.search import get_index  # noqa: E402

QUESTIONS = [
    # the suggestions shown under the question bar
    "Does turning off the fans put out a fire?", "What is missing for the Moon?", "Which materials burn at 34 % oxygen?",
    "How fast does a detector see smoke in microgravity?",
    # habitats and gaps
    "What is missing for Mars?", "What is missing for the ISS?", "What is missing for a spacesuit?",
    "What is missing for the exploration atmosphere at 34 % oxygen?", "Fire safety in a lunar habitat",
    "Fire safety in a Mars habitat", "Fire safety on the ISS", "Fire in a crew capsule on the launch pad",
    "Partial gravity combustion data", "Has anyone burned materials at lunar gravity?",
    # physics
    "What does a candle flame look like in microgravity?", "Why are flames spherical in space?",
    "How does oxygen concentration affect flame spread?", "How does pressure affect burning?",
    "Does airflow make a fire worse in microgravity?", "What is the minimum airflow to sustain a flame?",
    "How fast does a flame spread over a thin fuel?", "Flame spread over thick PMMA",
    "Upstream versus downstream flame spread", "How do fuel droplets burn in microgravity?",
    "What are cool flames?", "Droplet extinction diameter", "Burning rate constant of heptane droplets",
    "How does soot form in microgravity flames?", "Radiation from microgravity flames",
    "Flammability limits in microgravity", "Is NASA-STD-6001 conservative in microgravity?",
    "Does a material that passes the upward burning test burn in space?",
    # suppression and detection
    "What extinguishes a fire in microgravity?", "Is CO2 a good fire suppressant in space?",
    "Nitrogen dilution and extinction", "Helium dilution and extinction", "Water mist suppression in microgravity",
    "How long can a fire burn unnoticed in a spacecraft?", "Smoke particle size in microgravity",
    "Smoke detectors on the ISS", "Large-scale fire in a spacecraft",
    # materials and experiments
    "Which materials are most flammable in microgravity?", "Cotton and fabric flammability",
    "Nomex flammability", "PMMA flammability", "Silicone fire behaviour",
    "Saffire experiment results", "FLEX droplet experiments", "BASS experiment results", "ACME experiment results",
    "SoFIE solid fuel ignition and extinction", "Gaseous jet flames in microgravity", "Ignition of solid materials",
    # Earth
    "What do microgravity fires teach us about fires on Earth?", "Fires in submarines and aircraft cabins",
]


def key(path_and_query: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "_", path_and_query.removeprefix("/api/")).strip("_") + ".json"


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    db = Path(settings.db_path)
    if not db.exists():
        from flameatlas.etl.build import build
        build(db)
    conn = connect(db)
    repo = Repository(conn)
    get_index(conn)
    kg.init(conn)
    if not conn.execute("SELECT COUNT(*) FROM kg_node WHERE origin='psi'").fetchone()[0]:
        kg.build_from_psi(conn)

    def put(path: str, data) -> None:
        (out / key(path)).write_text(json.dumps(data, default=str, separators=(",", ":")), encoding="utf-8")

    m = repo.meta()
    invs = repo.investigations()
    put("/api/meta", {"version": __version__, "llm": None, "database": m, "needs": NEEDS, "pillars": PILLARS,
                      "counts": {"investigations": len(invs), "in_scope": sum(1 for i in invs if i["in_scope"]),
                                 "tests": int(m.get("n_tests", 0)), "measurements": int(m.get("n_measurements", 0)),
                                 "insights": int(m.get("n_insights", 0))}, "sources": [], "static": True})
    K = ("accession", "acronym", "title", "doi", "family", "project_type", "flight_platform", "hardware", "fuel_phases",
         "pillars", "needs", "scale", "summary", "in_scope", "scope_note", "start_date", "end_date", "psi_url", "profile",
         "uses_data_from", "sub_research_area", "configuration", "key_variables")
    put("/api/investigations", [{k: i.get(k) for k in K} for i in repo.investigations(True)])
    for i in invs:
        inv = repo.investigation(i["accession"])
        tests = repo.tests([inv["accession"]])
        inv["variation"] = compare_svc.describe_variation(tests)
        inv["test_preview"] = tests[:25]
        put(f"/api/investigations/{inv['accession']}", inv)
    put("/api/habitats", repo.habitats())
    for ox in (False, True):
        put(f"/api/coverage?include_oxidizer_stream={str(ox).lower()}", coverage_svc.coverage(repo, None, ox))
    put("/api/insights", repo.insights())
    put("/api/earth", repo.earth())
    put("/api/analysis/flex", analysis.flex_case(repo))
    put("/api/kg/graph", kg.graph(conn, None, None, 1500, False))
    put("/api/kg/overview", kg.overview(conn))
    from flameatlas.knowledge import obsidian
    (out / "Fire-Lab-vault.zip").write_bytes(obsidian.export_zip(conn))

    # ---- table for client-side extraction / variables / scatter
    req = export_svc.ExtractRequest(accessions=[], record_types=["test", "session", "test_matrix"])
    full = export_svc.extract(repo, req)
    in_scope = {i["accession"] for i in invs if i["in_scope"]}
    qcols = [c for c in full["columns"] if c not in export_svc.BASE_COLUMNS]
    put("/api/_table", {
        "base_columns": export_svc.BASE_COLUMNS, "quantity_columns": qcols,
        "rows": [[r.get(c) for c in export_svc.BASE_COLUMNS + qcols] for r in full["rows"]],
        "in_scope": sorted(in_scope),
        "test_vars": {k: {"col": c, "scale": s, "unit": u} for k, (c, s, u) in analysis.TEST_VARS.items()},
        "dictionary": export_svc.data_dictionary(repo, full["columns"]),
        "variables": repo.variables(),
        "sources": {i["accession"]: {"accession": i["accession"], "acronym": i["acronym"], "title": i["title"], "doi": i["doi"],
                                     "doi_url": f"https://doi.org/{i['doi']}" if i["doi"] else None, "psi_url": i["psi_url"],
                                     "psi_version": i.get("psi_version"), "license": i.get("license")} for i in invs},
        "limitations": export_svc.LIMITATIONS, "version": __version__,
    })

    # ---- prepared questions
    index = []
    for q in QUESTIONS:
        r = research.research(conn, q)
        rk = rank(repo, Scenario.from_dict({"query": q, "include_ground_studies": True}))
        name = f"q{len(index):03d}"
        (out / f"{name}.json").write_text(json.dumps({"research": r, "rank": rk}, default=str, separators=(",", ":")), encoding="utf-8")
        index.append({"q": q, "file": f"{name}.json"})
        print(f"  {name}  {q}")
    (out / "questions.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(f"{len(list(out.iterdir()))} files written to {out}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "frontend" / "dist" / "static-api"))
