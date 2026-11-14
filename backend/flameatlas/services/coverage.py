"""Coverage map and gap analysis: where do PSI tests sit relative to crewed-habitat atmospheres?"""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any

from .repository import Repository


def coverage(repo: Repository, fuel_phase: str | None = None, include_oxidizer_stream: bool = False) -> dict[str, Any]:
    sql = ("SELECT t.test_id, t.accession, i.acronym, t.fuel, t.fuel_phase, t.o2_mole_frac, t.pressure_kpa, "
           "t.flow_cm_s, t.outcome_class, t.quality, t.record_type FROM test t JOIN investigation i "
           "ON i.accession = t.accession WHERE i.in_scope = 1 AND t.o2_mole_frac IS NOT NULL")
    args: list[Any] = []
    if fuel_phase:
        sql += " AND t.fuel_phase = ?"
        args.append(fuel_phase)
    points = []
    o2_only: dict[str, dict[str, Any]] = {}
    for r in repo.conn.execute(sql, args).fetchall():
        quality = json.loads(r["quality"] or "[]")
        oxidizer = "o2_is_oxidizer_stream_not_ambient" in quality
        if oxidizer and not include_oxidizer_stream:
            continue
        p = {"test_id": r["test_id"], "accession": r["accession"], "acronym": r["acronym"] or r["accession"],
             "fuel": r["fuel"], "fuel_phase": r["fuel_phase"], "o2_pct": round(r["o2_mole_frac"] * 100, 2),
             "pressure_kpa": r["pressure_kpa"], "flow_cm_s": r["flow_cm_s"], "outcome_class": r["outcome_class"],
             "oxidizer_stream": oxidizer, "record_type": r["record_type"]}
        if r["pressure_kpa"] is None:
            entry = o2_only.setdefault(r["accession"], {"accession": r["accession"], "acronym": p["acronym"],
                                                         "fuel_phase": r["fuel_phase"], "o2_pct": [], "n": 0})
            entry["o2_pct"].append(p["o2_pct"])
            entry["n"] += 1
        else:
            points.append(p)
    o2_only_list = [{**v, "o2_pct_min": min(v["o2_pct"]), "o2_pct_max": max(v["o2_pct"]),
                     "o2_pct": sorted(set(v["o2_pct"]))} for v in o2_only.values()]

    habitats = repo.habitats()
    gaps = []
    for h in habitats:
        inside = [p for p in points
                  if h["o2_pct_min"] - 1 <= p["o2_pct"] <= h["o2_pct_max"] + 1
                  and h["pressure_kpa_min"] - 5 <= p["pressure_kpa"] <= h["pressure_kpa_max"] + 5]
        by_acc: dict[str, int] = defaultdict(int)
        by_phase: dict[str, int] = defaultdict(int)
        for p in inside:
            by_acc[p["acronym"]] += 1
            by_phase[p["fuel_phase"]] += 1
        o2_band = [o for o in o2_only_list
                   if o["o2_pct_max"] >= h["o2_pct_min"] - 1 and o["o2_pct_min"] <= h["o2_pct_max"] + 1]
        msg = []
        if not inside:
            msg.append("No PSI test with both O2 and pressure inside this envelope.")
        else:
            msg.append(f"{len(inside)} tests inside the envelope: "
                       + ", ".join(f"{k} ({v})" for k, v in sorted(by_acc.items(), key=lambda x: -x[1])) + ".")
            missing = [ph for ph in ("solid", "liquid", "gas") if ph not in by_phase]
            if missing:
                msg.append("No " + " or ".join(missing) + "-fuel test inside it.")
        if o2_band:
            msg.append("O2-only matches (pressure not reported): "
                       + ", ".join(f"{o['acronym']}" for o in o2_band) + ".")
        if h["gravity"] in ("lunar", "martian"):
            msg.append("All tests are microgravity: partial gravity remains uncovered.")
        gaps.append({"habitat": h, "n_inside": len(inside), "by_investigation": dict(by_acc),
                     "by_fuel_phase": dict(by_phase), "o2_only_matches": [o["acronym"] for o in o2_band],
                     "summary": " ".join(msg)})
    return {"points": points, "o2_only": o2_only_list, "habitats": habitats, "gaps": gaps,
            "notes": ["Only records with a reported ambient O2 are plotted; inverse-flame oxidizer-stream O2 is "
                      "excluded unless requested.", "Envelope tolerance: ±1 O2 point and ±5 kPa."]}
