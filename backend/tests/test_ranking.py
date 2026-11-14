"""Success criteria for the need-based ranking (the dashboard must understand a need, not a keyword)."""

from flameatlas.services.query_parser import parse_query
from flameatlas.services.ranking import rank


def top(repo, sc, n=3):
    return [r["accession"] for r in rank(repo, sc)["results"][:n]]


def test_materials_need_brings_solid_studies(repo):
    acc = top(repo, {"need": "materials", "fuel_phase": "solid", "gravity": "microgravity"}, 5)
    assert {"PSI-25", "PSI-26"} & set(acc[:3])
    assert all(a in {"PSI-25", "PSI-26", "PSI-98", "PSI-99", "PSI-100"} for a in acc)


def test_liquid_extinction_brings_flex(repo):
    assert top(repo, {"need": "extinction", "fuel_phase": "liquid"}, 1) == ["PSI-69"]


def test_detection_brings_same_r(repo):
    assert top(repo, {"need": "detection"}, 1) == ["PSI-101"]


def test_french_questions(repo):
    assert top(repo, {"query": "agents d'extinction pour des combustibles liquides"}, 1) == ["PSI-69"]
    assert top(repo, {"query": "données de fumée pour détecteurs"}, 1) == ["PSI-101"]


def test_moon_is_never_a_microgravity_match(repo):
    res = rank(repo, {"need": "materials", "habitat": "lunar_base"})["results"]
    for r in res:
        g = next(f for f in r["factors"] if f["factor"] == "gravity")
        assert g["status"] == "bounded"


def test_unknown_conditions_stay_unknown(repo):
    res = rank(repo, {"need": "materials", "pressure_kpa": 56.5})["results"]
    bass = next(r for r in res if r["accession"] == "PSI-26")
    p = next(f for f in bass["factors"] if f["factor"] == "pressure_kpa")
    assert p["status"] == "unknown"


def test_conditions_explain_differences(repo):
    res = rank(repo, {"need": "extinction", "o2_pct": 34, "pressure_kpa": 56.5})["results"]
    flex = next(r for r in res if r["accession"] == "PSI-69")
    statuses = {f["factor"]: f["status"] for f in flex["factors"]}
    assert statuses["o2_pct"] == "match" and statuses["pressure_kpa"] in ("partial", "mismatch")


def test_query_parser_units():
    q = parse_query("Moon base at 34% O2 and 8.2 psi with 20 cm/s ventilation")
    assert q.need is None or q.need in ("materials", "extinction", "detection")
    assert q.o2_pct == 34 and round(q.pressure_kpa, 1) == 56.5 and q.flow_cm_s == 20
    assert q.gravity == "lunar"
