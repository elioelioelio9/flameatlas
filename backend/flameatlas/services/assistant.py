"""'Ask Fire Lab': grounded question answering over the PSI corpus.

Pipeline: parse the question -> rank investigations (rules) -> retrieve passages (hybrid search)
-> attach curated/computed insights and coverage facts -> answer.
The answer may only use the numbered sources it is given; numbers come from the application.
"""

from __future__ import annotations

import re
from typing import Any

from ..config import settings
from . import llm
from .coverage import coverage
from .query_parser import fold, parse_query
from .ranking import Scenario, rank
from .repository import Repository
from .search import get_index

OUT_OF_SCOPE = {
    "rocket propulsion": ["rocket", "fusee", "propellant", "propergol", "engine nozzle", "solid rocket", "launch vehicle",
                          "lanceur", "booster"],
}

SYSTEM_PROMPT = """You are Fire Lab, an assistant for spacecraft fire-safety engineers and researchers.
You answer ONLY from the numbered sources provided (NASA PSI combustion investigations, curated insights
and numbers computed by the application). Rules:
- Cite every factual sentence with source tags like [S1] or [S2][S5]. Never cite a source you were not given.
- Never invent numbers. Use only numbers that appear in the sources.
- If the sources do not answer the question, say so plainly and suggest which investigation or data would.
- Microgravity results are NOT lunar or martian results: present them as bounds, never as equivalents.
- Distinguish observations from hypotheses and from design questions.
- Do not turn a single observation into an operational procedure (e.g. never say "always cut ventilation").
- Structure: a 2-3 sentence direct answer, then "Evidence" bullets, then "Limits" bullets. Be concise (max ~250 words).
- Answer in the language of the question (French or English)."""


def _is_out_of_scope(text: str) -> str | None:
    f = fold(text)
    for topic, words in OUT_OF_SCOPE.items():
        if any(re.search(rf"\b{re.escape(w)}", f) for w in words):
            return topic
    return None


def _diverse(passages: list[Any], k: int = 8, per_acc: int = 2) -> list[Any]:
    out, count = [], {}
    for p in passages:
        if count.get(p.accession, 0) >= per_acc:
            continue
        out.append(p)
        count[p.accession] = count.get(p.accession, 0) + 1
        if len(out) >= k:
            break
    return out


def build_context(repo: Repository, question: str, scenario: dict[str, Any] | None = None) -> dict[str, Any]:
    parsed = parse_query(question)
    sc = Scenario.from_dict({**(scenario or {}), "query": question})
    ranking = rank(repo, sc, limit=6)
    index = get_index(repo.conn)
    passages = _diverse(index.search(parsed, limit=40))
    invs = {i["accession"]: i for i in repo.investigations()}

    sources: list[dict[str, Any]] = []

    def add(kind: str, accession: str | None, title: str, text: str, extra: dict[str, Any] | None = None) -> str:
        sid = f"S{len(sources) + 1}"
        inv = invs.get(accession or "")
        sources.append({"id": sid, "kind": kind, "accession": accession,
                        "acronym": inv["acronym"] if inv else None, "doi": inv["doi"] if inv else None,
                        "title": title, "text": text, **(extra or {})})
        return sid

    for p in passages:
        inv = invs.get(p.accession)
        add("psi_text", p.accession, f"{(inv or {}).get('acronym') or p.accession} — {p.section}", p.text,
            {"section": p.section})
    need = ranking["scenario"].get("need")
    top_accs = [r["accession"] for r in ranking["results"][:4]]
    def _prio(ins: dict[str, Any]) -> tuple[int, int]:
        accs = [s.get("accession") for s in ins["sources"]]
        pos = min((top_accs.index(a) for a in accs if a in top_accs), default=99)
        return (pos, 0 if ins["evidence_kind"] == "computed_from_table" else 1)

    for ins in sorted(repo.insights(), key=_prio):
        src_accs = [s.get("accession") for s in ins["sources"]]
        if (need and ins["need"] == need) or any(a in top_accs for a in src_accs):
            text = (f"{ins['title']}. Observation: {ins['observation']} Conditions: {ins['conditions']} "
                    f"Limitation: {ins['limitation']}")
            add("insight" if ins["evidence_kind"] != "computed_from_table" else "computed", src_accs[0] if src_accs else None,
                ins["title"], text, {"evidence_kind": ins["evidence_kind"]})
        if len(sources) >= 14:
            break
    for r in ranking["results"][:4]:
        factors = "; ".join(f"{f['label']}: {f['status']} (tested {f['tested']})" for f in r["factors"])
        add("ranking", r["accession"], f"Ranking of {r['acronym'] or r['accession']}",
            f"{r['acronym'] or r['accession']} ranked score {r['score']:.2f}. {' '.join(r['why'])} "
            + (f"Conditions: {factors}." if factors else "") + (f" Gaps: {' '.join(r['gaps'])}" if r["gaps"] else ""))
    habitat = ranking["scenario"].get("habitat")
    if habitat:
        cov = coverage(repo)
        gap = next((g for g in cov["gaps"] if g["habitat"]["id"] == habitat), None)
        if gap:
            add("computed", None, f"Coverage of {gap['habitat']['name']}",
                f"Habitat envelope {gap['habitat']['o2_pct_min']}–{gap['habitat']['o2_pct_max']} % O2, "
                f"{gap['habitat']['pressure_kpa_min']}–{gap['habitat']['pressure_kpa_max']} kPa "
                f"({gap['habitat']['status']}; source: {gap['habitat']['source']}). {gap['summary']}")
    return {"parsed": parsed.to_dict(), "ranking": ranking, "sources": sources}


def _extractive_answer(question: str, ctx: dict[str, Any]) -> str:
    fr = bool(re.search(r"\b(le|la|les|des|quel|quelle|quels|comment|pour|est-ce|données|fumée|matériau)\b", fold(question)))
    L = (lambda en, f: f if fr else en)
    res = ctx["ranking"]["results"][:3]
    by_acc = {}
    for s in ctx["sources"]:
        by_acc.setdefault(s["accession"], []).append(s)
    lines = []
    if res:
        names = ", ".join(f"**{r['acronym'] or r['accession']}**" for r in res)
        lines.append(L(f"The most relevant PSI investigations for this question are {names}.",
                       f"Les investigations PSI les plus pertinentes pour cette question sont {names}."))
    lines.append("")
    lines.append(L("**Evidence**", "**Éléments**"))
    used = 0
    for s in ctx["sources"]:
        if s["kind"] in ("insight", "computed") and used < 3:
            obs = s["text"].split("Conditions:")[0]
            lines.append(f"- {obs.strip()} [{s['id']}]")
            used += 1
    for s in ctx["sources"]:
        if s["kind"] == "psi_text" and used < 6:
            snippet = s["text"] if len(s["text"]) < 260 else s["text"][:257].rsplit(" ", 1)[0] + "…"
            lines.append(f"- {s['acronym'] or s['accession']}: {snippet} [{s['id']}]")
            used += 1
    gaps = [g for r in res for g in r["gaps"]][:4]
    if gaps:
        lines.append("")
        lines.append(L("**Limits**", "**Limites**"))
        for g in dict.fromkeys(gaps):
            lines.append(f"- {g}")
    lines.append("")
    lines.append(L("_Extractive answer (no language model configured): passages and numbers are quoted from the sources._",
                   "_Réponse extractive (aucun modèle de langage configuré) : passages et chiffres cités depuis les sources._"))
    return "\n".join(lines)


def answer(repo: Repository, question: str, scenario: dict[str, Any] | None = None) -> dict[str, Any]:
    question = (question or "").strip()
    if not question:
        return {"answer": "Please ask a question.", "mode": "none", "sources": [], "warnings": []}
    oos = _is_out_of_scope(question)
    if oos:
        return {
            "answer": ("This question is about **" + oos + "**, which is outside the PSI combustion data used by "
                       "Fire Lab: the high velocities in rocket engines make that combustion effectively independent "
                       "of gravity, and PSI holds no propellant fire-safety investigations. Try a question about cabin "
                       "materials, extinction or smoke detection."),
            "mode": "out_of_scope", "sources": [], "warnings": [f"out of scope: {oos}"], "parsed": parse_query(question).to_dict(),
        }
    ctx = build_context(repo, question, scenario)
    warnings: list[str] = []
    if ctx["parsed"].get("gravity") in ("lunar", "martian"):
        warnings.append("Partial gravity: PSI holds microgravity data only — results are bounds, not lunar/martian values.")
    if not ctx["sources"] or not ctx["ranking"]["results"]:
        return {"answer": "The PSI corpus indexed by Fire Lab does not contain information that answers this question.",
                "mode": "no_evidence", "sources": [], "warnings": warnings, "parsed": ctx["parsed"]}

    mode, model = "extractive", None
    text = None
    if settings.active_llm != "none":
        src_block = "\n\n".join(
            f"[{s['id']}] ({s['kind']}; {s['acronym'] or s['accession'] or 'Fire Lab'}"
            f"{'; DOI ' + s['doi'] if s.get('doi') else ''}) {s['title']}\n{s['text']}" for s in ctx["sources"])
        user = f"Question: {question}\n\nSources:\n{src_block}"
        try:
            text, model = llm.complete(SYSTEM_PROMPT, user)
            cited = set(re.findall(r"\[(S\d+)\]", text))
            valid = {s["id"] for s in ctx["sources"]}
            if not cited:
                warnings.append("The model answer contained no citation; showing the extractive answer instead.")
                text = None
            elif cited - valid:
                warnings.append(f"Removed unknown citations: {sorted(cited - valid)}")
                for bad in cited - valid:
                    text = text.replace(f"[{bad}]", "")
            if text:
                mode = "llm"
        except llm.LLMError as e:
            warnings.append(f"Language model unavailable ({str(e)[:80]}); extractive answer shown.")
    if text is None:
        text = _extractive_answer(question, ctx)
    cited_ids = set(re.findall(r"\[(S\d+)\]", text))
    return {
        "answer": text, "mode": mode, "model": model, "warnings": warnings, "parsed": ctx["parsed"],
        "sources": [s for s in ctx["sources"] if s["id"] in cited_ids] or ctx["sources"][:6],
        "all_sources": ctx["sources"],
        "ranking": [{k: r[k] for k in ("accession", "acronym", "title", "doi", "score", "relevance", "fit", "data")}
                    for r in ctx["ranking"]["results"][:5]],
    }
