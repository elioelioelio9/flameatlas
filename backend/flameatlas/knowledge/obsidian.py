"""Obsidian interoperability through what Obsidian actually is: a folder of Markdown files.

Obsidian has no public network API; a vault is a local folder. So:
  export  → a zip (or a folder written by the local server) with one note per node: YAML frontmatter, typed sections of
            [[wikilinks]] per relationship, evidence quotes and source links. Opening the folder in Obsidian shows the
            same graph in Obsidian's own graph view.
  import  → Markdown notes (or a zipped vault): frontmatter, tags and [[wikilinks]] are kept; each note becomes a
            document node, wikilinks become `references` edges.
Obsidian stays optional: the knowledge engine works without it.
"""

from __future__ import annotations

import io
import json
import re
import sqlite3
import zipfile
from pathlib import Path
from typing import Any

from .ontology import RELATIONS
from .store import Graph, _resolve_link, ingest, init

FOLDER = {"document": "Documents", "concept": "Concepts", "entity": "Entities", "data": "Data", "research": "Research"}


def _safe(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|#^\[\]]+", " ", name).strip()
    return re.sub(r"\s+", " ", name)[:110] or "untitled"


def _note_names(conn: sqlite3.Connection) -> dict[str, str]:
    names, used = {}, set()
    for r in conn.execute("SELECT id, type, label FROM kg_node ORDER BY id"):
        base = _safe(r["label"].split(" — ")[0] if r["type"] == "document" and r["id"].startswith("doc:PSI") else r["label"])
        n = base
        k = 2
        while n.lower() in used:
            n = f"{base} ({k})"; k += 1
        used.add(n.lower()); names[r["id"]] = n
    return names


def build_vault(conn: sqlite3.Connection) -> dict[str, str]:
    """Return {relative path: markdown}."""
    init(conn)
    names = _note_names(conn)
    files: dict[str, str] = {}
    nodes = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM kg_node")}
    out_e: dict[str, list] = {}
    in_e: dict[str, list] = {}
    for e in conn.execute("SELECT * FROM kg_edge"):
        out_e.setdefault(e["src"], []).append(dict(e)); in_e.setdefault(e["dst"], []).append(dict(e))
    for nid, n in nodes.items():
        props = json.loads(n["props"] or "{}")
        fm = {"id": nid, "type": n["type"], "aliases": props.get("aliases") or ([props["acronym"]] if props.get("acronym") else []),
              "tags": [f"flameatlas/{n['type']}"] + [f"family/{props['family'].replace(' ', '-')}" for _ in [0] if props.get("family")],
              "doi": props.get("doi"), "source": props.get("url") or props.get("source"), "generated": "FlameAtlas knowledge engine"}
        lines = ["---"]
        for k, v in fm.items():
            if v in (None, [], ""):
                continue
            lines.append(f"{k}: [{', '.join(json.dumps(x) for x in v)}]" if isinstance(v, list) else f"{k}: {json.dumps(v) if isinstance(v, str) else v}")
        lines += ["---", "", f"# {n['label']}", ""]
        if n["description"]:
            lines += [n["description"], ""]
        if props.get("doi"):
            lines += [f"DOI: [{props['doi']}](https://doi.org/{props['doi']})", ""]
        by_rel: dict[str, list[str]] = {}
        for e in out_e.get(nid, []):
            if e["dst"] not in names:
                continue
            ev = json.loads(e["evidence"] or "[]")
            q = next((x.get("quote") for x in ev if x.get("quote")), None)
            extra = ""
            if ev and "min" in ev[0]:
                extra = f" — {ev[0].get('tests') or ev[0].get('values')} values, {ev[0]['min']:g}–{ev[0]['max']:g} {ev[0].get('unit') or ''}"
            elif q:
                extra = f" — “{q[:160].strip()}”"
            by_rel.setdefault(e["rel"], []).append(f"- [[{names[e['dst']]}]]{extra} ({e['basis']})")
        for rel, items in by_rel.items():
            lines += [f"## {rel.replace('_', ' ').capitalize()}", f"_{RELATIONS[rel]}_", "", *items[:60], ""]
        back = [f"- [[{names[e['src']]}]] · {e['rel'].replace('_', ' ')}" for e in in_e.get(nid, []) if e["src"] in names]
        if back:
            lines += ["## Linked from", *back[:80], ""]
        files[f"FlameAtlas/{FOLDER.get(n['type'], 'Other')}/{names[nid]}.md"] = "\n".join(lines)
    files["FlameAtlas/README.md"] = ("---\ngenerated: \"FlameAtlas knowledge engine\"\n---\n# FlameAtlas vault\n\nGenerated from the FlameAtlas knowledge engine (NASA PSI combustion data, CC0, plus your documents).\n"
                                     "Open this folder as an Obsidian vault and use the graph view. Each relationship section states its definition and basis "
                                     "(metadata, text, table, computed, curated, inferred, wikilink). Inferred links are not stated facts.\n")
    return files


def export_zip(conn: sqlite3.Connection) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, text in build_vault(conn).items():
            z.writestr(path, text)
    return buf.getvalue()


def sync_folder(conn: sqlite3.Connection, folder: Path) -> dict[str, Any]:
    """Write the vault into a local folder (the server runs on the user's machine). Only files under FlameAtlas/ are touched."""
    folder = folder.expanduser().resolve()
    home = Path.home().resolve()
    if home not in folder.parents and folder != home:
        raise ValueError("The vault folder must be inside your home directory.")
    files = build_vault(conn)
    for rel, text in files.items():
        p = folder / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return {"folder": str(folder), "notes": len(files), "path": str(folder / "FlameAtlas")}


def import_files(conn: sqlite3.Connection, files: list[tuple[str, bytes]]) -> list[dict[str, Any]]:
    """Import Markdown notes or a zipped vault. Notes generated by FlameAtlas itself are skipped (no echo)."""
    expanded: list[tuple[str, bytes]] = []
    for name, data in files:
        if name.lower().endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for info in z.infolist():
                    if info.filename.lower().endswith(".md") and not info.is_dir():
                        expanded.append((info.filename, z.read(info)))
        else:
            expanded.append((name, data))
    results = []
    for name, data in expanded:
        if b"generated: \"FlameAtlas knowledge engine\"" in data[:4000]:
            results.append({"file": name, "status": "skipped (FlameAtlas export)"}); continue
        try:
            r = ingest(conn, Path(name).name, data, source="obsidian", extra_meta={"vault_path": name})
            results.append({"file": name, **r})
        except Exception as e:  # report, never crash the batch
            results.append({"file": name, "status": "error", "error": str(e)[:200]})
    # second pass: links between notes of the same vault, now that every note exists
    for r in results:
        for link in r.get("wikilinks") or []:
            tgt = _resolve_link(conn, link)
            if tgt and tgt != f"doc:{r['id']}":
                Graph(conn, f"upload:{r['id']}").edge(f"doc:{r['id']}", "references", tgt, "wikilink", {"link": f"[[{link}]]"})
    conn.commit()
    return results
