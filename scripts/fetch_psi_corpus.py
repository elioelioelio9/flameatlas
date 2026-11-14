"""Re-download the PSI combustion corpus from the public NASA PSI repository API.

    python scripts/fetch_psi_corpus.py            # -> data/raw/psi_combustion_corpus.json

Uses the same endpoints as the PSI web application:
  search       https://psi.nasa.gov/geode-py/ws/repo/search?term=...&source=psi&type=investigation
  metadata     https://psi.nasa.gov/geode-py/ws/repo/investigations/<PSI-ID>
  table files  https://psi.nasa.gov/geode-py/ws/studies/<PSI-ID>/download?file=<name>&version=<v>&redirect=false
               (returns a short-lived signed S3 URL)
"""

from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://psi.nasa.gov/geode-py/ws"
OUT = Path(__file__).resolve().parents[1] / "data" / "raw" / "psi_combustion_corpus.json"
TERMS = ["combustion", "flame", "fire", "flammability", "smoke", "soot", "droplet", "extinguishment", "DAFT"]
KEEP_AREAS = {"Combustion Science"}
ALWAYS = {"PSI-181", "PSI-108"}  # keyword matches kept to document the scope decision


def get(url: str, raw: bool = False):
    req = urllib.request.Request(url, headers={"user-agent": "FlameAtlas/0.1 (NASA Space Apps 2026)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read().decode("utf-8")
    return data if raw else json.loads(data)


def parse(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return v
    return v


def main() -> None:
    accessions: dict[str, str] = {}
    for term in TERMS:
        q = urllib.parse.urlencode({"term": term, "source": "psi", "type": "investigation", "size": 100})
        for hit in get(f"{BASE}/repo/search?{q}")["hits"]["hits"]:
            src = hit["_source"]
            accessions[src["Accession"]] = src.get("Research Area", "")
    selected = sorted(a for a, area in accessions.items() if area in KEEP_AREAS or a in ALWAYS)
    print(f"{len(selected)} investigations: {', '.join(selected)}")

    corpus = []
    for acc in selected:
        r = get(f"{BASE}/repo/investigations/{acc}")
        cats: dict[str, dict] = {}
        for f in r.get("added") or []:
            parts = (f.get("remote_path") or "").split("/")
            c = parts[4] if len(parts) > 4 else "other"
            e = cats.setdefault(c, {"n": 0, "bytes": 0, "examples": []})
            e["n"] += 1
            e["bytes"] += f.get("file_size") or 0
            if len(e["examples"]) < 6:
                e["examples"].append(f["file_name"])
        tables = []
        for t in r.get("experimentalTable") or []:
            q = urllib.parse.urlencode({"file": t["file_name"], "version": t.get("version", 1), "redirect": "false"})
            signed = get(f"{BASE}/studies/{acc}/download?{q}", raw=True).strip().strip('"')
            tables.append({"file_name": t["file_name"], "version": t.get("version"), "csv": get(signed, raw=True)})
        corpus.append({
            "accession": r["accession"], "version": r.get("version"), "title": r.get("title"),
            "acronym": r.get("investigationAcronym"), "doi": r.get("doi"), "license": r.get("licenseIdentifier"),
            "projectType": r.get("projectType"), "researchArea": r.get("researchArea"),
            "subResearchArea": r.get("subResearchArea"), "flightProgram": r.get("flightProgram"),
            "hardware": r.get("experimentHardware"), "hardwareLink": r.get("experimentHardwareLink"),
            "nasaCenter": r.get("managingNasaCenter"), "start": r.get("investigationStartDate"),
            "end": r.get("investigationEndDate"), "releaseDate": r.get("releaseDate"),
            "modifiedDate": r.get("modifiedDate"), "related": r.get("related_glds"),
            "proposalTitle": r.get("proposalTitle"), "objective": parse(r.get("objective")),
            "approach": parse(r.get("approach")), "hypothesis": parse(r.get("hypothesis")),
            "researchImpacts": parse(r.get("researchImpacts")), "description": parse(r.get("description")),
            "factors": r.get("factors"),
            "contacts": [{"name": f"{c.get('firstName', '')} {c.get('lastName', '')}".strip(),
                          "affiliation": c.get("affiliation"), "roles": [x.get("annotationValue") for x in c.get("roles", [])]}
                         for c in (parse(r.get("contacts")) or [])],
            "publications": [{"title": p.get("title"), "authors": p.get("authorList"), "doi": p.get("doi"),
                              "status": (p.get("status") or {}).get("annotationValue")}
                             for p in (parse(r.get("publications")) or [])],
            "fileCategories": cats, "totalFileSize": r.get("totalFileSize"), "experimentalTables": tables,
            "modelingTables": [],
        })
        print(f"  {acc}: {len(tables)} table(s)")
        time.sleep(0.3)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(corpus, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    sys.exit(main())
