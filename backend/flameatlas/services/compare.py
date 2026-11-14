"""Side-by-side comparison of investigations: what was varied, what was fixed, what was measured."""

from __future__ import annotations

import json
from typing import Any

from .repository import Repository

VARY_COLUMNS = {
    "fuel": "Fuel / sample", "material_class": "Material", "configuration": "Configuration",
    "thickness_mm": "Thickness (mm)", "o2_mole_frac": "O2 mole fraction", "pressure_kpa": "Pressure (kPa)",
    "flow_cm_s": "Flow (cm/s)", "flow_direction": "Flow direction", "diluent": "Diluent",
}


def _distinct(values: list[Any]) -> list[Any]:
    out = []
    for v in values:
        if v is None or v == "":
            continue
        if isinstance(v, float):
            v = round(v, 4)
        if v not in out:
            out.append(v)
    return out


def describe_variation(tests: list[dict[str, Any]]) -> dict[str, Any]:
    real = [t for t in tests if t["record_type"] == "test"] or tests
    varied, fixed, missing = [], [], []
    for col, label in VARY_COLUMNS.items():
        vals = _distinct([t.get(col) for t in real])
        if not vals:
            missing.append(label)
        elif len(vals) == 1:
            fixed.append({"variable": label, "value": vals[0]})
        else:
            nums = [v for v in vals if isinstance(v, (int, float))]
            if len(nums) == len(vals):
                varied.append({"variable": label, "n_levels": len(vals), "min": min(nums), "max": max(nums)})
            else:
                varied.append({"variable": label, "n_levels": len(vals), "examples": vals[:6]})
    return {"varied": varied, "fixed": fixed, "not_reported": missing}


def compare(repo: Repository, accessions: list[str]) -> dict[str, Any]:
    items = []
    for acc in accessions[:4]:
        inv = repo.investigation(acc)
        if not inv:
            continue
        tests = repo.tests([acc])
        variation = describe_variation(tests)
        prof = inv["profile"]
        items.append({
            "accession": acc, "acronym": inv["acronym"], "title": inv["title"], "doi": inv["doi"],
            "family": inv["family"], "project_type": inv["project_type"], "platform": inv["flight_platform"],
            "hardware": inv["hardware"], "dates": [inv["start_date"], inv["end_date"]],
            "fuel_phases": inv["fuel_phases"], "configuration": inv["configuration"], "scale": inv["scale"],
            "pillars": inv["pillars"], "needs": inv["needs"], "key_variables": inv["key_variables"],
            "sensors": inv["sensors"], "summary": inv["summary"], "n_records": prof["n_records"],
            "n_tests": prof["n_tests"], "record_types": prof["record_types"],
            "ranges": {
                "o2_pct": [round(x * 100, 2) for x in prof["ranges"]["o2_mole_frac"]] if "o2_mole_frac" in prof["ranges"] else None,
                "pressure_kpa": prof["ranges"].get("pressure_kpa"),
                "flow_cm_s": prof["ranges"].get("flow_cm_s"),
                "thickness_mm": prof["ranges"].get("thickness_mm"),
            },
            "outcomes": prof["outcome_classes"],
            "measured": sorted(prof["measured_quantities"], key=lambda q: -q["n"])[:14],
            "variation": variation,
        })
    shared = None
    if len(items) >= 2:
        sets = [set(v["variable"] for v in it["variation"]["varied"]) for it in items]
        shared = sorted(set.intersection(*sets))
    return {"items": items, "shared_varied_variables": shared}


def json_safe(obj: Any) -> Any:
    return json.loads(json.dumps(obj, default=str))
