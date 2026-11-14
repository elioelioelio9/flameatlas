import csv
import io
import json
import zipfile

from flameatlas.services import analysis, assistant, coverage
from flameatlas.services.export import ExtractRequest, build_zip, extract


def test_extract_keeps_missing_empty(repo):
    res = extract(repo, ExtractRequest(accessions=["PSI-107"]), limit=5)
    assert res["total"] > 400
    assert all(r["o2_mole_frac"] is None for r in res["rows"])


def test_export_zip_contents(repo):
    data, info = build_zip(repo, ExtractRequest(accessions=["PSI-69"], o2_pct_min=20, o2_pct_max=22))
    z = zipfile.ZipFile(io.BytesIO(data))
    assert set(z.namelist()) == {"data.csv", "data_dictionary.csv", "provenance.json", "LIMITATIONS.md", "CITATION.txt"}
    rows = list(csv.DictReader(io.StringIO(z.read("data.csv").decode())))
    assert rows and all(0.2 <= float(r["o2_mole_frac"]) <= 0.22 for r in rows)
    prov = json.loads(z.read("provenance.json"))
    assert prov["sources"][0]["doi"] == "10.60555/mbq8-0451"
    assert "10.60555/mbq8-0451" in z.read("CITATION.txt").decode()


def test_coverage_gap_exploration_atmosphere(repo):
    cov = coverage.coverage(repo)
    g = next(x for x in cov["gaps"] if x["habitat"]["id"] == "exploration_34")
    assert "solid" not in g["by_fuel_phase"]


def test_flex_analysis_is_descriptive(repo):
    f = analysis.flex_case(repo)
    assert f["n_tests"] == 274
    for fit in f["fits_k_vs_o2_1atm_n2"].values():
        assert fit["kind"].startswith("descriptive") and fit["n"] >= 4


def test_assistant_refuses_out_of_scope(repo):
    a = assistant.answer(repo, "How do I make rocket propellant safer?")
    assert a["mode"] == "out_of_scope"


def test_assistant_lunar_warning_and_citations(repo):
    a = assistant.answer(repo, "Is cutting ventilation enough to stop a fire in a Moon base at 34% oxygen?")
    assert any("Partial gravity" in w for w in a["warnings"])
    assert "[S" in a["answer"] and a["sources"]
    assert any(s["accession"] == "PSI-20" for s in a["sources"])


def test_benchmark_questions(repo):
    """Reference questions: the expected investigation must be among the top-3 ranked."""
    import pathlib

    cases = json.loads((pathlib.Path(__file__).parent / "benchmark_questions.json").read_text())
    failures = []
    for c in cases:
        a = assistant.answer(repo, c["question"])
        got = [r["accession"] for r in a.get("ranking", [])][:3]
        if c["expect_top3"] not in got:
            failures.append((c["question"], c["expect_top3"], got))
    assert not failures, failures
