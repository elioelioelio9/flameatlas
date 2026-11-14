"""Build the FlameAtlas SQLite database from the raw PSI corpus.

    python -m flameatlas.etl.build            # -> data/flameatlas.db + data/processed/*

The raw corpus (data/raw/psi_combustion_corpus.json) was retrieved from the public PSI
repository API (psi.nasa.gov/geode-py/ws/repo/investigations/<PSI-ID>) together with each
investigation's experimental-table CSV files. All PSI data are released under CC0-1.0.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .. import __version__
from ..config import PROCESSED_DIR, RAW_CORPUS, settings
from ..db import connect, init_schema
from . import curation
from .adapters import adapt_investigation

TEXT_FIELDS = ("objective", "approach", "hypothesis", "researchImpacts", "description")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        value = json.dumps(value)
    value = value.strip()
    if len(value) >= 2 and value[0] == '"' and value[-1] == '"':
        value = value[1:-1]
    value = value.replace("\\n", "\n").replace('\\"', '"')
    value = re.sub(r"[ \t]+", " ", value)
    return value.strip()


def chunk_text(text: str, max_words: int = 110) -> list[str]:
    """Split on paragraphs/sentences into ~max_words chunks (good granularity for citations)."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n|\n", text) if p.strip()]
    chunks: list[str] = []
    for p in paragraphs:
        sentences = re.split(r"(?<=[.!?])\s+", p)
        buf: list[str] = []
        count = 0
        for s in sentences:
            n = len(s.split())
            if buf and count + n > max_words:
                chunks.append(" ".join(buf))
                buf, count = [], 0
            buf.append(s)
            count += n
        if buf:
            chunks.append(" ".join(buf))
    return chunks


# --------------------------------------------------------------------------- computed insights
def _meas(rec: dict, q: str) -> Any:
    for m in rec["measurements"]:
        if m["quantity"] == q:
            return m["value"] if m["value"] is not None else m["value_text"]
    return None


def computed_insights(records: dict[str, list[dict]]) -> list[dict]:
    out: list[dict] = []

    # FLEX: share of flames extinguishing before burnout vs O2 (N2-only atmospheres)
    flex = records.get("PSI-69", [])
    if flex:
        lines = []
        for fuel in sorted({r["fuel"] for r in flex if r["fuel"]}):
            sub = [r for r in flex if r["fuel"] == fuel and r["diluent"] == "N2 only" and r["o2_mole_frac"] is not None]
            low = [r for r in sub if r["o2_mole_frac"] <= 0.21 + 1e-9 and r["o2_mole_frac"] >= 0.205]
            high = [r for r in sub if r["o2_mole_frac"] >= 0.30]
            if low and high:
                el = sum(r["outcome_class"] == "extinction" for r in low)
                eh = sum(r["outcome_class"] == "extinction" for r in high)
                lines.append(f"{fuel}: {el}/{len(low)} at 21 % O2 vs {eh}/{len(high)} at 30–34 % O2")
        p07 = sum(1 for r in flex if r["pressure_kpa"] and 65 <= r["pressure_kpa"] <= 75)
        out.append(dict(
            id="flex-o2-burnout", need="extinction", pillar="suppression",
            title="More oxygen: droplet flames more often survive to burnout",
            observation=("FLEX droplet tests in N2-only atmospheres that ended in flame extinction before burnout — "
                         + "; ".join(lines) + ". Remaining tests ended in burnout ('completion') or droplet disruption."),
            conditions=(f"FLEX (PSI-69), {len(flex)} tests, methanol and heptane droplets, O2 0.12–0.34; "
                        f"{p07} tests near 0.7 atm (≈10.2 psia)."),
            design_question=("How much more agent (CO2, He) or O2 depletion is needed to suppress a fire at "
                             "exploration-atmosphere oxygen levels than at 21 % O2?"),
            limitation=("Isolated droplets, two fuels; 'extinction' here means the flame went out before the droplet "
                        "was consumed (often radiative), not the action of an extinguisher. Counts, not a model."),
            next_validation="Repeat at fixed droplet size and pressure; extend to solid cabin materials (BASS/SoFIE).",
            sources=[{"accession": "PSI-69", "field": "experimental table"}], evidence_kind="computed_from_table",
        ))
        # diluent comparison at 21 %
        dil = []
        for d in ("N2 only", "CO2", "He"):
            sub = [r for r in flex if r["diluent"] == d and r["o2_mole_frac"] is not None and 0.205 <= r["o2_mole_frac"] <= 0.215]
            if sub:
                dil.append(f"{d}: {sum(r['outcome_class'] == 'extinction' for r in sub)}/{len(sub)}")
        out.append(dict(
            id="flex-diluents", need="extinction", pillar="suppression",
            title="FLEX compares CO2 and helium as gaseous suppressants",
            observation=("At 21 % O2, share of FLEX tests ending in flame extinction before burnout by atmosphere — "
                         + "; ".join(dil) + ". FLEX varied CO2 up to 0.7 and He up to 0.45 mole fraction."),
            conditions="FLEX (PSI-69), methanol and heptane droplets, mostly 1 atm and 0.7 atm.",
            design_question="Which inert agent and which concentration should a portable or fixed extinguisher deliver in a small cabin?",
            limitation="Small samples per cell; droplet size and pressure also vary — use the Extract module to control for them.",
            next_validation="Fit extinction diameter vs agent concentration at fixed pressure; compare with FLEX-2 and models (PSI-142).",
            sources=[{"accession": "PSI-69", "field": "experimental table"}], evidence_kind="computed_from_table",
        ))

    # SAFFIRE-II: µg vs 1-g on the same sample types
    saf = records.get("PSI-99", [])
    if saf:
        sil = [r for r in saf if (r["material_class"] or "").startswith("Silicone")]
        sil_ug0 = sum(r["outcome_class"] == "no_sustained_spread" for r in sil)
        sil_1g_complete = sum(1 for r in sil if str(_meas(r, "1g_burn_length") or "").lower() == "complete")
        spread = sorted({r["material_class"] for r in saf if r["outcome_class"] == "flame_spread" and r["material_class"]
                         and "composite" not in r["material_class"]})
        out.append(dict(
            id="saffire2-ug-vs-1g", need="materials", pillar="prevention",
            title="Microgravity and 1-g rankings of materials can disagree",
            observation=(f"In SAFFIRE-II, {sil_ug0} of {len(sil)} silicone samples (0.27–1.03 mm) had a burn length of "
                         f"about 0 in microgravity at 20 cm/s, while {sil_1g_complete} of the {len(sil)} matching 1-g reference "
                         f"burns were complete. Flames did spread in microgravity over: "
                         f"{', '.join(spread)}."),
            conditions="SAFFIRE-II (PSI-99): 5 cm-wide samples, 20 cm/s, ~21.5–22.1 % O2, Cygnus vehicle.",
            design_question=("A 1-g screening result can be optimistic for some materials (BASS hypothesis) and "
                             "pessimistic for others — which materials of a given vehicle need microgravity testing?"),
            limitation="One test per configuration; single flow speed and near-normal O2.",
            next_validation="Repeat silicone at exploration-atmosphere O2 and lower flow speeds.",
            sources=[{"accession": "PSI-99", "field": "experimental table"}], evidence_kind="computed_from_table",
        ))

    # BASS-II: reduced-O2 envelope
    b2 = records.get("PSI-25", [])
    if b2:
        o2 = [r["o2_mole_frac"] for r in b2 if r["o2_mole_frac"] is not None]
        cls = Counter(r["outcome_class"] for r in b2 if r["outcome_class"])
        mats = Counter(r["material_class"] for r in b2 if r["material_class"])
        out.append(dict(
            id="bass2-reduced-o2", need="materials", pillar="prevention",
            title="BASS-II maps solid-fuel burning down to 13.6 % O2",
            observation=(f"BASS-II ran {len(b2)} tests with initial O2 between {min(o2) * 100:.1f} and "
                         f"{max(o2) * 100:.1f} % vol, mostly on {', '.join(m for m, _ in mats.most_common(3))}. "
                         f"Flow annotations record extinction in {cls.get('extinction', 0)} tests, blow-off in "
                         f"{cls.get('blowoff', 0)} and no ignition in {cls.get('no_ignition', 0)}."),
            conditions="BASS-II (PSI-25), MSG flow duct, flow settings up to ~49 (display units, assumed cm/s).",
            design_question="What O2 and flow combinations define the flammability boundary of common cabin plastics in microgravity?",
            limitation=("Outcome annotations are free text; flow units to be confirmed in the BASS-II documentation; "
                        "flame-spread rates are in the raw video data."),
            next_validation="Extract spread rates from the raw videos for a subset (e.g. 2 cm PMMA films).",
            sources=[{"accession": "PSI-25", "field": "experimental table"}], evidence_kind="computed_from_table",
        ))
    return out


# --------------------------------------------------------------------------- build
def build(db_path: Path | None = None, corpus_path: Path | None = None, write_processed: bool = True) -> dict:
    corpus_path = corpus_path or RAW_CORPUS
    db_path = Path(db_path or settings.db_path)
    corpus = json.loads(Path(corpus_path).read_text(encoding="utf-8"))
    if db_path.exists():
        db_path.unlink()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = connect(db_path)
    init_schema(conn)

    records_by_acc: dict[str, list[dict]] = {}
    stats = Counter()
    for inv in corpus:
        acc = inv["accession"]
        cur = curation.INVESTIGATIONS.get(acc, {})
        texts = {f: clean_text(inv.get(f)) for f in TEXT_FIELDS}
        related = [x.strip() for x in re.split(r"[,\s]+", inv.get("related") or "") if x.strip().startswith("PSI")]
        conn.execute(
            """INSERT INTO investigation VALUES (:accession,:acronym,:title,:doi,:psi_version,:license,:project_type,
               :flight_platform,:hardware,:research_area,:sub_research_area,:nasa_center,:start_date,:end_date,
               :release_date,:objective,:approach,:hypothesis,:research_impacts,:related,:in_scope,:scope_note,:family,
               :fuel_phases,:configuration,:scale,:pillars,:needs,:key_variables,:sensors,:uses_data_from,:summary,
               :file_categories,:total_file_bytes,:contacts,:psi_url)""",
            dict(
                accession=acc, acronym=inv.get("acronym") or None, title=inv["title"], doi=inv.get("doi"),
                psi_version=inv.get("version"), license=inv.get("license"), project_type=inv.get("projectType"),
                flight_platform=(inv.get("flightProgram") or None), hardware=(inv.get("hardware") or "").strip() or None,
                research_area=inv.get("researchArea"), sub_research_area=inv.get("subResearchArea") or None,
                nasa_center=inv.get("nasaCenter") or None, start_date=inv.get("start") or None,
                end_date=inv.get("end") or None, release_date=inv.get("releaseDate") or None,
                objective=texts["objective"], approach=texts["approach"], hypothesis=texts["hypothesis"],
                research_impacts=texts["researchImpacts"], related=json.dumps(related),
                in_scope=int(cur.get("in_scope", True)), scope_note=cur.get("scope_note"),
                family=cur.get("family"), fuel_phases=json.dumps(cur.get("fuel_phases", [])),
                configuration=cur.get("configuration"), scale=cur.get("scale"),
                pillars=json.dumps(cur.get("pillars", [])), needs=json.dumps(cur.get("needs", {})),
                key_variables=json.dumps(cur.get("key_variables", [])), sensors=json.dumps(cur.get("sensors", [])),
                uses_data_from=json.dumps(cur.get("uses_data_from", [])), summary=cur.get("summary"),
                file_categories=json.dumps(inv.get("fileCategories", {})), total_file_bytes=inv.get("totalFileSize"),
                contacts=json.dumps(inv.get("contacts", [])),
                psi_url=f"https://psi.nasa.gov/physci/repo/data/investigations/{acc}",
            ),
        )
        for pub in inv.get("publications", []):
            conn.execute("INSERT INTO publication(accession,title,authors,doi) VALUES (?,?,?,?)",
                         (acc, pub.get("title"), pub.get("authors"), pub.get("doi")))

        # text chunks for retrieval
        header = f"{inv.get('acronym') or ''} {inv['title']}".strip()
        sections = [("summary", cur.get("summary") or "")] + [(f, texts[f]) for f in TEXT_FIELDS]
        for section, text in sections:
            for ch in chunk_text(text):
                conn.execute("INSERT INTO chunk(accession,section,text) VALUES (?,?,?)", (acc, section, f"{ch}"))
        conn.execute("INSERT INTO chunk(accession,section,text) VALUES (?,?,?)",
                     (acc, "title", f"{header}. {inv.get('subResearchArea') or ''}. {inv.get('hardware') or ''}"))
        pubs = "; ".join(p.get("title") or "" for p in inv.get("publications", []))
        if pubs:
            conn.execute("INSERT INTO chunk(accession,section,text) VALUES (?,?,?)", (acc, "publications", pubs))

        # tests + measurements
        recs = adapt_investigation(inv)
        records_by_acc[acc] = recs
        for r in recs:
            conn.execute(
                """INSERT INTO test VALUES (:test_id,:accession,:record_type,:source_file,:source_row,:label,:test_date,
                   :fuel,:fuel_phase,:material_class,:configuration,:thickness_mm,:o2_mole_frac,:pressure_kpa,:flow_cm_s,
                   :flow_direction,:diluent,:co2_mole_frac,:he_mole_frac,:gravity,:outcome,:outcome_class,:quality,
                   :notes,:raw)""",
                {**{k: v for k, v in r.items() if k != "measurements"},
                 "quality": json.dumps(r["quality"]), "raw": json.dumps(r["raw"], ensure_ascii=False)},
            )
            for m in r["measurements"]:
                conn.execute(
                    "INSERT INTO measurement(test_id,quantity,value,value_text,unit,source_column,note) VALUES (?,?,?,?,?,?,?)",
                    (r["test_id"], m["quantity"], m["value"], m["value_text"], m["unit"], m["source_column"], m["note"]),
                )
                stats["measurements"] += 1
        stats["tests"] += len(recs)
        stats["investigations"] += 1

    for h in curation.HABITATS:
        conn.execute("INSERT INTO habitat VALUES (:id,:name,:o2_pct_min,:o2_pct_max,:pressure_kpa_min,:pressure_kpa_max,"
                     ":gravity,:gravity_g,:status,:source,:note)", h)
    insights = curation.TEXT_INSIGHTS + computed_insights(records_by_acc)
    for ins in insights:
        conn.execute("INSERT INTO insight VALUES (:id,:need,:pillar,:title,:observation,:conditions,:design_question,"
                     ":limitation,:next_validation,:sources,:evidence_kind)", {**ins, "sources": json.dumps(ins["sources"])})
        conn.execute("INSERT INTO chunk(accession,section,text) VALUES (?,?,?)",
                     ((ins["sources"][0].get("accession") or "CHALLENGE"), f"insight:{ins['id']}",
                      f"{ins['title']}. {ins['observation']} {ins['design_question']}"))
    for e in curation.EARTH_APPLICATIONS:
        conn.execute("INSERT INTO earth_application VALUES (:id,:title,:domain,:contribution,:validation_needed,:sources)",
                     {**e, "sources": json.dumps(e["sources"])})
    for name, label, unit, level, desc in curation.VARIABLES:
        conn.execute("INSERT INTO variable VALUES (?,?,?,?,?)", (name, label, unit, level, desc))

    conn.execute("INSERT INTO chunk_fts(chunk_fts) VALUES ('rebuild')")
    built_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for k, v in {"built_at": built_at, "version": __version__, "source": "NASA PSI repository (psi.nasa.gov), CC0-1.0",
                 "corpus_file": Path(corpus_path).name, **{f"n_{k}": str(v) for k, v in stats.items()},
                 "n_insights": str(len(insights))}.items():
        conn.execute("INSERT INTO meta VALUES (?,?)", (k, v))
    conn.commit()

    # knowledge graph (+ re-index documents previously uploaded: originals are kept under data/documents)
    from ..knowledge import store as kg
    kg.build_from_psi(conn)
    kg.restore_documents(conn)

    if write_processed:
        export_processed(conn)
    conn.close()
    return {"db": str(db_path), **stats, "insights": len(insights), "built_at": built_at}


def export_processed(conn: sqlite3.Connection, out_dir: Path = PROCESSED_DIR) -> None:
    """Flat, versionable copies of the database (useful for review in Git and for other tools)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    conn.row_factory = sqlite3.Row
    for table in ("investigation", "test", "measurement", "variable", "habitat", "insight"):
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        if not rows:
            continue
        with open(out_dir / f"{table}s.csv", "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(rows[0].keys())
            for r in rows:
                w.writerow([r[k] for k in r.keys()])


def main() -> None:
    ap = argparse.ArgumentParser(description="Build the FlameAtlas database from the PSI corpus")
    ap.add_argument("--db", type=Path, default=None)
    ap.add_argument("--corpus", type=Path, default=None)
    ap.add_argument("--no-processed", action="store_true")
    args = ap.parse_args()
    print(json.dumps(build(args.db, args.corpus, write_processed=not args.no_processed), indent=2))


if __name__ == "__main__":
    main()
