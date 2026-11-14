"""Natural-language query understanding (English + French).

Turns "smoke detector data for a Moon base at 34% O2 and 8.2 psi" into a structured scenario:
need=detection, gravity=lunar, habitat=lunar_base, o2_pct=34, pressure_kpa=56.5.
Deterministic and explainable: every detected item says which words triggered it.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass, field
from typing import Any

from ..etl.curation import LEXICON
from ..etl.parsing import ATM_TO_KPA, BAR_TO_KPA, MMHG_TO_KPA, PSI_TO_KPA


def fold(text: str) -> str:
    """Lowercase + strip accents, for robust matching."""
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in text if not unicodedata.combining(ch))


@dataclass
class ParsedQuery:
    text: str
    need: str | None = None
    fuel_phase: str | None = None
    gravity: str | None = None
    habitat: str | None = None
    o2_pct: float | None = None
    pressure_kpa: float | None = None
    flow_cm_s: float | None = None
    detected: list[dict[str, str]] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    expanded_terms: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _find_terms(folded: str, terms: list[str]) -> list[str]:
    hits = []
    for t in terms:
        ft = fold(t)
        if re.search(rf"(?<![a-z0-9]){re.escape(ft)}(?:s|es|x)?(?![a-z0-9])", folded):
            hits.append(t)
    return hits


def _best(folded: str, groups: dict[str, list[str]]) -> tuple[str | None, list[str]]:
    best, best_hits = None, []
    for key, terms in groups.items():
        hits = _find_terms(folded, terms)
        if len(hits) > len(best_hits):
            best, best_hits = key, hits
    return best, best_hits


NUM = r"(\d+(?:[.,]\d+)?)"


def parse_query(text: str) -> ParsedQuery:
    q = ParsedQuery(text=text or "")
    folded = fold(text or "")

    need, hits = _best(folded, LEXICON["need"])
    if need:
        q.need = need
        q.detected.append({"field": "need", "value": need, "because": ", ".join(hits)})

    phase, hits = _best(folded, LEXICON["fuel_phase"])
    if phase:
        q.fuel_phase = phase
        q.detected.append({"field": "fuel_phase", "value": phase, "because": ", ".join(hits)})

    habitat, hits = _best(folded, LEXICON["habitat"])
    if habitat:
        q.habitat = habitat
        q.detected.append({"field": "habitat", "value": habitat, "because": ", ".join(hits)})

    gravity, hits = _best(folded, LEXICON["gravity"])
    if gravity:
        q.gravity = gravity
        q.detected.append({"field": "gravity", "value": gravity, "because": ", ".join(hits)})
    elif habitat == "lunar_base":
        q.gravity = "lunar"
    elif habitat == "mars_habitat":
        q.gravity = "martian"

    # oxygen: "34% O2", "34 % oxygen", "O2 34%", "xo2 0.34", "34 % d'oxygène"
    m = (re.search(rf"{NUM}\s*%\s*(?:d['’]\s*)?(?:o2|oxygen|oxygene|ox\b)", folded)
         or re.search(rf"(?:o2|oxygen|oxygene)\s*(?:=|:|a|at|de)?\s*{NUM}\s*%", folded)
         or re.search(rf"x\s*o2\s*(?:=|:)?\s*(0[.,]\d+)", folded))
    if m:
        v = float(m.group(1).replace(",", "."))
        q.o2_pct = v * 100 if v <= 1 else v
        q.detected.append({"field": "o2_pct", "value": f"{q.o2_pct:g}", "because": m.group(0)})

    # pressure
    m = re.search(rf"{NUM}\s*(psia|psi|kpa|atm|bar|mmhg)\b", folded)
    if m:
        v = float(m.group(1).replace(",", "."))
        unit = m.group(2)
        factor = {"psia": PSI_TO_KPA, "psi": PSI_TO_KPA, "kpa": 1.0, "atm": ATM_TO_KPA, "bar": BAR_TO_KPA,
                  "mmhg": MMHG_TO_KPA}[unit]
        q.pressure_kpa = round(v * factor, 2)
        q.detected.append({"field": "pressure_kpa", "value": f"{q.pressure_kpa:g}", "because": m.group(0)})

    # flow
    m = re.search(rf"{NUM}\s*(cm/s|cm\.s-1|m/s|mm/s)", folded)
    if m:
        v = float(m.group(1).replace(",", "."))
        q.flow_cm_s = v * {"cm/s": 1, "cm.s-1": 1, "m/s": 100, "mm/s": 0.1}[m.group(2)]
        q.detected.append({"field": "flow_cm_s", "value": f"{q.flow_cm_s:g}", "because": m.group(0)})
    elif _find_terms(folded, ["no flow", "without flow", "without ventilation", "no ventilation", "without air flow",
                              "without airflow", "sans ecoulement", "quiescent", "cutting ventilation", "cut ventilation",
                              "cut the ventilation", "stopping ventilation", "ventilation off", "still air", "sans ventilation", "air immobile", "ventilation off",
                              "ventilation coupee", "ventilation shutdown", "couper la ventilation"]):
        q.flow_cm_s = 0.0
        q.detected.append({"field": "flow_cm_s", "value": "0", "because": "quiescent / no ventilation"})

    # keywords + FR->EN expansion for lexical retrieval
    words = re.findall(r"[a-z0-9][a-z0-9\-]+", folded)
    stop = {"the", "and", "for", "with", "what", "which", "how", "les", "des", "une", "pour", "avec", "quel", "quelle",
            "quels", "quelles", "dans", "sur", "est", "que", "qui", "data", "donnees", "about", "from", "this", "that",
            "are", "can", "does", "mon", "mes", "comment", "quoi", "par", "aux", "du", "de", "la", "le", "un", "et",
            "en", "a", "au", "ou", "il", "je", "veux", "want", "need", "besoin", "is", "of", "to", "in", "on", "at"}
    q.keywords = [w for w in words if w not in stop and len(w) > 2]
    syn = {fold(k): v for k, v in LEXICON["synonyms"].items()}
    expanded = []
    for w in q.keywords:
        for cand in (w, w[:-1] if w.endswith(("s", "x")) else w):
            if cand in syn:
                expanded.append(syn[cand])
                break
    q.expanded_terms = sorted(set(expanded))
    return q
