"""Document ingestion: text extraction with structure, values with units, concepts and entities.

Supported without extra dependencies: Markdown (frontmatter, tags, wikilinks), TXT, CSV/TSV, JSON, HTML, DOCX, XLSX.
PDF needs `pypdf` (optional; page numbers are kept). Scanned PDFs without a text layer are reported, not guessed.
Document content is treated as data only: nothing in a document is ever executed or obeyed.
"""

from __future__ import annotations

import csv
import hashlib
import html
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any

from ..services.query_parser import fold
from .ontology import CONCEPTS, ENTITIES, QUANTITY_CONCEPT, UNIT_PATTERNS


@dataclass
class Section:
    title: str
    text: str
    locator: str  # page 3 | sheet Data!A2:F40 | § Heading | row 12


@dataclass
class ParsedDoc:
    filename: str
    kind: str
    title: str
    sections: list[Section]
    meta: dict[str, Any] = field(default_factory=dict)
    tags: list[str] = field(default_factory=list)
    wikilinks: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def text(self) -> str:
        return "\n\n".join(s.text for s in self.sections)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ------------------------------------------------------------------ format readers
FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.S)
WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
TAG = re.compile(r"(?<![\w/])#([A-Za-z][\w/-]{0,40})")


def _yaml_light(block: str) -> dict[str, Any]:
    """Tiny YAML subset (key: value, key: [a, b], lists with '- '). Enough for Obsidian frontmatter."""
    out: dict[str, Any] = {}
    key = None
    for line in block.splitlines():
        if not line.strip() or line.strip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z0-9_\-]+):\s*(.*)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip()
            if val.startswith("[") and val.endswith("]"):
                out[key] = [v.strip().strip("'\"") for v in val[1:-1].split(",") if v.strip()]
            elif val == "":
                out[key] = []
            else:
                out[key] = val.strip("'\"")
        elif key and line.strip().startswith("- "):
            if not isinstance(out.get(key), list):
                out[key] = []
            out[key].append(line.strip()[2:].strip().strip("'\""))
    return out


def read_markdown(name: str, text: str) -> ParsedDoc:
    meta: dict[str, Any] = {}
    m = FRONTMATTER.match(text)
    if m:
        meta = _yaml_light(m.group(1))
        text = text[m.end():]
    links = list(dict.fromkeys(l.strip() for l in WIKILINK.findall(text)))
    tags = list(dict.fromkeys(TAG.findall(text)))
    fm_tags = meta.get("tags")
    if isinstance(fm_tags, str):
        fm_tags = [t.strip() for t in fm_tags.split(",")]
    tags = list(dict.fromkeys([*(fm_tags or []), *tags]))
    sections: list[Section] = []
    cur_title, buf = meta.get("title") or name.rsplit(".", 1)[0], []
    title = cur_title
    for line in text.splitlines():
        h = re.match(r"^(#{1,6})\s+(.*)$", line)
        if h:
            if "".join(buf).strip():
                sections.append(Section(cur_title, "\n".join(buf).strip(), f"§ {cur_title}"))
            cur_title, buf = h.group(2).strip(), []
            if len(h.group(1)) == 1 and not meta.get("title") and not sections:
                title = cur_title
        else:
            buf.append(line)
    if "".join(buf).strip():
        sections.append(Section(cur_title, "\n".join(buf).strip(), f"§ {cur_title}"))
    return ParsedDoc(name, "markdown", str(title), sections, meta=meta, tags=tags, wikilinks=links)


def read_text(name: str, text: str) -> ParsedDoc:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    sections = [Section(f"Paragraph {i + 1}", p, f"¶ {i + 1}") for i, p in enumerate(paras)]
    return ParsedDoc(name, "text", name.rsplit(".", 1)[0], sections)


def read_csv(name: str, text: str) -> ParsedDoc:
    dialect = csv.excel_tab if name.lower().endswith(".tsv") else csv.excel
    rows = list(csv.reader(io.StringIO(text), dialect))
    if not rows:
        return ParsedDoc(name, "table", name, [], warnings=["empty table"])
    head, body = rows[0], rows[1:]
    sections = []
    for i in range(0, len(body), 25):
        block = body[i:i + 25]
        lines = [", ".join(f"{h}: {v}" for h, v in zip(head, r) if v != "") for r in block]
        sections.append(Section(f"Rows {i + 2}–{i + 1 + len(block)}", "\n".join(lines), f"rows {i + 2}–{i + 1 + len(block)}"))
    return ParsedDoc(name, "table", name.rsplit(".", 1)[0], sections, meta={"columns": head, "rows": len(body)})


def read_json(name: str, text: str) -> ParsedDoc:
    data = json.loads(text)
    flat: list[str] = []

    def walk(x: Any, path: str) -> None:
        if isinstance(x, dict):
            for k, v in x.items():
                walk(v, f"{path}.{k}" if path else str(k))
        elif isinstance(x, list):
            for i, v in enumerate(x[:500]):
                walk(v, f"{path}[{i}]")
        else:
            flat.append(f"{path}: {x}")
    walk(data, "")
    sections = [Section(f"Fields {i + 1}–{i + len(flat[i:i + 40])}", "\n".join(flat[i:i + 40]), f"json {i + 1}") for i in range(0, len(flat), 40)]
    title = data.get("title") if isinstance(data, dict) and isinstance(data.get("title"), str) else name.rsplit(".", 1)[0]
    return ParsedDoc(name, "json", title, sections)


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.sections: list[Section] = []
        self.title = ""
        self.cur, self.buf, self.skip, self.in_title, self.in_h = "Document", [], 0, False, False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if tag == "title":
            self.in_title = True
        if tag in ("h1", "h2", "h3"):
            self.flush(); self.in_h = True; self.cur = ""
        if tag in ("p", "br", "li", "tr", "div"):
            self.buf.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)
        if tag == "title":
            self.in_title = False
        if tag in ("h1", "h2", "h3"):
            self.in_h = False

    def handle_data(self, data):
        if self.skip:
            return
        if self.in_title:
            self.title += data
        elif self.in_h:
            self.cur += data
        else:
            self.buf.append(data)

    def flush(self):
        t = re.sub(r"\n\s*\n+", "\n\n", "".join(self.buf)).strip()
        if t:
            self.sections.append(Section(self.cur.strip() or "Document", t, f"§ {self.cur.strip() or 'Document'}"))
        self.buf = []


def read_html(name: str, text: str) -> ParsedDoc:
    p = _HTMLText(); p.feed(text); p.flush()
    return ParsedDoc(name, "html", html.unescape(p.title.strip()) or name, p.sections)


def read_docx(name: str, data: bytes) -> ParsedDoc:
    z = zipfile.ZipFile(io.BytesIO(data))
    xml = z.read("word/document.xml").decode("utf-8", "ignore")
    sections: list[Section] = []
    cur, buf, title = "Document", [], name.rsplit(".", 1)[0]
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        style = re.search(r'<w:pStyle w:val="([^"]+)"', para)
        text = html.unescape("".join(re.findall(r"<w:t[^>]*>(.*?)</w:t>", para, re.S))).strip()
        if not text:
            continue
        if style and re.match(r"(Heading|Titre|Title)", style.group(1), re.I):
            if buf:
                sections.append(Section(cur, "\n".join(buf), f"§ {cur}"))
            cur, buf = text, []
            if style.group(1).lower().startswith("title") or title == name.rsplit(".", 1)[0]:
                title = text if style.group(1).lower().startswith("title") else title
        else:
            buf.append(text)
    if buf:
        sections.append(Section(cur, "\n".join(buf), f"§ {cur}"))
    core = z.read("docProps/core.xml").decode("utf-8", "ignore") if "docProps/core.xml" in z.namelist() else ""
    meta = {k: html.unescape(v) for k, v in re.findall(r"<(?:dc|dcterms|cp):(\w+)[^>]*>([^<]+)<", core)}
    return ParsedDoc(name, "docx", meta.get("title") or title, sections, meta=meta)


def read_xlsx(name: str, data: bytes) -> ParsedDoc:
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf-8", "ignore"), re.S):
            shared.append(html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))))
    wb = z.read("xl/workbook.xml").decode("utf-8", "ignore")
    names = re.findall(r'<sheet [^>]*name="([^"]+)"', wb)
    sections: list[Section] = []
    for idx, sheet in enumerate(names, start=1):
        path = f"xl/worksheets/sheet{idx}.xml"
        if path not in z.namelist():
            continue
        xml = z.read(path).decode("utf-8", "ignore")
        rows: list[list[tuple[str, str]]] = []
        for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
            cells = []
            for ref, attrs, val in re.findall(r'<c r="([A-Z]+\d+)"([^>]*)>(?:<f>.*?</f>)?(?:<v>(.*?)</v>)?', row, re.S):
                if 't="s"' in attrs and val:
                    val = shared[int(val)] if int(val) < len(shared) else val
                cells.append((ref, val))
            rows.append(cells)
        if not rows:
            continue
        head = [v for _, v in rows[0]]
        for i in range(1, len(rows), 25):
            block = rows[i:i + 25]
            lines = [", ".join(f"{head[j] if j < len(head) else ref}: {v}" for j, (ref, v) in enumerate(r) if v) for r in block]
            first, last = (block[0][0][0] if block[0] else "?"), (block[-1][-1][0] if block[-1] else "?")
            sections.append(Section(f"{sheet} {first}:{last}", "\n".join(lines), f"sheet {sheet}!{first}:{last}"))
    return ParsedDoc(name, "xlsx", name.rsplit(".", 1)[0], sections, meta={"sheets": names})


def read_pdf(name: str, data: bytes) -> ParsedDoc:
    try:
        from pypdf import PdfReader  # optional dependency
    except Exception:
        return ParsedDoc(name, "pdf", name, [], warnings=["PDF support needs the 'pypdf' package (pip install pypdf)."])
    r = PdfReader(io.BytesIO(data))
    sections, empty = [], 0
    for i, page in enumerate(r.pages, start=1):
        t = (page.extract_text() or "").strip()
        if not t:
            empty += 1
            continue
        sections.append(Section(f"Page {i}", t, f"page {i}"))
    warnings = []
    if empty and not sections:
        warnings.append("No text layer found: this looks like a scanned PDF. OCR is not available here, so nothing was guessed.")
    elif empty:
        warnings.append(f"{empty} page(s) without a text layer were skipped (possible scans).")
    info = r.metadata or {}
    meta = {k.strip("/").lower(): str(v) for k, v in dict(info).items() if v}
    return ParsedDoc(name, "pdf", meta.get("title") or name.rsplit(".", 1)[0], sections, meta=meta, warnings=warnings)


def parse_file(name: str, data: bytes) -> ParsedDoc:
    ext = name.lower().rsplit(".", 1)[-1] if "." in name else ""
    if ext == "pdf":
        return read_pdf(name, data)
    if ext == "docx":
        return read_docx(name, data)
    if ext == "xlsx":
        return read_xlsx(name, data)
    text = data.decode("utf-8", "replace")
    if ext in ("md", "markdown"):
        return read_markdown(name, text)
    if ext in ("csv", "tsv"):
        return read_csv(name, text)
    if ext == "json":
        return read_json(name, text)
    if ext in ("html", "htm"):
        return read_html(name, text)
    if ext in ("txt", "text", "log", ""):
        return read_text(name, text)
    raise ValueError(f"Unsupported file type: .{ext}")


# ------------------------------------------------------------------ knowledge extraction
def _alias_regex(alias: str) -> re.Pattern:
    a = fold(alias).strip()
    return re.compile(rf"(?<![a-z0-9]){re.escape(a)}(?:s|es)?(?![a-z0-9])")


_CONCEPT_RX = {cid: [_alias_regex(a) for a in c["aliases"]] for cid, c in CONCEPTS.items()}
_ENTITY_RX = {eid: [_alias_regex(a) for a in e["aliases"]] for eid, e in ENTITIES.items()}


def find_terms(text: str, which: str = "concept") -> dict[str, str]:
    """Return {id: matched surface form} for concepts or entities present in text."""
    f = fold(text)
    table = _CONCEPT_RX if which == "concept" else _ENTITY_RX
    out = {}
    for cid, rxs in table.items():
        for rx in rxs:
            m = rx.search(f)
            if m:
                out[cid] = m.group(0)
                break
    return out


def snippet(text: str, term: str, width: int = 220) -> str:
    f = fold(text)
    i = f.find(fold(term).strip())
    if i < 0:
        return text[:width]
    a = max(0, i - width // 2)
    b = min(len(text), i + len(term) + width // 2)
    return ("…" if a else "") + text[a:b].strip() + ("…" if b < len(text) else "")


_NUM = r"[-+]?\d{1,6}(?:[.,]\d+)?(?:\s?[x×]\s?10\^?-?\d+)?"
_VALUE_RX = [(q, re.compile(rf"({_NUM})\s?({u})(?![a-z])", re.I)) for q, u in UNIT_PATTERNS]


def extract_values(text: str) -> list[dict[str, Any]]:
    """Numbers with units, kept exactly as written (no silent conversion)."""
    out, seen = [], set()
    for qty, rx in _VALUE_RX:
        for m in rx.finditer(text):
            span = m.span()
            if any(a <= span[0] < b for a, b in seen):
                continue
            seen.add(span)
            raw_num, unit = m.group(1), m.group(2).strip()
            try:
                val = float(raw_num.replace(",", ".").split("x")[0].split("×")[0])
            except ValueError:
                continue
            ctx = text[max(0, span[0] - 80): span[1] + 80].replace("\n", " ").strip()
            out.append({"value": val, "raw": m.group(0), "unit": unit, "quantity": qty, "concept": QUANTITY_CONCEPT.get(qty), "context": ctx})
    return out[:400]


def chunk_sections(sections: list[Section], max_chars: int = 900) -> list[Section]:
    """Split long sections on paragraph/sentence boundaries, keeping the locator."""
    out = []
    for s in sections:
        if len(s.text) <= max_chars:
            out.append(s); continue
        parts, buf = re.split(r"(?<=[.!?])\s+|\n{2,}", s.text), ""
        n = 1
        for p in parts:
            if len(buf) + len(p) > max_chars and buf:
                out.append(Section(s.title, buf.strip(), f"{s.locator} · part {n}")); n += 1; buf = ""
            buf += p + " "
        if buf.strip():
            out.append(Section(s.title, buf.strip(), f"{s.locator} · part {n}" if n > 1 else s.locator))
    return out
