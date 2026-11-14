"""Knowledge-graph storage and construction (same SQLite file as the evidence database).

Separation of concerns:
  kg_document  original files (bytes kept on disk under data/documents/) + metadata, versioning, sha256 dedup
  chunk/FTS    searchable passages (shared with the existing hybrid search index)
  kg_value     numbers with units extracted from documents, as written
  kg_node      stable identifiers: doc:PSI-25, pub:123, concept:extinction, entity:iss, data:pressure_kpa, research:flex-diluents
  kg_edge      typed, directed relationships; every edge carries its basis and evidence (passage, table, metadata)
  kg_research  reproducible research results (query, sources and passages used, graph state)
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

from ..config import DATA_DIR
from ..services.query_parser import fold
from .extract import ParsedDoc, chunk_sections, extract_values, find_terms, parse_file, sha256, snippet
from .ontology import CONCEPTS, ENTITIES, NODE_TYPES, RELATIONS

DOC_DIR = DATA_DIR / "documents"

SCHEMA = """
CREATE TABLE IF NOT EXISTS kg_document (
    id TEXT PRIMARY KEY, title TEXT, kind TEXT, source TEXT, filename TEXT, sha256 TEXT, version INTEGER,
    bytes INTEGER, path TEXT, created REAL, meta TEXT, warnings TEXT, owner TEXT DEFAULT 'local', visibility TEXT DEFAULT 'private'
);
CREATE INDEX IF NOT EXISTS idx_kgdoc_sha ON kg_document(sha256);
CREATE TABLE IF NOT EXISTS kg_value (
    id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT, chunk_id INTEGER, quantity TEXT, value REAL, unit TEXT, raw TEXT,
    context TEXT, locator TEXT, confidence REAL
);
CREATE TABLE IF NOT EXISTS kg_node (
    id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, description TEXT, props TEXT, origin TEXT
);
CREATE TABLE IF NOT EXISTS kg_edge (
    id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL, rel TEXT NOT NULL, basis TEXT NOT NULL,
    evidence TEXT, weight REAL DEFAULT 1, origin TEXT
);
CREATE INDEX IF NOT EXISTS idx_kgedge_src ON kg_edge(src);
CREATE INDEX IF NOT EXISTS idx_kgedge_dst ON kg_edge(dst);
CREATE TABLE IF NOT EXISTS kg_research (
    id TEXT PRIMARY KEY, query TEXT, created REAL, result TEXT
);
"""


def init(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def _eid(src: str, rel: str, dst: str) -> str:
    return "e:" + hashlib.sha1(f"{src}|{rel}|{dst}".encode()).hexdigest()[:16]


class Graph:
    """Small write helper with idempotent upserts (re-processing never duplicates nodes or edges)."""

    def __init__(self, conn: sqlite3.Connection, origin: str):
        self.conn, self.origin = conn, origin

    def node(self, nid: str, type_: str, label: str, description: str = "", props: dict | None = None) -> str:
        self.conn.execute(
            "INSERT INTO kg_node(id,type,label,description,props,origin) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET type=excluded.type,label=excluded.label,description=excluded.description,props=excluded.props",
            (nid, type_, label, description, json.dumps(props or {}), self.origin))
        return nid

    def edge(self, src: str, rel: str, dst: str, basis: str, evidence: list[dict] | dict | None = None, weight: float = 1.0) -> str:
        assert rel in RELATIONS, rel
        eid = _eid(src, rel, dst)
        ev = evidence if isinstance(evidence, list) else ([evidence] if evidence else [])
        row = self.conn.execute("SELECT evidence FROM kg_edge WHERE id=?", (eid,)).fetchone()
        if row:
            old = json.loads(row[0] or "[]")
            keys = {json.dumps(e, sort_keys=True) for e in old}
            merged = old + [e for e in ev if json.dumps(e, sort_keys=True) not in keys]
            self.conn.execute("UPDATE kg_edge SET evidence=?, weight=MAX(weight,?) WHERE id=?", (json.dumps(merged[:12]), weight, eid))
        else:
            self.conn.execute("INSERT INTO kg_edge(id,src,dst,rel,basis,evidence,weight,origin) VALUES(?,?,?,?,?,?,?,?)",
                              (eid, src, dst, rel, basis, json.dumps(ev[:12]), weight, self.origin))
        return eid


# ------------------------------------------------------------------ build from the PSI evidence database
def build_from_psi(conn: sqlite3.Connection) -> dict[str, int]:
    init(conn)
    conn.execute("DELETE FROM kg_edge WHERE origin='psi'")
    conn.execute("DELETE FROM kg_node WHERE origin='psi'")
    g = Graph(conn, "psi")
    for cid, c in CONCEPTS.items():
        g.node(f"concept:{cid}", "concept", c["label"], c["description"], {"aliases": c["aliases"]})
    for eid, e in ENTITIES.items():
        g.node(f"entity:{eid}", "entity", e["label"], e["kind"], {"kind": e["kind"], "aliases": e["aliases"]})

    invs = [dict(r) for r in conn.execute("SELECT * FROM investigation")]
    by_acc = {i["accession"]: i for i in invs}
    for inv in invs:
        acc = inv["accession"]
        name = inv["acronym"] or acc
        g.node(f"doc:{acc}", "document", f"{name} — {inv['title']}" if inv["acronym"] else inv["title"],
               (inv.get("summary") or inv.get("objective") or "")[:400],
               {"accession": acc, "acronym": inv["acronym"], "doi": inv["doi"], "kind": "PSI investigation",
                "project_type": inv["project_type"], "platform": inv["flight_platform"], "hardware": inv["hardware"],
                "family": inv["family"], "dates": [inv["start_date"], inv["end_date"]], "url": inv["psi_url"], "in_scope": bool(inv["in_scope"])})
        # entities from metadata
        meta_text = " ".join(str(inv.get(k) or "") for k in ("flight_platform", "hardware", "nasa_center"))
        for ent, form in find_terms(meta_text, "entity").items():
            rel = "depends_on" if ENTITIES[ent]["kind"] == "facility" else "mentions"
            g.edge(f"doc:{acc}", rel, f"entity:{ent}", "metadata", {"field": "platform / hardware", "quote": meta_text.strip()[:200], "match": form})
    # concepts & entities from text passages (evidence = the passage)
    for ch in conn.execute("SELECT id, accession, section, text FROM chunk"):
        acc = ch["accession"]
        if acc not in by_acc:
            continue
        src = f"doc:{acc}"
        if ch["section"].startswith("insight:"):
            continue
        for cid, form in find_terms(ch["text"], "concept").items():
            g.edge(src, "mentions", f"concept:{cid}", "text", {"chunk_id": ch["id"], "section": ch["section"], "quote": snippet(ch["text"], form), "match": form})
        for eid, form in find_terms(ch["text"], "entity").items():
            g.edge(src, "mentions", f"entity:{eid}", "text", {"chunk_id": ch["id"], "section": ch["section"], "quote": snippet(ch["text"], form), "match": form})
    # programme lineage and explicit references
    fam: dict[str, list[dict]] = defaultdict(list)
    for inv in invs:
        if inv["family"] and inv["family"] not in ("Ground study", "Out of scope"):
            fam[inv["family"]].append(inv)
        for rel_acc in json.loads(inv["related"] or "[]") if isinstance(inv["related"], str) else (inv["related"] or []):
            if rel_acc in by_acc and rel_acc != inv["accession"]:
                g.edge(f"doc:{inv['accession']}", "references", f"doc:{rel_acc}", "metadata", {"field": "PSI related investigations"})
        for used in json.loads(inv["uses_data_from"] or "[]") if isinstance(inv["uses_data_from"], str) else (inv["uses_data_from"] or []):
            if used in by_acc:
                g.edge(f"doc:{inv['accession']}", "depends_on", f"doc:{used}", "metadata", {"field": "ground study re-uses flight data from"})
    for members in fam.values():
        members.sort(key=lambda i: (i["start_date"] or "", i["accession"]))
        for a, b in zip(members, members[1:]):
            g.edge(f"doc:{b['accession']}", "extends", f"doc:{a['accession']}", "metadata",
                   {"field": "programme family", "quote": f"{b['acronym'] or b['accession']} ({b['start_date'] or '?'}) follows {a['acronym'] or a['accession']} ({a['start_date'] or '?'}) in the {b['family']} family"})
    # publications describe their investigation
    for p in conn.execute("SELECT id, accession, title, authors, doi FROM publication"):
        if p["accession"] not in by_acc or not p["title"]:
            continue
        g.node(f"pub:{p['id']}", "document", p["title"][:220], (p["authors"] or "")[:300], {"kind": "publication", "doi": p["doi"], "authors": p["authors"], "accession": p["accession"]})
        g.edge(f"pub:{p['id']}", "describes", f"doc:{p['accession']}", "metadata", {"field": "PSI publication list"})
        for cid, form in find_terms(p["title"], "concept").items():
            g.edge(f"pub:{p['id']}", "mentions", f"concept:{cid}", "text", {"section": "title", "quote": p["title"][:220], "match": form})
    # data nodes: measured quantities with ranges per investigation (from the test tables)
    var = {r["name"]: dict(r) for r in conn.execute("SELECT * FROM variable")}
    cond_cols = {"o2_mole_frac": ("O2 mole fraction", "-", "oxygen-concentration"), "pressure_kpa": ("Pressure", "kPa", "pressure"),
                 "flow_cm_s": ("Flow velocity", "cm/s", "flow-velocity"), "thickness_mm": ("Fuel thickness", "mm", "fuel-thickness"),
                 "co2_mole_frac": ("CO2 mole fraction", "-", "suppressant"), "he_mole_frac": ("Helium mole fraction", "-", "suppressant")}
    for col, (label, unit, concept) in cond_cols.items():
        nid = g.node(f"data:{col}", "data", label, f"Test condition recorded in PSI tables ({unit}).", {"unit": unit, "column": col})
        g.edge(nid, "contains_related_data", f"concept:{concept}", "metadata", {"field": "variable definition"})
        for r in conn.execute(f"SELECT accession, COUNT({col}) n, MIN({col}) lo, MAX({col}) hi FROM test WHERE {col} IS NOT NULL GROUP BY accession"):
            if r["n"]:
                g.edge(f"doc:{r['accession']}", "measures", nid, "table",
                       {"tests": r["n"], "min": r["lo"], "max": r["hi"], "unit": unit, "source": "PSI test tables (see Extract for rows)"}, weight=min(3.0, 1 + r["n"] / 200))
    for r in conn.execute("SELECT m.quantity q, t.accession acc, COUNT(*) n, MIN(m.value) lo, MAX(m.value) hi, MAX(m.unit) unit FROM measurement m JOIN test t ON t.test_id=m.test_id WHERE m.value IS NOT NULL GROUP BY m.quantity, t.accession"):
        v = var.get(r["q"]) or {}
        nid = g.node(f"data:{r['q']}", "data", v.get("label") or r["q"].replace("_", " "), v.get("description") or "Measured quantity", {"unit": r["unit"] or v.get("unit")})
        g.edge(f"doc:{r['acc']}", "measures", nid, "table", {"tests": r["n"], "min": r["lo"], "max": r["hi"], "unit": r["unit"], "source": "PSI measurement tables"}, weight=min(3.0, 1 + r["n"] / 200))
    # habitat envelopes (data) and which investigations hold tests inside them
    for h in conn.execute("SELECT * FROM habitat"):
        nid = g.node(f"data:habitat-{h['id']}", "data", f"Atmosphere — {h['name']}",
                     f"{h['o2_pct_min']}–{h['o2_pct_max']} % O2, {h['pressure_kpa_min']}–{h['pressure_kpa_max']} kPa, {h['gravity']} ({h['status']}).",
                     {"o2_pct": [h["o2_pct_min"], h["o2_pct_max"]], "pressure_kpa": [h["pressure_kpa_min"], h["pressure_kpa_max"]], "status": h["status"], "source": h["source"]})
        g.edge(nid, "contains_related_data", "concept:spacecraft-atmosphere", "metadata", {"field": "habitat envelope", "quote": h["source"]})
        body = {"lunar": "moon", "martian": "mars", "microgravity": "iss"}.get(h["gravity"])
        if body:
            g.edge(nid, "contains_related_data", f"entity:{body}", "metadata", {"field": "habitat gravity", "quote": h["note"]})
        for r in conn.execute("SELECT accession, COUNT(*) n FROM test WHERE o2_mole_frac*100 BETWEEN ? AND ? AND pressure_kpa BETWEEN ? AND ? GROUP BY accession",
                              (h["o2_pct_min"], h["o2_pct_max"], h["pressure_kpa_min"], h["pressure_kpa_max"])):
            g.edge(f"doc:{r['accession']}", "contains_related_data", nid, "table", {"tests_inside_envelope": r["n"], "source": "PSI test tables"})
    # research nodes: findings and hypotheses, supported by their sources
    for ins in conn.execute("SELECT * FROM insight"):
        nid = g.node(f"research:{ins['id']}", "research", ins["title"], ins["observation"][:400],
                     {"evidence_kind": ins["evidence_kind"], "conditions": ins["conditions"], "limitation": ins["limitation"], "design_question": ins["design_question"], "next_validation": ins["next_validation"]})
        for s in json.loads(ins["sources"] or "[]"):
            if s.get("accession") in by_acc:
                g.edge(f"doc:{s['accession']}", "supports", nid, "computed" if ins["evidence_kind"] == "computed_from_table" else "text",
                       {"field": s.get("field"), "quote": ins["observation"][:300], "evidence_kind": ins["evidence_kind"]})
        for cid, form in find_terms(f"{ins['title']} {ins['observation']}", "concept").items():
            g.edge(nid, "mentions", f"concept:{cid}", "text", {"quote": snippet(ins["observation"], form), "match": form})
    # curated contradiction stated in PSI text (1-g screening vs microgravity behaviour)
    sf2 = conn.execute("SELECT id FROM insight WHERE id='saffire2-ug-vs-1g'").fetchone()
    scr = conn.execute("SELECT id FROM insight WHERE id='bass-1g-screening-gap'").fetchone()
    if sf2 and scr:
        q = conn.execute("SELECT observation FROM insight WHERE id='saffire2-ug-vs-1g'").fetchone()[0]
        g.edge("research:saffire2-ug-vs-1g", "contradicts", "concept:material-flammability", "curated",
               {"quote": q[:300], "note": "A material ranking obtained in 1 g did not hold in microgravity for some samples."})
    # inferred: documents sharing ≥ 2 concepts / the same measured quantity
    _infer(conn, g)
    conn.commit()
    return {t: n for t, n in conn.execute("SELECT type, COUNT(*) FROM kg_node GROUP BY type")}


def _infer(conn: sqlite3.Connection, g: Graph) -> None:
    conn.execute("DELETE FROM kg_edge WHERE basis='inferred'")
    concepts: dict[str, set[str]] = defaultdict(set)
    for r in conn.execute("SELECT src, dst FROM kg_edge WHERE rel='mentions' AND dst LIKE 'concept:%' AND src LIKE 'doc:%'"):
        concepts[r["src"]].add(r["dst"])
    docs = sorted(concepts)
    for i, a in enumerate(docs):
        for b in docs[i + 1:]:
            shared = concepts[a] & concepts[b]
            # require specific overlap: ≥3 shared concepts, excluding the near-universal ones
            specific = shared - {"concept:microgravity", "concept:fire-safety", "concept:temperature"}
            if len(specific) >= 3:
                g.edge(a, "shares_concept", b, "inferred", {"shared": sorted(c.split(":", 1)[1] for c in specific), "note": "Inferred from co-mentioned concepts; not a stated link."}, weight=len(specific) / 3)


# ------------------------------------------------------------------ ingestion of user documents
def ingest(conn: sqlite3.Connection, filename: str, data: bytes, source: str = "upload", extra_meta: dict | None = None) -> dict[str, Any]:
    init(conn)
    digest = sha256(data)
    dup = conn.execute("SELECT id, title, version FROM kg_document WHERE sha256=?", (digest,)).fetchone()
    if dup:
        return {"id": dup["id"], "title": dup["title"], "status": "duplicate", "version": dup["version"]}
    parsed: ParsedDoc = parse_file(filename, data)
    prev = conn.execute("SELECT id, version FROM kg_document WHERE filename=? AND source=? ORDER BY version DESC LIMIT 1", (filename, source)).fetchone()
    doc_id = prev["id"] if prev else "DOC-" + digest[:10]
    version = (prev["version"] + 1) if prev else 1
    if prev:  # new version replaces the indexed content of the previous one
        _remove_doc_content(conn, doc_id)
    DOC_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", filename)[-80:]
    path = DOC_DIR / f"{doc_id}_v{version}_{safe}"
    path.write_bytes(data)
    meta = {**parsed.meta, **(extra_meta or {}), "tags": parsed.tags, "wikilinks": parsed.wikilinks}
    conn.execute("INSERT OR REPLACE INTO kg_document(id,title,kind,source,filename,sha256,version,bytes,path,created,meta,warnings) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                 (doc_id, parsed.title, parsed.kind, source, filename, digest, version, len(data), str(path), time.time(), json.dumps(meta, default=str), json.dumps(parsed.warnings)))
    g = Graph(conn, f"upload:{doc_id}")
    g.node(f"doc:{doc_id}", "document", parsed.title, (parsed.text[:400]).strip(), {"kind": parsed.kind, "filename": filename, "version": version, "source": source, "tags": parsed.tags, "doc_id": doc_id})
    chunks = chunk_sections(parsed.sections)
    n_vals = 0
    for s in chunks:
        cur = conn.execute("INSERT INTO chunk(accession, section, text) VALUES(?,?,?)", (doc_id, f"{s.title} [{s.locator}]", s.text))
        cid = cur.lastrowid
        for c, form in find_terms(s.text, "concept").items():
            g.edge(f"doc:{doc_id}", "mentions", f"concept:{c}", "text", {"chunk_id": cid, "section": s.locator, "quote": snippet(s.text, form), "match": form})
        for e, form in find_terms(s.text, "entity").items():
            g.edge(f"doc:{doc_id}", "mentions", f"entity:{e}", "text", {"chunk_id": cid, "section": s.locator, "quote": snippet(s.text, form), "match": form})
        for v in extract_values(s.text):
            conn.execute("INSERT INTO kg_value(doc_id,chunk_id,quantity,value,unit,raw,context,locator,confidence) VALUES(?,?,?,?,?,?,?,?,?)",
                         (doc_id, cid, v["quantity"], v["value"], v["unit"], v["raw"], v["context"], s.locator, 0.6))
            n_vals += 1
    # extracted values → data nodes (one per quantity), with the values as evidence
    for q, n, lo, hi in conn.execute("SELECT quantity, COUNT(*), MIN(value), MAX(value) FROM kg_value WHERE doc_id=? GROUP BY quantity", (doc_id,)):
        nid = g.node(f"data:extracted-{q}", "data", f"{q.capitalize()} values in documents", "Numbers with units extracted from uploaded documents (as written).", {"quantity": q})
        ex = [dict(r) for r in conn.execute("SELECT raw, context, locator FROM kg_value WHERE doc_id=? AND quantity=? LIMIT 5", (doc_id, q))]
        g.edge(f"doc:{doc_id}", "measures", nid, "text", [{"values": n, "min": lo, "max": hi, "examples": ex}])
    # wikilinks → references (resolved against existing document titles / node labels)
    for link in parsed.wikilinks:
        tgt = _resolve_link(conn, link)
        if tgt and tgt != f"doc:{doc_id}":
            g.edge(f"doc:{doc_id}", "references", tgt, "wikilink", {"link": f"[[{link}]]"})
    conn.execute("INSERT INTO chunk_fts(chunk_fts) VALUES ('rebuild')")
    _infer(conn, Graph(conn, "psi"))
    conn.commit()
    from ..services import search as search_mod
    search_mod._INDEX.clear()  # rebuild the hybrid index on next query
    return {"id": doc_id, "title": parsed.title, "status": "updated" if prev else "created", "version": version,
            "kind": parsed.kind, "chunks": len(chunks), "values": n_vals, "wikilinks": parsed.wikilinks, "warnings": parsed.warnings}


def restore_documents(conn: sqlite3.Connection) -> int:
    """Re-ingest the latest stored original of every uploaded document (after a database rebuild)."""
    if not DOC_DIR.exists():
        return 0
    latest: dict[str, tuple[int, Path]] = {}
    for p in DOC_DIR.iterdir():
        m = re.match(r"^(DOC-[0-9a-f]+)_v(\d+)_(.+)$", p.name)
        if m and (m.group(1) not in latest or int(m.group(2)) > latest[m.group(1)][0]):
            latest[m.group(1)] = (int(m.group(2)), p)
    n = 0
    for _, (_, p) in latest.items():
        name = re.sub(r"^DOC-[0-9a-f]+_v\d+_", "", p.name)
        try:
            ingest(conn, name, p.read_bytes(), source="restored"); n += 1
        except Exception:
            continue
    return n


def _remove_doc_content(conn: sqlite3.Connection, doc_id: str) -> None:
    conn.execute("DELETE FROM chunk WHERE accession=?", (doc_id,))
    conn.execute("INSERT INTO chunk_fts(chunk_fts) VALUES ('rebuild')")
    conn.execute("DELETE FROM kg_value WHERE doc_id=?", (doc_id,))
    conn.execute("DELETE FROM kg_edge WHERE origin=?", (f"upload:{doc_id}",))


def delete_document(conn: sqlite3.Connection, doc_id: str) -> bool:
    if not conn.execute("SELECT 1 FROM kg_document WHERE id=?", (doc_id,)).fetchone():
        return False
    _remove_doc_content(conn, doc_id)
    conn.execute("DELETE FROM kg_node WHERE id=?", (f"doc:{doc_id}",))
    conn.execute("DELETE FROM kg_edge WHERE src=? OR dst=?", (f"doc:{doc_id}", f"doc:{doc_id}"))
    conn.execute("DELETE FROM kg_document WHERE id=?", (doc_id,))
    conn.commit()
    from ..services import search as search_mod
    search_mod._INDEX.clear()
    return True


def _resolve_link(conn: sqlite3.Connection, link: str) -> str | None:
    l = link.strip()
    m = re.match(r"^(PSI-\d+)", l, re.I)
    if m:
        return f"doc:{m.group(1).upper()}"
    row = conn.execute("SELECT id FROM kg_node WHERE lower(label)=lower(?) OR lower(id)=lower(?) LIMIT 1", (l, l)).fetchone()
    if row:
        return row[0]
    row = conn.execute("SELECT id FROM kg_document WHERE lower(title)=lower(?) OR lower(filename) IN (lower(?), lower(?)) LIMIT 1", (l, l, l + ".md")).fetchone()
    if row:
        return f"doc:{row[0]}"
    for cid, c in CONCEPTS.items():
        if fold(l) in (fold(c["label"]), *map(fold, c["aliases"])):
            return f"concept:{cid}"
    return None


# ------------------------------------------------------------------ queries
def _node(r: sqlite3.Row) -> dict[str, Any]:
    return {"id": r["id"], "type": r["type"], "label": r["label"], "description": r["description"], "props": json.loads(r["props"] or "{}")}


def _edge(r: sqlite3.Row) -> dict[str, Any]:
    return {"id": r["id"], "src": r["src"], "dst": r["dst"], "rel": r["rel"], "basis": r["basis"], "evidence": json.loads(r["evidence"] or "[]"), "weight": r["weight"]}


def overview(conn: sqlite3.Connection) -> dict[str, Any]:
    init(conn)
    return {
        "nodes": {t: n for t, n in conn.execute("SELECT type, COUNT(*) FROM kg_node GROUP BY type")},
        "edges": {t: n for t, n in conn.execute("SELECT rel, COUNT(*) FROM kg_edge GROUP BY rel")},
        "bases": {t: n for t, n in conn.execute("SELECT basis, COUNT(*) FROM kg_edge GROUP BY basis")},
        "documents": conn.execute("SELECT COUNT(*) FROM kg_document").fetchone()[0],
        "node_types": NODE_TYPES, "relations": RELATIONS,
    }


def graph(conn: sqlite3.Connection, types: list[str] | None = None, rels: list[str] | None = None, limit: int = 1500,
          include_publications: bool = False) -> dict[str, Any]:
    """Aggregated graph for the explorer. Publications are collapsed into a count on their investigation unless asked."""
    init(conn)
    q = "SELECT * FROM kg_node"
    nodes = [_node(r) for r in conn.execute(q)]
    if not include_publications:
        pubcount = defaultdict(int)
        for r in conn.execute("SELECT dst FROM kg_edge WHERE rel='describes' AND src LIKE 'pub:%'"):
            pubcount[r[0]] += 1
        nodes = [n for n in nodes if not n["id"].startswith("pub:")]
        for n in nodes:
            if n["id"] in pubcount:
                n["props"]["publications"] = pubcount[n["id"]]
    if types:
        nodes = [n for n in nodes if n["type"] in types]
    ids = {n["id"] for n in nodes}
    edges = [_edge(r) for r in conn.execute("SELECT * FROM kg_edge")]
    edges = [e for e in edges if e["src"] in ids and e["dst"] in ids and (not rels or e["rel"] in rels)]
    deg = defaultdict(int)
    for e in edges:
        deg[e["src"]] += 1; deg[e["dst"]] += 1
    for n in nodes:
        n["degree"] = deg[n["id"]]
    nodes.sort(key=lambda n: -n["degree"])
    nodes = nodes[:limit]
    ids = {n["id"] for n in nodes}
    # evidence is heavy: ship a count and the first quote only; full evidence via /edge/{id}
    slim = [{**{k: e[k] for k in ("id", "src", "dst", "rel", "basis", "weight")}, "n_evidence": len(e["evidence"]),
             "quote": next((x.get("quote") for x in e["evidence"] if x.get("quote")), None)} for e in edges if e["src"] in ids and e["dst"] in ids]
    return {"nodes": nodes, "edges": slim}


def node_detail(conn: sqlite3.Connection, nid: str) -> dict[str, Any] | None:
    r = conn.execute("SELECT * FROM kg_node WHERE id=?", (nid,)).fetchone()
    if not r:
        return None
    n = _node(r)
    out_e = [_edge(e) for e in conn.execute("SELECT * FROM kg_edge WHERE src=?", (nid,))]
    in_e = [_edge(e) for e in conn.execute("SELECT * FROM kg_edge WHERE dst=?", (nid,))]
    others = {e["dst"] for e in out_e} | {e["src"] for e in in_e}
    labels = {x["id"]: {"label": x["label"], "type": x["type"]} for x in (dict(y) for y in conn.execute(
        f"SELECT id, label, type FROM kg_node WHERE id IN ({','.join('?' * len(others))})", tuple(others)))} if others else {}
    doc = None
    if n["type"] == "document":
        doc_key = n["props"].get("accession") or n["props"].get("doc_id")
        if n["id"].startswith("pub:"):
            doc_key = None
        if doc_key:
            passages = [dict(c) for c in conn.execute("SELECT id, section, text FROM chunk WHERE accession=? ORDER BY id", (doc_key,))]
            d = conn.execute("SELECT * FROM kg_document WHERE id=?", (doc_key,)).fetchone()
            doc = {"passages": passages[:60], "file": dict(d) if d else None,
                   "values": [dict(v) for v in conn.execute("SELECT quantity, value, unit, raw, context, locator FROM kg_value WHERE doc_id=? LIMIT 80", (doc_key,))]}
    return {"node": n, "out": out_e, "in": in_e, "labels": labels, "document": doc}


def edge_detail(conn: sqlite3.Connection, eid: str) -> dict[str, Any] | None:
    r = conn.execute("SELECT * FROM kg_edge WHERE id=?", (eid,)).fetchone()
    if not r:
        return None
    e = _edge(r)
    e["definition"] = RELATIONS.get(e["rel"])
    for k in ("src", "dst"):
        n = conn.execute("SELECT id, type, label FROM kg_node WHERE id=?", (e[k],)).fetchone()
        e[f"{k}_node"] = dict(n) if n else None
    for ev in e["evidence"]:
        if ev.get("chunk_id"):
            c = conn.execute("SELECT section, text, accession FROM chunk WHERE id=?", (ev["chunk_id"],)).fetchone()
            if c:
                ev["passage"] = dict(c)
    return e


def search_nodes(conn: sqlite3.Connection, q: str, limit: int = 20) -> list[dict[str, Any]]:
    fq = fold(q).strip()
    f = f"%{fq}%"
    rows = conn.execute("SELECT * FROM kg_node WHERE lower(label) LIKE ? OR lower(id) LIKE ? OR lower(description) LIKE ? OR lower(props) LIKE ? LIMIT 400", (f, f, f, f)).fetchall()

    def score(n: dict) -> tuple:
        lab = fold(n["label"]); acr = fold(n["props"].get("acronym") or "")
        exact = acr == fq or lab == fq or lab.split(" — ")[0] == fq
        return (0 if exact else 1, 1 if n["id"].startswith("pub:") else 0, 0 if lab.startswith(fq) or acr.startswith(fq) else 1, 0 if fq in lab else 1, len(lab))
    ranked = sorted((_node(r) for r in rows), key=score)
    return ranked[:limit]


def documents(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    init(conn)
    return [{**dict(r), "meta": json.loads(r["meta"] or "{}"), "warnings": json.loads(r["warnings"] or "[]")} for r in conn.execute("SELECT * FROM kg_document ORDER BY created DESC")]
