"""Explainable ranking of investigations for a fire-safety need and a scenario.

Three dimensions are scored separately and shown to the user:
  relevance        does the investigation address the selected need? (+ text match to the question)
  condition fit    do the tested conditions cover the scenario? factor by factor, from the data itself
  data readiness   are test-level data and the needed variables available?

Rules (not a black box, not an LLM): unknown stays unknown, partial gravity is never a 'match'.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from typing import Any

from ..etl.curation import NEEDS
from .query_parser import ParsedQuery, parse_query
from .repository import Repository
from .search import get_index

STATUS_SCORE = {"match": 1.0, "partial": 0.55, "bounded": 0.5, "unknown": 0.3, "mismatch": 0.1}
WEIGHTS = {"relevance": 0.5, "fit": 0.3, "data": 0.2}

TOL = {  # (match tolerance, partial tolerance) around the tested range
    "o2_pct": (0.6, 4.0),
    "pressure_kpa": (3.0, 15.0),
    "flow_cm_s": (1.0, 5.0),
}

NEED_VARIABLES = {
    "materials": ["o2_mole_frac", "flow_cm_s", "thickness_mm", "flow_direction", "outcome_class"],
    "extinction": ["o2_mole_frac", "pressure_kpa", "co2_mole_frac", "he_mole_frac", "outcome_class",
                   "flame_extinction_diameter"],
    "detection": ["flow_cm_s", "net_aging_time_s", "weight_loss_rate", "heater_resistance_ratio", "material_class"],
}


@dataclass
class Scenario:
    need: str | None = None
    fuel_phase: str | None = None
    gravity: str | None = None
    habitat: str | None = None
    o2_pct: float | None = None
    pressure_kpa: float | None = None
    flow_cm_s: float | None = None
    query: str | None = None
    include_ground_studies: bool = True
    include_out_of_scope: bool = False

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Scenario":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__ and v not in ("", None)})


@dataclass
class Factor:
    factor: str
    label: str
    target: str
    tested: str
    status: str
    detail: str


@dataclass
class RankedInvestigation:
    accession: str
    acronym: str | None
    title: str
    doi: str | None
    family: str | None
    project_type: str | None
    score: float
    relevance: float
    fit: float | None
    data: float
    factors: list[Factor] = field(default_factory=list)
    why: list[str] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    matching_tests: int = 0
    top_passage: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        for k in ("score", "relevance", "data"):
            d[k] = round(d[k], 3)
        d["fit"] = None if self.fit is None else round(self.fit, 3)
        return d


def resolve_scenario(repo: Repository, sc: Scenario) -> tuple[Scenario, ParsedQuery | None, list[str]]:
    """Fill the scenario from the free-text query and from the habitat preset. Explicit fields win."""
    notes: list[str] = []
    parsed = parse_query(sc.query) if sc.query else None
    if parsed:
        for f in ("need", "fuel_phase", "gravity", "habitat", "o2_pct", "pressure_kpa", "flow_cm_s"):
            if getattr(sc, f) in (None, "") and getattr(parsed, f) is not None:
                setattr(sc, f, getattr(parsed, f))
                notes.append(f"{f} taken from your question")
    if sc.habitat:
        h = repo.habitat(sc.habitat)
        if h:
            if sc.o2_pct is None:
                sc.o2_pct = round((h["o2_pct_min"] + h["o2_pct_max"]) / 2, 2)
            if sc.pressure_kpa is None:
                sc.pressure_kpa = round((h["pressure_kpa_min"] + h["pressure_kpa_max"]) / 2, 2)
            if sc.gravity is None:
                sc.gravity = h["gravity"]
            notes.append(f"conditions from habitat preset '{h['name']}' ({h['status'].replace('_', ' ')})")
    return sc, parsed, notes


def _fmt_range(rng: list[float] | None, scale: float = 1.0, unit: str = "", digits: int = 1) -> str:
    if not rng:
        return "not reported"
    lo, hi = rng[0] * scale, rng[1] * scale
    if abs(hi - lo) < 10 ** -digits:
        return f"{lo:.{digits}f}{unit}"
    return f"{lo:.{digits}f}–{hi:.{digits}f}{unit}"


def _numeric_factor(name: str, label: str, target: float, rng: list[float] | None, scale: float, unit: str,
                    alt: list[float] | None = None, alt_note: str = "") -> Factor:
    tol_match, tol_partial = TOL[name]
    if not rng:
        if alt:
            lo, hi = alt[0] * scale, alt[1] * scale
            inside = lo - tol_partial <= target <= hi + tol_partial
            return Factor(name, label, f"{target:g}{unit}", _fmt_range(alt, scale, unit) + " (" + alt_note + ")",
                          "partial" if inside else "unknown",
                          f"Only {alt_note} covers this; not an ambient atmosphere." if inside else
                          f"Not reported for ambient conditions ({alt_note} only).")
        return Factor(name, label, f"{target:g}{unit}", "not reported", "unknown",
                      "This variable is not reported in the experimental table — unknown, not assumed to match.")
    lo, hi = rng[0] * scale, rng[1] * scale
    tested = _fmt_range(rng, scale, unit)
    if lo - tol_match <= target <= hi + tol_match:
        return Factor(name, label, f"{target:g}{unit}", tested, "match", "Scenario value lies inside the tested range.")
    dist = lo - target if target < lo else target - hi
    if dist <= tol_partial:
        return Factor(name, label, f"{target:g}{unit}", tested, "partial",
                      f"Scenario value is {dist:.1f}{unit} outside the tested range (close).")
    return Factor(name, label, f"{target:g}{unit}", tested, "mismatch",
                  f"Scenario value is {dist:.1f}{unit} outside the tested range — extrapolation.")


def _gravity_factor(target: str, inv: dict[str, Any]) -> Factor:
    flight = (inv.get("project_type") or "").lower().startswith("microgravity")
    tested = "microgravity (flight)" if flight else "ground / modelling study"
    if inv["accession"] == "PSI-99":
        tested += " + 1-g reference burns"
    if target == "microgravity":
        if flight:
            return Factor("gravity", "Gravity", "microgravity", tested, "match", "Flight data in microgravity.")
        return Factor("gravity", "Gravity", "microgravity", tested, "partial",
                      "Ground/modelling study built on microgravity flight data.")
    if target in ("lunar", "martian"):
        g = "1/6 g" if target == "lunar" else "0.38 g"
        return Factor("gravity", "Gravity", g, tested, "bounded",
                      f"No partial-gravity combustion data in PSI. Microgravity results bound the low-gravity side; "
                      f"behaviour at {g} is not assumed to equal microgravity.")
    if target == "earth":
        if inv["accession"] == "PSI-99":
            return Factor("gravity", "Gravity", "1 g", tested, "partial", "Includes 1-g reference burns of the same samples.")
        return Factor("gravity", "Gravity", "1 g", tested, "mismatch" if flight else "partial",
                      "Microgravity flight data: buoyancy absent — transfer to 1 g needs validation.")
    return Factor("gravity", "Gravity", target, tested, "unknown", "")


def _count_matching_tests(repo: Repository, acc: str, sc: Scenario) -> int:
    sql = "SELECT COUNT(*) FROM test WHERE accession = ? AND record_type = 'test'"
    args: list[Any] = [acc]
    used = False
    if sc.o2_pct is not None:
        sql += " AND o2_mole_frac BETWEEN ? AND ? AND quality NOT LIKE '%oxidizer_stream%'"
        args += [(sc.o2_pct - 2.0) / 100, (sc.o2_pct + 2.0) / 100]
        used = True
    if sc.pressure_kpa is not None:
        sql += " AND pressure_kpa BETWEEN ? AND ?"
        args += [sc.pressure_kpa - 10, sc.pressure_kpa + 10]
        used = True
    if sc.flow_cm_s is not None:
        sql += " AND flow_cm_s BETWEEN ? AND ?"
        args += [max(sc.flow_cm_s - 3, 0), sc.flow_cm_s + 3]
        used = True
    if sc.fuel_phase:
        sql += " AND fuel_phase = ?"
        args.append(sc.fuel_phase)
    if not used:
        return 0
    return int(repo.conn.execute(sql, args).fetchone()[0])


def _data_readiness(inv: dict[str, Any], need: str | None) -> tuple[float, list[str]]:
    prof = inv["profile"]
    notes = []
    n = prof["n_tests"]
    rt = prof["record_types"]
    if n > 0:
        base = 0.45 + 0.25 * min(1.0, math.log10(n + 1) / 2.5)
        notes.append(f"{n} test-level records")
    elif rt:
        base = 0.25
        notes.append("session / test-matrix records only (" + ", ".join(f"{v} {k}" for k, v in rt.items()) + ")")
    else:
        base = 0.05
        notes.append("no experimental table — documents and publications only")
    if need in NEED_VARIABLES:
        present = set(k for k, v in prof["coverage"].items() if v)
        present |= {q["quantity"] for q in prof["measured_quantities"]}
        if prof["outcome_classes"]:
            present.add("outcome_class")
        wanted = NEED_VARIABLES[need]
        have = [v for v in wanted if v in present or (v == "flow_direction" and inv["accession"] in ("PSI-98", "PSI-99", "PSI-100"))
                or (v == "material_class" and n > 0)]
        frac = len(have) / len(wanted)
        base += 0.3 * frac
        missing = [v for v in wanted if v not in have]
        if missing:
            notes.append("missing for this need: " + ", ".join(missing))
    return min(base, 1.0), notes


def rank(repo: Repository, scenario: Scenario | dict[str, Any], limit: int = 30) -> dict[str, Any]:
    sc = Scenario.from_dict(scenario) if isinstance(scenario, dict) else scenario
    sc, parsed, notes = resolve_scenario(repo, sc)
    text_scores: dict[str, float] = {}
    passages: dict[str, dict[str, Any]] = {}
    if parsed and parsed.keywords:
        index = get_index(repo.conn)
        text_scores = index.investigation_scores(parsed)
        for p in index.search(parsed, limit=60):
            passages.setdefault(p.accession, p.to_dict())

    results: list[RankedInvestigation] = []
    for inv in repo.investigations():
        if not inv["in_scope"] and not sc.include_out_of_scope:
            continue
        if inv["project_type"] == "Ground Investigation" and not sc.include_ground_studies:
            continue
        needs = inv.get("needs") or {}
        why: list[str] = []
        gaps: list[str] = []

        # ---- relevance
        if sc.need:
            need_w = float(needs.get(sc.need, 0.0))
            if need_w >= 0.9:
                why.append(f"Primary focus: {NEEDS[sc.need].lower()}.")
            elif need_w > 0:
                why.append(f"Secondary relevance to {NEEDS[sc.need].lower()} (weight {need_w:.1f}).")
        else:
            need_w = max(needs.values(), default=0.0)
        t = text_scores.get(inv["accession"], 0.0)
        if parsed and parsed.keywords:
            relevance = 0.75 * need_w + 0.25 * t if sc.need else t
            if t >= 0.5:
                why.append("Strong text match with your question.")
        else:
            relevance = need_w
        if not inv["in_scope"]:
            relevance = 0.0
            gaps.append(inv.get("scope_note") or "Out of scope.")
        if relevance <= 0.05 and sc.need:
            continue

        # ---- condition fit
        prof = inv["profile"]
        factors: list[Factor] = []
        if sc.fuel_phase:
            phases = sorted(set(inv.get("fuel_phases") or []) | set(prof["fuel_phases"]))
            if not phases:
                factors.append(Factor("fuel_phase", "Fuel phase", sc.fuel_phase, "not reported", "unknown", ""))
            elif sc.fuel_phase in phases:
                factors.append(Factor("fuel_phase", "Fuel phase", sc.fuel_phase, ", ".join(phases), "match",
                                      "Same fuel phase."))
            else:
                detail = "Different fuel phase: results do not transfer directly."
                status = "mismatch"
                if inv["accession"] == "PSI-20" and sc.fuel_phase == "solid":
                    status, detail = "partial", "Gaseous burner designed to emulate burning solids."
                factors.append(Factor("fuel_phase", "Fuel phase", sc.fuel_phase, ", ".join(phases), status, detail))
        if sc.gravity:
            factors.append(_gravity_factor(sc.gravity, inv))
        rng = prof["ranges"]
        if sc.o2_pct is not None:
            factors.append(_numeric_factor("o2_pct", "Oxygen", sc.o2_pct, rng.get("o2_mole_frac"), 100.0, " %",
                                           rng.get("o2_oxidizer_stream"), "inverse-flame oxidizer stream"))
        if sc.pressure_kpa is not None:
            factors.append(_numeric_factor("pressure_kpa", "Pressure", sc.pressure_kpa, rng.get("pressure_kpa"), 1.0, " kPa"))
        if sc.flow_cm_s is not None:
            factors.append(_numeric_factor("flow_cm_s", "Flow", sc.flow_cm_s, rng.get("flow_cm_s"), 1.0, " cm/s"))
        fit = sum(STATUS_SCORE[f.status] for f in factors) / len(factors) if factors else None
        for f in factors:
            if f.status in ("unknown", "mismatch", "bounded"):
                gaps.append(f"{f.label}: {f.detail}" if f.detail else f"{f.label}: {f.status}")

        # ---- data readiness
        data, dnotes = _data_readiness(inv, sc.need)
        why.append("Data: " + "; ".join(dnotes) + ".")
        if inv["project_type"] == "Ground Investigation":
            gaps.append("Ground / modelling study: re-uses flight data"
                        + (f" from {', '.join(inv['uses_data_from'])}" if inv.get("uses_data_from") else "") + ".")

        matching = _count_matching_tests(repo, inv["accession"], sc)
        if matching:
            why.append(f"{matching} individual test(s) fall close to your scenario conditions.")

        score = WEIGHTS["relevance"] * relevance + WEIGHTS["fit"] * (fit if fit is not None else 0.5) + WEIGHTS["data"] * data
        results.append(RankedInvestigation(
            accession=inv["accession"], acronym=inv["acronym"], title=inv["title"], doi=inv["doi"],
            family=inv["family"], project_type=inv["project_type"], score=score, relevance=relevance, fit=fit,
            data=data, factors=factors, why=why, gaps=gaps, matching_tests=matching,
            top_passage=passages.get(inv["accession"]),
        ))

    results.sort(key=lambda r: (-r.score, r.accession))
    return {
        "scenario": asdict(sc),
        "parsed": parsed.to_dict() if parsed else None,
        "notes": notes,
        "weights": WEIGHTS,
        "status_scores": STATUS_SCORE,
        "results": [r.to_dict() for r in results[:limit]],
    }


def scenario_signature(sc: dict[str, Any]) -> str:
    return json.dumps({k: v for k, v in sc.items() if v is not None}, sort_keys=True)
