"""Quantitative views computed in Python (never by the language model).

* `scatter`  — any test-level variable or measured quantity against another, per investigation.
* `flex_case` — the reference analysis for the 'extinction' need: FLEX droplet tests.

Fits are *descriptive* (least squares inside the measured domain, with n and R²). They are shown
to help users see trends and are explicitly not predictive models.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Any

from .repository import Repository

TEST_VARS = {
    "o2_pct": ("o2_mole_frac", 100.0, "%"), "pressure_kpa": ("pressure_kpa", 1.0, "kPa"),
    "flow_cm_s": ("flow_cm_s", 1.0, "cm/s"), "thickness_mm": ("thickness_mm", 1.0, "mm"),
    "co2_pct": ("co2_mole_frac", 100.0, "%"), "he_pct": ("he_mole_frac", 100.0, "%"),
}


def linear_fit(xs: list[float], ys: list[float]) -> dict[str, Any] | None:
    n = len(xs)
    if n < 4:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - my) ** 2 for y in ys) or 1e-12
    se = math.sqrt(ss_res / (n - 2)) / math.sqrt(sxx) if n > 2 else None
    return {"n": n, "slope": slope, "intercept": intercept, "r2": 1 - ss_res / ss_tot, "slope_se": se,
            "x_min": min(xs), "x_max": max(xs), "kind": "descriptive least squares (within measured domain)"}


def available_variables(repo: Repository, accessions: list[str] | None = None) -> list[dict[str, Any]]:
    out = [{"id": k, "label": k.replace("_", " "), "unit": u, "level": "test"} for k, (_, _, u) in TEST_VARS.items()]
    rows = repo.conn.execute(
        "SELECT m.quantity, m.unit, COUNT(*) n FROM measurement m JOIN test t ON t.test_id = m.test_id "
        "WHERE m.value IS NOT NULL" + (f" AND t.accession IN ({','.join('?' * len(accessions))})" if accessions else "")
        + " GROUP BY m.quantity, m.unit HAVING n >= 3 ORDER BY n DESC", accessions or []).fetchall()
    out += [{"id": f"m:{r['quantity']}", "label": r["quantity"].replace("_", " "), "unit": r["unit"], "level": "measurement",
             "n": r["n"]} for r in rows]
    return out


def _value(t: dict[str, Any], meas: dict[str, float], var: str) -> float | None:
    if var in TEST_VARS:
        col, scale, _ = TEST_VARS[var]
        v = t.get(col)
        return None if v is None else v * scale
    if var.startswith("m:"):
        return meas.get(var[2:])
    return None


def scatter(repo: Repository, x: str, y: str, accessions: list[str] | None = None, color: str = "accession",
            fit: bool = True) -> dict[str, Any]:
    tests = repo.tests(accessions, record_types=("test",))
    tests = [t for t in tests if "o2_is_oxidizer_stream_not_ambient" not in (t.get("quality") or [])] if "o2" in x + y else tests
    meas_all = repo.measurements_for([t["test_id"] for t in tests])
    points = []
    for t in tests:
        meas = {m["quantity"]: m["value"] for m in meas_all.get(t["test_id"], []) if m["value"] is not None}
        xv, yv = _value(t, meas, x), _value(t, meas, y)
        if xv is None or yv is None:
            continue
        points.append({"x": xv, "y": yv, "test_id": t["test_id"], "accession": t["accession"],
                       "group": str(t.get(color) or "n/a"), "fuel": t.get("fuel"), "outcome": t.get("outcome_class"),
                       "diluent": t.get("diluent"), "source_row": t.get("source_row"), "source_file": t.get("source_file")})
    fits = {}
    if fit:
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for p in points:
            groups[p["group"]].append(p)
        for g, ps in groups.items():
            f = linear_fit([p["x"] for p in ps], [p["y"] for p in ps])
            if f:
                fits[g] = f
    return {"x": x, "y": y, "color": color, "n": len(points), "points": points, "fits": fits}


def flex_case(repo: Repository) -> dict[str, Any]:
    tests = repo.tests(["PSI-69"], record_types=("test",))
    meas_all = repo.measurements_for([t["test_id"] for t in tests])
    pts = []
    for t in tests:
        m = {q["quantity"]: q["value"] for q in meas_all.get(t["test_id"], [])}
        pts.append({"test_id": t["test_id"], "label": t["label"], "fuel": t["fuel"], "diluent": t["diluent"],
                    "o2_pct": round(t["o2_mole_frac"] * 100, 2) if t["o2_mole_frac"] is not None else None,
                    "co2_pct": round((t["co2_mole_frac"] or 0) * 100, 1), "he_pct": round((t["he_mole_frac"] or 0) * 100, 1),
                    "pressure_kpa": t["pressure_kpa"], "outcome": t["outcome_class"],
                    "d0_mm": m.get("droplet_initial_diameter"), "d_ext_mm": m.get("flame_extinction_diameter"),
                    "k_mm2_s": m.get("burning_rate_constant"), "burn_time_s": m.get("burn_time_s"),
                    "source_row": t["source_row"]})
    # outcome table: fuel x diluent x O2 level
    table: dict[tuple, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for p in pts:
        if p["o2_pct"] is None:
            continue
        table[(p["fuel"], p["diluent"], round(p["o2_pct"]))][p["outcome"] or "unknown"] += 1
    rows = [{"fuel": k[0], "diluent": k[1], "o2_pct": k[2], **v, "n": sum(v.values())} for k, v in sorted(table.items())]
    # descriptive fits: burning-rate constant vs O2, N2-only, ~1 atm, per fuel
    fits = {}
    for fuel in sorted({p["fuel"] for p in pts if p["fuel"]}):
        sel = [p for p in pts if p["fuel"] == fuel and p["diluent"] == "N2 only" and p["k_mm2_s"] is not None
               and p["o2_pct"] is not None and p["pressure_kpa"] and 95 <= p["pressure_kpa"] <= 106]
        f = linear_fit([p["o2_pct"] for p in sel], [p["k_mm2_s"] for p in sel])
        if f:
            fits[fuel] = f
    return {
        "investigation": "PSI-69", "n_tests": len(pts), "points": pts, "outcome_table": rows,
        "fits_k_vs_o2_1atm_n2": fits,
        "reading_guide": [
            "'extinction' = the flame went out before the droplet was consumed; 'completion' = burnout; "
            "'disruption' = droplet broke up.",
            "K is the d²-law burning-rate constant (PSI header unit 'mm'; magnitudes consistent with mm²/s).",
            "Fits are descriptive, restricted to N2-only atmospheres near 1 atm, and valid only inside the measured O2 range.",
        ],
    }
