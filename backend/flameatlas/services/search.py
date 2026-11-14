"""Hybrid passage retrieval.

1. Lexical: SQLite FTS5 / BM25 (porter stemming) over every PSI text field, curated summaries and insights.
2. Vector-space: TF-IDF (word 1-2 grams + character n-grams for FR/EN morphology) cosine similarity.
3. Reciprocal Rank Fusion of both lists, then aggregation per investigation.

No external service is needed, so search works offline and is reproducible.
"""

from __future__ import annotations

import math
import re
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from .query_parser import ParsedQuery, fold

try:  # scikit-learn is in requirements; keep a pure-python fallback for minimal installs
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import linear_kernel
    from scipy.sparse import hstack

    HAVE_SKLEARN = True
except Exception:  # pragma: no cover
    HAVE_SKLEARN = False

RRF_K = 60


@dataclass
class Passage:
    chunk_id: int
    accession: str
    section: str
    text: str
    score: float
    bm25_rank: int | None
    tfidf_rank: int | None

    def to_dict(self) -> dict[str, Any]:
        return {"chunk_id": self.chunk_id, "accession": self.accession, "section": self.section, "text": self.text,
                "score": round(self.score, 5), "bm25_rank": self.bm25_rank, "tfidf_rank": self.tfidf_rank}


class SearchIndex:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn
        rows = conn.execute("SELECT id, accession, section, text FROM chunk").fetchall()
        self.chunks = [dict(r) for r in rows]
        self.by_id = {c["id"]: c for c in self.chunks}
        self.texts = [fold(c["text"]) for c in self.chunks]
        if HAVE_SKLEARN and self.chunks:
            self.word_vec = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=1, stop_words="english")
            self.char_vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True, min_df=2)
            self.matrix = hstack([self.word_vec.fit_transform(self.texts), self.char_vec.fit_transform(self.texts)]).tocsr()
        else:
            self._build_fallback()

    # -------------------------------------------------------------- fallback TF-IDF (no sklearn)
    def _build_fallback(self) -> None:
        self.docs_tokens = [Counter(re.findall(r"[a-z0-9]{3,}", t)) for t in self.texts]
        df = Counter()
        for toks in self.docs_tokens:
            df.update(toks.keys())
        n = max(len(self.docs_tokens), 1)
        self.idf = {t: math.log((1 + n) / (1 + d)) + 1 for t, d in df.items()}

    def _tfidf_scores(self, query: str) -> list[tuple[int, float]]:
        q = fold(query)
        if HAVE_SKLEARN and self.chunks:
            qv = hstack([self.word_vec.transform([q]), self.char_vec.transform([q])]).tocsr()
            sims = linear_kernel(qv, self.matrix).ravel()
            order = sims.argsort()[::-1]
            return [(self.chunks[i]["id"], float(sims[i])) for i in order[:200] if sims[i] > 0]
        qt = Counter(re.findall(r"[a-z0-9]{3,}", q))
        scores = []
        for i, toks in enumerate(self.docs_tokens):
            s = sum(qt[t] * toks[t] * self.idf.get(t, 0) ** 2 for t in qt if t in toks)
            if s > 0:
                norm = math.sqrt(sum((c * self.idf.get(t, 0)) ** 2 for t, c in toks.items())) or 1
                scores.append((self.chunks[i]["id"], s / norm))
        scores.sort(key=lambda x: -x[1])
        return scores[:200]

    # -------------------------------------------------------------- BM25 via FTS5
    def _bm25(self, terms: list[str]) -> list[tuple[int, float]]:
        toks = [t for t in dict.fromkeys(terms) if re.fullmatch(r"[a-z0-9][a-z0-9\-]*", t) and len(t) > 1]
        if not toks:
            return []
        match = " OR ".join(f'"{t}"' for t in toks[:40])
        try:
            rows = self.conn.execute(
                "SELECT rowid, bm25(chunk_fts) AS s FROM chunk_fts WHERE chunk_fts MATCH ? ORDER BY s LIMIT 200",
                (match,)).fetchall()
        except sqlite3.OperationalError:
            return []
        return [(r[0], -float(r[1])) for r in rows]

    # -------------------------------------------------------------- public
    def search(self, parsed: ParsedQuery, limit: int = 12, accessions: set[str] | None = None) -> list[Passage]:
        terms = parsed.keywords + [fold(t) for t in parsed.expanded_terms]
        query_text = " ".join(terms) or parsed.text
        bm = self._bm25(terms)
        tf = self._tfidf_scores(query_text)
        ranks_bm = {cid: i for i, (cid, _) in enumerate(bm)}
        ranks_tf = {cid: i for i, (cid, _) in enumerate(tf)}
        fused: dict[int, float] = defaultdict(float)
        for cid, r in ranks_bm.items():
            fused[cid] += 1.0 / (RRF_K + r + 1)
        for cid, r in ranks_tf.items():
            fused[cid] += 1.0 / (RRF_K + r + 1)
        out = []
        for cid, s in sorted(fused.items(), key=lambda x: -x[1]):
            c = self.by_id.get(cid)
            if not c or (accessions is not None and c["accession"] not in accessions):
                continue
            out.append(Passage(cid, c["accession"], c["section"], c["text"], s, ranks_bm.get(cid), ranks_tf.get(cid)))
            if len(out) >= limit:
                break
        return out

    def investigation_scores(self, parsed: ParsedQuery) -> dict[str, float]:
        """Normalised 0..1 text relevance per investigation (sum of its top-3 passage scores)."""
        passages = self.search(parsed, limit=150)
        per: dict[str, list[float]] = defaultdict(list)
        for p in passages:
            per[p.accession].append(p.score)
        agg = {a: sum(sorted(v, reverse=True)[:3]) for a, v in per.items()}
        top = max(agg.values(), default=0) or 1
        return {a: v / top for a, v in agg.items()}


_INDEX: dict[int, SearchIndex] = {}


def get_index(conn: sqlite3.Connection) -> SearchIndex:
    key = id(conn)
    if key not in _INDEX:
        _INDEX[key] = SearchIndex(conn)
    return _INDEX[key]
