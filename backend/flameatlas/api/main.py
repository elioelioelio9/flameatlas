"""FlameAtlas REST API (FastAPI).

Run:  uvicorn flameatlas.api.main:app --reload --port 8000     (from the backend/ folder)
Docs: http://localhost:8000/docs
"""

from __future__ import annotations

import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .. import __version__
from ..config import FRONTEND_DIST, settings
from ..db import connect
from ..etl.curation import NEEDS, PILLARS
from ..services import analysis, assistant, compare as compare_svc, coverage as coverage_svc, export as export_svc
from ..services.query_parser import parse_query
from ..services.ranking import Scenario, rank
from ..services.repository import Repository
from ..services.search import get_index

_LOCK = threading.RLock()
_STATE: dict[str, Any] = {}


def repo() -> Repository:
    return _STATE["repo"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_path = Path(settings.db_path)
    if not db_path.exists():
        from ..etl.build import build
        build(db_path)
    conn = connect(db_path)
    _STATE["repo"] = Repository(conn)
    get_index(conn)  # warm the search index
    from ..knowledge import store as kg
    kg.init(conn)
    if not conn.execute("SELECT COUNT(*) FROM kg_node WHERE origin='psi'").fetchone()[0]:
        kg.build_from_psi(conn)
    yield
    conn.close()


app = FastAPI(
    title="FlameAtlas API",
    version=__version__,
    description=("Evidence engine for spacecraft fire safety built on NASA Physical Sciences Informatics (PSI) "
                 "microgravity combustion data. Every record is traceable to its PSI file, row and DOI."),
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["*"], allow_headers=["*"])


# ------------------------------------------------------------------ models
Need = Literal["materials", "extinction", "detection"]


class ScenarioIn(BaseModel):
    need: Optional[Need] = None
    fuel_phase: Optional[Literal["solid", "liquid", "gas", "aerosol"]] = None
    gravity: Optional[Literal["microgravity", "lunar", "martian", "earth"]] = None
    habitat: Optional[str] = None
    o2_pct: Optional[float] = Field(None, ge=0, le=100)
    pressure_kpa: Optional[float] = Field(None, ge=0, le=1000)
    flow_cm_s: Optional[float] = Field(None, ge=0, le=500)
    query: Optional[str] = Field(None, max_length=500)
    include_ground_studies: bool = True
    include_out_of_scope: bool = False


class ExtractIn(BaseModel):
    accessions: list[str] = []
    record_types: list[str] = ["test"]
    fuel_phase: Optional[str] = None
    o2_pct_min: Optional[float] = None
    o2_pct_max: Optional[float] = None
    pressure_kpa_min: Optional[float] = None
    pressure_kpa_max: Optional[float] = None
    flow_cm_s_min: Optional[float] = None
    flow_cm_s_max: Optional[float] = None
    outcome_classes: list[str] = []
    quantities: Optional[list[str]] = None
    exclude_flags: list[str] = []
    require_complete: list[str] = []


class AskIn(BaseModel):
    question: str = Field(..., min_length=2, max_length=800)
    scenario: Optional[ScenarioIn] = None


# ------------------------------------------------------------------ routes
@app.get("/api/health", tags=["meta"])
def health() -> dict[str, Any]:
    return {"status": "ok", "version": __version__, "llm": settings.active_llm}


@app.get("/api/meta", tags=["meta"])
def meta() -> dict[str, Any]:
    with _LOCK:
        m = repo().meta()
        invs = repo().investigations()
    return {
        "version": __version__, "llm": settings.active_llm, "database": m, "needs": NEEDS, "pillars": PILLARS,
        "counts": {"investigations": len(invs), "in_scope": sum(1 for i in invs if i["in_scope"]),
                   "tests": int(m.get("n_tests", 0)), "measurements": int(m.get("n_measurements", 0)),
                   "insights": int(m.get("n_insights", 0))},
        "sources": [{"label": "NASA PSI repository", "url": "https://psi.nasa.gov/physci/repo/search?q=combustion"},
                    {"label": "Challenge", "url": "https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/"}],
    }


@app.get("/api/investigations", tags=["investigations"])
def list_investigations(need: Optional[Need] = None, pillar: Optional[str] = None,
                        include_out_of_scope: bool = True) -> list[dict[str, Any]]:
    with _LOCK:
        invs = repo().investigations(include_out_of_scope)
    out = []
    for i in invs:
        if need and not (i.get("needs") or {}).get(need):
            continue
        if pillar and pillar not in (i.get("pillars") or []):
            continue
        out.append({k: i[k] for k in ("accession", "acronym", "title", "doi", "family", "project_type", "flight_platform",
                                      "hardware", "fuel_phases", "pillars", "needs", "scale", "summary", "in_scope",
                                      "scope_note", "start_date", "end_date", "psi_url", "profile", "uses_data_from",
                                      "sub_research_area", "configuration", "key_variables")})
    return out


@app.get("/api/investigations/{accession}", tags=["investigations"])
def get_investigation(accession: str) -> dict[str, Any]:
    with _LOCK:
        inv = repo().investigation(accession.upper())
        if not inv:
            raise HTTPException(404, f"{accession} not found")
        tests = repo().tests([inv["accession"]])
    inv["variation"] = compare_svc.describe_variation(tests)
    inv["test_preview"] = tests[:25]
    return inv


@app.get("/api/investigations/{accession}/tests", tags=["investigations"])
def get_tests(accession: str, limit: int = Query(200, le=2000), offset: int = 0) -> dict[str, Any]:
    with _LOCK:
        tests = repo().tests([accession.upper()], limit=limit, offset=offset)
        meas = repo().measurements_for([t["test_id"] for t in tests])
    for t in tests:
        t["measurements"] = meas.get(t["test_id"], [])
    return {"accession": accession.upper(), "tests": tests}


@app.get("/api/habitats", tags=["scenarios"])
def habitats() -> list[dict[str, Any]]:
    with _LOCK:
        return repo().habitats()


@app.get("/api/parse", tags=["search"])
def parse(q: str = Query(..., max_length=500)) -> dict[str, Any]:
    return parse_query(q).to_dict()


@app.post("/api/rank", tags=["search"])
def rank_investigations(sc: ScenarioIn) -> dict[str, Any]:
    with _LOCK:
        return rank(repo(), Scenario.from_dict(sc.model_dump()))


@app.get("/api/search", tags=["search"])
def search(q: str = Query(..., min_length=2, max_length=500), limit: int = Query(10, le=50)) -> dict[str, Any]:
    with _LOCK:
        parsed = parse_query(q)
        passages = get_index(repo().conn).search(parsed, limit=limit)
        ranking = rank(repo(), Scenario(query=q), limit=8)
    return {"parsed": parsed.to_dict(), "passages": [p.to_dict() for p in passages], "ranking": ranking}


@app.get("/api/coverage", tags=["analysis"])
def coverage(fuel_phase: Optional[str] = None, include_oxidizer_stream: bool = False) -> dict[str, Any]:
    with _LOCK:
        return coverage_svc.coverage(repo(), fuel_phase, include_oxidizer_stream)


@app.get("/api/compare", tags=["analysis"])
def compare(ids: str = Query(..., description="Comma-separated PSI accessions, max 4")) -> dict[str, Any]:
    with _LOCK:
        return compare_svc.compare(repo(), [i.strip().upper() for i in ids.split(",") if i.strip()])


@app.get("/api/variables", tags=["extract"])
def variables(accessions: Optional[str] = None) -> dict[str, Any]:
    accs = [a.strip().upper() for a in accessions.split(",")] if accessions else None
    with _LOCK:
        return {"dictionary": repo().variables(), "plottable": analysis.available_variables(repo(), accs)}


@app.post("/api/extract/preview", tags=["extract"])
def extract_preview(req: ExtractIn, limit: int = Query(100, le=1000)) -> dict[str, Any]:
    with _LOCK:
        return export_svc.extract(repo(), export_svc.ExtractRequest.from_dict(req.model_dump()), limit=limit)


@app.post("/api/extract/export", tags=["extract"])
def extract_export(req: ExtractIn) -> Response:
    with _LOCK:
        data, info = export_svc.build_zip(repo(), export_svc.ExtractRequest.from_dict(req.model_dump()))
    name = "flameatlas_extract_" + ("_".join(info["accessions"][:4]) or "empty") + ".zip"
    return Response(content=data, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{name}"', "X-Rows": str(info["n_rows"])})


@app.get("/api/analysis/scatter", tags=["analysis"])
def scatter(x: str, y: str, accessions: Optional[str] = None, color: str = "accession") -> dict[str, Any]:
    accs = [a.strip().upper() for a in accessions.split(",")] if accessions else None
    with _LOCK:
        return analysis.scatter(repo(), x, y, accs, color=color)


@app.get("/api/analysis/flex", tags=["analysis"])
def flex() -> dict[str, Any]:
    with _LOCK:
        return analysis.flex_case(repo())


@app.get("/api/insights", tags=["insights"])
def insights(need: Optional[Need] = None, pillar: Optional[str] = None) -> list[dict[str, Any]]:
    with _LOCK:
        items = repo().insights()
    return [i for i in items if (not need or i["need"] == need) and (not pillar or i["pillar"] == pillar)]


@app.get("/api/earth", tags=["insights"])
def earth() -> list[dict[str, Any]]:
    with _LOCK:
        return repo().earth()


@app.post("/api/ask", tags=["assistant"])
def ask(body: AskIn) -> dict[str, Any]:
    with _LOCK:
        return assistant.answer(repo(), body.question, body.scenario.model_dump() if body.scenario else None)


# ------------------------------------------------------------------ frontend (production build)

# ------------------------------------------------------------------ knowledge engine
class ResearchIn(BaseModel):
    query: str = Field(..., min_length=2, max_length=800)


class FileIn(BaseModel):
    name: str = Field(..., max_length=240)
    content_base64: str


class FilesIn(BaseModel):
    files: list[FileIn] = Field(..., max_length=200)


class SyncIn(BaseModel):
    folder: Optional[str] = None


def _kg():
    from ..knowledge import obsidian, research, store
    return store, research, obsidian


@app.get("/api/kg/overview", tags=["knowledge"])
def kg_overview() -> dict[str, Any]:
    store, _, _ = _kg()
    with _LOCK:
        return store.overview(repo().conn)


@app.get("/api/kg/graph", tags=["knowledge"])
def kg_graph(types: Optional[str] = None, rels: Optional[str] = None, publications: bool = False, limit: int = Query(1500, le=5000)) -> dict[str, Any]:
    store, _, _ = _kg()
    with _LOCK:
        return store.graph(repo().conn, types.split(",") if types else None, rels.split(",") if rels else None, limit, publications)


@app.get("/api/kg/node", tags=["knowledge"])
def kg_node(id: str = Query(..., max_length=200)) -> dict[str, Any]:
    store, _, _ = _kg()
    with _LOCK:
        d = store.node_detail(repo().conn, id)
    if not d:
        raise HTTPException(404, f"Unknown node {id}")
    return d


@app.get("/api/kg/edge", tags=["knowledge"])
def kg_edge(id: str = Query(..., max_length=80)) -> dict[str, Any]:
    store, _, _ = _kg()
    with _LOCK:
        d = store.edge_detail(repo().conn, id)
    if not d:
        raise HTTPException(404, f"Unknown edge {id}")
    return d


@app.get("/api/kg/search", tags=["knowledge"])
def kg_search(q: str = Query(..., min_length=1, max_length=200)) -> list[dict[str, Any]]:
    store, _, _ = _kg()
    with _LOCK:
        return store.search_nodes(repo().conn, q)


@app.post("/api/kg/research", tags=["knowledge"])
def kg_research(body: ResearchIn) -> dict[str, Any]:
    _, research, _ = _kg()
    with _LOCK:
        return research.research(repo().conn, body.query)


@app.get("/api/kg/research", tags=["knowledge"])
def kg_research_history() -> list[dict[str, Any]]:
    _, research, _ = _kg()
    with _LOCK:
        return research.history(repo().conn)


@app.get("/api/kg/research/{rid}", tags=["knowledge"])
def kg_research_get(rid: str) -> dict[str, Any]:
    _, research, _ = _kg()
    with _LOCK:
        r = research.get(repo().conn, rid)
    if not r:
        raise HTTPException(404, "Unknown research id")
    return r


@app.get("/api/kg/documents", tags=["knowledge"])
def kg_documents() -> list[dict[str, Any]]:
    store, _, _ = _kg()
    with _LOCK:
        return store.documents(repo().conn)


@app.post("/api/kg/ingest", tags=["knowledge"])
def kg_ingest(body: FilesIn) -> list[dict[str, Any]]:
    import base64
    store, _, _ = _kg()
    out = []
    with _LOCK:
        for f in body.files:
            try:
                data = base64.b64decode(f.content_base64)
                if len(data) > 40 * 1024 * 1024:
                    raise ValueError("file larger than 40 MB")
                out.append({"file": f.name, **store.ingest(repo().conn, f.name, data)})
            except Exception as e:
                out.append({"file": f.name, "status": "error", "error": str(e)[:200]})
    return out


@app.get("/api/kg/documents/{doc_id}/file", tags=["knowledge"])
def kg_document_file(doc_id: str):
    with _LOCK:
        r = repo().conn.execute("SELECT path, filename FROM kg_document WHERE id=?", (doc_id,)).fetchone()
    if not r or not Path(r["path"]).exists():
        raise HTTPException(404, "Original file not found")
    return FileResponse(r["path"], filename=r["filename"])


@app.delete("/api/kg/documents/{doc_id}", tags=["knowledge"])
def kg_delete(doc_id: str) -> dict[str, Any]:
    store, _, _ = _kg()
    with _LOCK:
        ok = store.delete_document(repo().conn, doc_id)
    if not ok:
        raise HTTPException(404, "Unknown document")
    return {"deleted": doc_id}


@app.get("/api/kg/obsidian/export", tags=["knowledge"])
def kg_obsidian_export() -> Response:
    _, _, obsidian = _kg()
    with _LOCK:
        data = obsidian.export_zip(repo().conn)
    return Response(data, media_type="application/zip", headers={"content-disposition": 'attachment; filename="FlameAtlas-vault.zip"'})


@app.post("/api/kg/obsidian/sync", tags=["knowledge"])
def kg_obsidian_sync(body: SyncIn) -> dict[str, Any]:
    from ..config import REPO_ROOT
    _, _, obsidian = _kg()
    folder = Path(body.folder).expanduser() if body.folder else REPO_ROOT / "vault"
    try:
        with _LOCK:
            return obsidian.sync_folder(repo().conn, folder)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/kg/obsidian/import", tags=["knowledge"])
def kg_obsidian_import(body: FilesIn) -> list[dict[str, Any]]:
    import base64
    _, _, obsidian = _kg()
    with _LOCK:
        return obsidian.import_files(repo().conn, [(f.name, base64.b64decode(f.content_base64)) for f in body.files])


@app.post("/api/kg/rebuild", tags=["knowledge"])
def kg_rebuild() -> dict[str, Any]:
    store, _, _ = _kg()
    with _LOCK:
        return store.build_from_psi(repo().conn)

if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        target = FRONTEND_DIST / full_path
        if full_path and target.is_file():
            return FileResponse(target)
        return FileResponse(FRONTEND_DIST / "index.html")
