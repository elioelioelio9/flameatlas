"""Traceable data extraction: a modelling-ready table + data dictionary + provenance + limitations.

Every exported row keeps its PSI accession, DOI, source file and source row, so any value can be
checked against the original NASA file. Missing values stay empty (never 0).
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

from .. import __version__
from .repository import Repository

BASE_COLUMNS = ["test_id", "accession", "doi", "record_type", "source_file", "source_row", "label", "fuel",
                "fuel_phase", "material_class", "configuration", "thickness_mm", "o2_mole_frac", "pressure_kpa",
                "flow_cm_s", "flow_direction", "diluent", "co2_mole_frac", "he_mole_frac", "gravity", "outcome",
                "outcome_class", "quality"]


@dataclass
class ExtractRequest:
    accessions: list[str] = field(default_factory=list)
    record_types: list[str] = field(default_factory=lambda: ["test"])
    fuel_phase: str | None = None
    o2_pct_min: float | None = None
    o2_pct_max: float | None = None
    pressure_kpa_min: float | None = None
    pressure_kpa_max: float | None = None
    flow_cm_s_min: float | None = None
    flow_cm_s_max: float | None = None
    outcome_classes: list[str] = field(default_factory=list)
    quantities: list[str] | None = None  # None = all measured quantities present in the selection
    exclude_flags: list[str] = field(default_factory=list)  # e.g. ["o2_is_oxidizer_stream_not_ambient"]
    require_complete: list[str] = field(default_factory=list)  # columns that must be non-null

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ExtractRequest":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


def _filter_sql(req: ExtractRequest) -> tuple[str, list[Any]]:
    sql = ("SELECT t.*, i.doi FROM test t JOIN investigation i ON i.accession = t.accession WHERE i.in_scope = 1")
    args: list[Any] = []
    if req.accessions:
        sql += f" AND t.accession IN ({','.join('?' * len(req.accessions))})"
        args += req.accessions
    if req.record_types:
        sql += f" AND t.record_type IN ({','.join('?' * len(req.record_types))})"
        args += req.record_types
    if req.fuel_phase:
        sql += " AND t.fuel_phase = ?"
        args.append(req.fuel_phase)
    for col, lo, hi, scale in (("o2_mole_frac", req.o2_pct_min, req.o2_pct_max, 0.01),
                               ("pressure_kpa", req.pressure_kpa_min, req.pressure_kpa_max, 1.0),
                               ("flow_cm_s", req.flow_cm_s_min, req.flow_cm_s_max, 1.0)):
        if lo is not None:
            sql += f" AND t.{col} >= ?"
            args.append(lo * scale - 1e-9)
        if hi is not None:
            sql += f" AND t.{col} <= ?"
            args.append(hi * scale + 1e-9)
    if req.outcome_classes:
        sql += f" AND t.outcome_class IN ({','.join('?' * len(req.outcome_classes))})"
        args += req.outcome_classes
    for flag in req.exclude_flags:
        sql += " AND (t.quality IS NULL OR t.quality NOT LIKE ?)"
        args.append(f"%{flag}%")
    for col in req.require_complete:
        if col in BASE_COLUMNS:
            sql += f" AND t.{col} IS NOT NULL"
    sql += " ORDER BY t.accession, t.source_file, t.source_row"
    return sql, args


def extract(repo: Repository, req: ExtractRequest, limit: int | None = None) -> dict[str, Any]:
    sql, args = _filter_sql(req)
    tests = [dict(r) for r in repo.conn.execute(sql, args).fetchall()]
    meas = repo.measurements_for([t["test_id"] for t in tests])
    units: dict[str, str | None] = {}
    present: dict[str, int] = {}
    for ms in meas.values():
        for m in ms:
            present[m["quantity"]] = present.get(m["quantity"], 0) + 1
            units.setdefault(m["quantity"], m["unit"])
    quantities = req.quantities if req.quantities is not None else sorted(present, key=lambda q: -present[q])
    quantities = [q for q in quantities if q in present]
    columns = BASE_COLUMNS + [f"{q} [{units.get(q) or '-'}]" for q in quantities]
    rows = []
    for t in tests:
        row = {c: t.get(c) for c in BASE_COLUMNS}
        row["quality"] = ";".join(json.loads(t.get("quality") or "[]"))
        by_q = {m["quantity"]: m for m in meas.get(t["test_id"], [])}
        for q in quantities:
            m = by_q.get(q)
            row[f"{q} [{units.get(q) or '-'}]"] = None if m is None else (m["value"] if m["value"] is not None else m["value_text"])
        rows.append(row)
    for col in req.require_complete:
        hdr = next((c for c in columns if c.startswith(col + " [")), None)
        if hdr:
            rows = [r for r in rows if r.get(hdr) not in (None, "")]
    total = len(rows)
    accs = sorted({r["accession"] for r in rows})
    return {"columns": columns, "rows": rows[:limit] if limit else rows, "total": total, "accessions": accs,
            "quantities": [{"quantity": q, "unit": units.get(q), "n": present[q]} for q in quantities]}


def data_dictionary(repo: Repository, columns: list[str]) -> list[dict[str, Any]]:
    known = {v["name"]: v for v in repo.variables()}
    out = []
    for c in columns:
        name = c.split(" [")[0]
        unit = c.split(" [")[1].rstrip("]") if " [" in c else None
        v = known.get(name, {})
        out.append({"column": c, "label": v.get("label") or name.replace("_", " "), "unit": unit or v.get("unit") or "",
                    "level": v.get("level") or ("measurement" if " [" in c else "test"),
                    "description": v.get("description") or "As reported in the PSI experimental table (see source_column in the measurement table)."})
    if "doi" in columns:
        for d in out:
            if d["column"] == "doi":
                d.update(label="Dataset DOI", description="Persistent identifier of the PSI investigation — cite it.")
    return out


LIMITATIONS = """# Known limitations of this extract

* Values come from PSI *experimental summary tables*. Many quantities (spread rates, particle sizes,
  temperature fields) exist only in the raw files (videos, logs) and are not included.
* Empty cells mean "not reported" — never zero.
* Every interpretation made while parsing is listed in the `quality` column, e.g.
  - `assumed_unit_cm_s` — BASS-II 'Air display' assumed to be cm/s (to verify);
  - `first_of_flow_sequence` — the flow changed during the test, first value kept;
  - `o2_is_oxidizer_stream_not_ambient` — inverse flames: O2 of the burner stream, not of the ambient;
  - `typo_corrected_*` — obvious typos in the PSI table corrected (original kept in raw data).
* All flight data are microgravity. No partial-gravity (Moon, Mars) combustion data exist in PSI yet:
  do not treat microgravity values as lunar values.
* Droplet, gaseous-burner and solid-sample experiments are not interchangeable; compare like with like.
* Session / test-matrix records describe planned ranges or daily sessions, not individual runs.
"""


def build_zip(repo: Repository, req: ExtractRequest) -> tuple[bytes, dict[str, Any]]:
    result = extract(repo, req)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=result["columns"], extrasaction="ignore")
    w.writeheader()
    for r in result["rows"]:
        w.writerow({k: ("" if v is None else v) for k, v in r.items()})
    dd = data_dictionary(repo, result["columns"])
    dbuf = io.StringIO()
    dw = csv.DictWriter(dbuf, fieldnames=["column", "label", "unit", "level", "description"])
    dw.writeheader()
    dw.writerows(dd)
    invs = {i["accession"]: i for i in repo.investigations()}
    sources = [{"accession": a, "acronym": invs[a]["acronym"], "title": invs[a]["title"], "doi": invs[a]["doi"],
                "doi_url": f"https://doi.org/{invs[a]['doi']}" if invs[a]["doi"] else None,
                "psi_url": invs[a]["psi_url"], "psi_version": invs[a]["psi_version"], "license": invs[a]["license"]}
               for a in result["accessions"] if a in invs]
    provenance = {
        "generated_by": f"FlameAtlas {__version__}", "generated_at": now, "n_rows": result["total"],
        "request": asdict(req), "sources": sources, "database": repo.meta(),
        "transformations": [
            "Pressure converted to kPa from mmHg (×0.133322), atm (×101.325), bar (×100), psia (×6.894757).",
            "O2 expressed as mole fraction (percent / 100).",
            "Thickness converted to mm (micron /1000, cm ×10, inch ×25.4).",
            "Measurements pivoted to one column per quantity; units in the column header.",
        ],
    }
    citation = "\n".join(f"{s['acronym'] or s['accession']}: {s['title']}. NASA Physical Sciences Informatics. "
                         f"https://doi.org/{s['doi']}" for s in sources)
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("data.csv", buf.getvalue())
        z.writestr("data_dictionary.csv", dbuf.getvalue())
        z.writestr("provenance.json", json.dumps(provenance, indent=2, ensure_ascii=False))
        z.writestr("LIMITATIONS.md", LIMITATIONS)
        z.writestr("CITATION.txt", "Please cite every dataset you use with its DOI:\n\n" + citation + "\n")
    return zbuf.getvalue(), {"n_rows": result["total"], "accessions": result["accessions"]}
