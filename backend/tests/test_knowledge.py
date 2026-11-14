"""Knowledge engine: graph construction, traceable edges, ingestion, dedup/versioning, research citations, Obsidian round trip."""
from __future__ import annotations

import io
import json
import shutil
import zipfile

import pytest

from flameatlas.db import connect
from flameatlas.knowledge import obsidian, research, store
from flameatlas.knowledge.extract import extract_values, find_terms, parse_file


@pytest.fixture()
def kconn(db_path, tmp_path, monkeypatch):
    p = tmp_path / "kg.db"
    shutil.copy(db_path, p)
    monkeypatch.setattr(store, "DOC_DIR", tmp_path / "docs")
    c = connect(p)
    store.build_from_psi(c)
    yield c
    c.close()


def test_graph_has_all_node_types_and_traceable_edges(kconn):
    ov = store.overview(kconn)
    assert set(ov["nodes"]) >= {"document", "concept", "entity", "data", "research"}
    for e in kconn.execute("SELECT basis, evidence, rel FROM kg_edge"):
        assert e["basis"] in {"metadata", "text", "table", "computed", "curated", "inferred", "wikilink"}
        if e["basis"] in ("text", "table", "inferred", "curated"):
            assert json.loads(e["evidence"]), f"{e['rel']} edge without evidence"


def test_text_edges_quote_the_passage(kconn):
    row = kconn.execute("SELECT evidence FROM kg_edge WHERE src='doc:PSI-26' AND dst='concept:extinction'").fetchone()
    ev = json.loads(row[0])[0]
    chunk = kconn.execute("SELECT text FROM chunk WHERE id=?", (ev["chunk_id"],)).fetchone()[0]
    assert "extinction" in chunk.lower()


def test_rebuild_is_idempotent(kconn):
    a = kconn.execute("SELECT COUNT(*) FROM kg_edge").fetchone()[0]
    store.build_from_psi(kconn)
    assert kconn.execute("SELECT COUNT(*) FROM kg_edge").fetchone()[0] == a


def test_measures_edges_match_test_tables(kconn):
    ev = json.loads(kconn.execute("SELECT evidence FROM kg_edge WHERE src='doc:PSI-25' AND dst='data:flow_cm_s'").fetchone()[0])[0]
    n, lo, hi = kconn.execute("SELECT COUNT(flow_cm_s), MIN(flow_cm_s), MAX(flow_cm_s) FROM test WHERE accession='PSI-25'").fetchone()
    assert (ev["tests"], ev["min"], ev["max"]) == (n, lo, hi)


def test_extract_values_keep_original_units():
    vals = extract_values("Pressure was 8.2 psia (56.5 kPa) with 34 % O2 and a flow of 20 cm/s.")
    raws = {v["raw"] for v in vals}
    assert {"8.2 psia", "56.5 kPa", "20 cm/s"} <= raws
    assert any(v["unit"] == "psia" and v["value"] == 8.2 for v in vals)


def test_find_terms_fr_en():
    assert "extinction" in find_terms("Comment éteindre le feu ? auto-extinction observée")
    assert "mars" in find_terms("base martienne", "entity")


def test_markdown_frontmatter_tags_wikilinks():
    d = parse_file("n.md", b"---\ntitle: T\ntags: [a, b]\n---\n# H\ntext [[PSI-20]] #c\n")
    assert d.title == "T" and d.wikilinks == ["PSI-20"] and set(d.tags) == {"a", "b", "c"}


def test_docx_and_xlsx_readers():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", '<w:document><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p><w:p><w:r><w:t>Spread at 21 cm/s.</w:t></w:r></w:p></w:body></w:document>')
    d = parse_file("r.docx", buf.getvalue())
    assert d.sections[0].title == "Results" and "21 cm/s" in d.text
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("xl/workbook.xml", '<workbook><sheets><sheet name="Data" sheetId="1"/></sheets></workbook>')
        z.writestr("xl/sharedStrings.xml", "<sst><si><t>o2</t></si><si><t>pmma</t></si></sst>")
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>21</v></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>')
    d = parse_file("t.xlsx", buf.getvalue())
    assert "sheet Data!A2:B2" in d.sections[0].locator and "o2: 21" in d.text


def test_ingest_dedup_versioning_and_delete(kconn):
    r1 = store.ingest(kconn, "notes.md", b"# Notes\nFlame spread at 21 cm/s in microgravity. [[PSI-26]]")
    assert r1["status"] == "created"
    assert store.ingest(kconn, "notes.md", b"# Notes\nFlame spread at 21 cm/s in microgravity. [[PSI-26]]")["status"] == "duplicate"
    r2 = store.ingest(kconn, "notes.md", b"# Notes\nFlame spread at 25 cm/s in microgravity. [[PSI-26]]")
    assert r2["status"] == "updated" and r2["version"] == 2 and r2["id"] == r1["id"]
    assert kconn.execute("SELECT COUNT(*) FROM kg_node WHERE id=?", (f"doc:{r1['id']}",)).fetchone()[0] == 1
    assert kconn.execute("SELECT COUNT(*) FROM chunk WHERE accession=?", (r1["id"],)).fetchone()[0] == 1
    assert kconn.execute("SELECT 1 FROM kg_edge WHERE src=? AND dst='doc:PSI-26' AND rel='references'", (f"doc:{r1['id']}",)).fetchone()
    assert store.delete_document(kconn, r1["id"])
    assert not kconn.execute("SELECT COUNT(*) FROM chunk WHERE accession=?", (r1["id"],)).fetchone()[0]


def test_research_cites_only_retrieved_sources(kconn):
    res = research.research(kconn, "Which data exist on smoke particle size for detectors?")
    ids = {s["id"] for s in res["sources"]}
    import re
    cited = set(re.findall(r"\[(S\d+)\]", res["answer"]))
    assert cited and cited <= ids
    assert any(n["id"].startswith("doc:PSI-10") for n in res["path"]["nodes"])  # SAME / SAME-R
    assert research.get(kconn, res["id"])["answer"] == res["answer"]  # reproducible


def test_research_without_evidence_says_so(kconn):
    res = research.research(kconn, "zzqx wqvv")
    assert "do not provide" in res["answer"] or res["mode"] in ("extractive", "no_evidence")


def test_obsidian_round_trip(kconn):
    files = obsidian.build_vault(kconn)
    note = next(t for p, t in files.items() if p.endswith("/BASS.md"))
    assert "[[" in note and note.startswith("---")
    z = obsidian.export_zip(kconn)
    out = obsidian.import_files(kconn, [("v.zip", z)])
    assert all(r["status"].startswith("skipped") for r in out)  # no echo of our own export
    out = obsidian.import_files(kconn, [("a.md", b"# A\nsee [[B]]"), ("b.md", b"# B\nsmoke detector")])
    a = next(r for r in out if r["file"] == "a.md")
    assert kconn.execute("SELECT 1 FROM kg_edge WHERE src=? AND rel='references'", (f"doc:{a['id']}",)).fetchone()
