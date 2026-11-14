"""SQLite storage: schema, connection helpers.

Three levels are kept explicitly separate (a lesson from fire-safety data work):
  investigation  -> a PSI science programme (e.g. FLEX, PSI-69)
  test           -> one experimental run / session in given conditions
  measurement    -> one quantity measured or reported for a test (long format)

Unknown values are stored as NULL, never as 0.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .config import settings

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS investigation (
    accession        TEXT PRIMARY KEY,
    acronym          TEXT,
    title            TEXT NOT NULL,
    doi              TEXT,
    psi_version      INTEGER,
    license          TEXT,
    project_type     TEXT,
    flight_platform  TEXT,
    hardware         TEXT,
    research_area    TEXT,
    sub_research_area TEXT,
    nasa_center      TEXT,
    start_date       TEXT,
    end_date         TEXT,
    release_date     TEXT,
    objective        TEXT,
    approach         TEXT,
    hypothesis       TEXT,
    research_impacts TEXT,
    related          TEXT,   -- JSON list of accessions
    in_scope         INTEGER NOT NULL DEFAULT 1,
    scope_note       TEXT,
    family           TEXT,   -- programme family: BASS, SAFFIRE, SAME, FLEX, ACME, ...
    fuel_phases      TEXT,   -- JSON list: solid | liquid | gas
    configuration    TEXT,
    scale            TEXT,
    pillars          TEXT,   -- JSON list: prevention | detection | suppression
    needs            TEXT,   -- JSON {need: weight}
    key_variables    TEXT,   -- JSON list
    sensors          TEXT,   -- JSON list
    uses_data_from   TEXT,   -- JSON list (ground studies re-using flight data)
    summary          TEXT,   -- curated one-paragraph summary (traceable to PSI text)
    file_categories  TEXT,   -- JSON {category: {n, bytes, examples}}
    total_file_bytes INTEGER,
    contacts         TEXT,   -- JSON list (names / roles only)
    psi_url          TEXT
);

CREATE TABLE IF NOT EXISTS publication (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    accession        TEXT NOT NULL REFERENCES investigation(accession),
    title            TEXT,
    authors          TEXT,
    doi              TEXT
);

CREATE TABLE IF NOT EXISTS test (
    test_id          TEXT PRIMARY KEY,
    accession        TEXT NOT NULL REFERENCES investigation(accession),
    record_type      TEXT NOT NULL,  -- test | session | test_matrix | data_reference
    source_file      TEXT NOT NULL,
    source_row       INTEGER NOT NULL,
    label            TEXT,
    test_date        TEXT,
    fuel             TEXT,
    fuel_phase       TEXT,
    material_class   TEXT,
    configuration    TEXT,
    thickness_mm     REAL,
    o2_mole_frac     REAL,
    pressure_kpa     REAL,
    flow_cm_s        REAL,
    flow_direction   TEXT,
    diluent          TEXT,
    co2_mole_frac    REAL,
    he_mole_frac     REAL,
    gravity          TEXT NOT NULL DEFAULT 'microgravity',
    outcome          TEXT,
    outcome_class    TEXT,
    quality          TEXT,   -- JSON list of flags (assumed_unit, parsed_from_text, ...)
    notes            TEXT,
    raw              TEXT    -- JSON: the original PSI row, header -> value
);
CREATE INDEX IF NOT EXISTS idx_test_acc ON test(accession);

CREATE TABLE IF NOT EXISTS measurement (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    test_id          TEXT NOT NULL REFERENCES test(test_id),
    quantity         TEXT NOT NULL,
    value            REAL,
    value_text       TEXT,
    unit             TEXT,
    source_column    TEXT,
    note             TEXT
);
CREATE INDEX IF NOT EXISTS idx_meas_test ON measurement(test_id);
CREATE INDEX IF NOT EXISTS idx_meas_q ON measurement(quantity);

CREATE TABLE IF NOT EXISTS variable (
    name             TEXT PRIMARY KEY,
    label            TEXT,
    unit             TEXT,
    level            TEXT,   -- test | measurement
    description      TEXT
);

CREATE TABLE IF NOT EXISTS habitat (
    id               TEXT PRIMARY KEY,
    name             TEXT,
    o2_pct_min       REAL,
    o2_pct_max       REAL,
    pressure_kpa_min REAL,
    pressure_kpa_max REAL,
    gravity          TEXT,
    gravity_g        REAL,
    status           TEXT,   -- documented | planning_assumption | hypothetical
    source           TEXT,
    note             TEXT
);

CREATE TABLE IF NOT EXISTS insight (
    id               TEXT PRIMARY KEY,
    need             TEXT,
    pillar           TEXT,
    title            TEXT,
    observation      TEXT,
    conditions       TEXT,
    design_question  TEXT,
    limitation       TEXT,
    next_validation  TEXT,
    sources          TEXT,   -- JSON list of {accession, field}
    evidence_kind    TEXT    -- psi_text | computed_from_table | hypothesis
);

CREATE TABLE IF NOT EXISTS earth_application (
    id               TEXT PRIMARY KEY,
    title            TEXT,
    domain           TEXT,
    contribution     TEXT,
    validation_needed TEXT,
    sources          TEXT    -- JSON list of {accession|url, label}
);

CREATE TABLE IF NOT EXISTS chunk (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    accession        TEXT NOT NULL,
    section          TEXT NOT NULL,
    text             TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
    text, section UNINDEXED, accession UNINDEXED,
    content='chunk', content_rowid='id', tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

JSON_COLUMNS = {
    "related", "fuel_phases", "pillars", "needs", "key_variables", "sensors",
    "uses_data_from", "file_categories", "contacts", "quality", "raw", "sources",
}


def connect(db_path: Path | str | None = None) -> sqlite3.Connection:
    path = Path(db_path or settings.db_path)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    out: dict[str, Any] = {}
    for key in row.keys():
        value = row[key]
        if key in JSON_COLUMNS and isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                pass
        if key in ("in_scope",) and value is not None:
            value = bool(value)
        out[key] = value
    return out


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [row_to_dict(r) for r in rows]  # type: ignore[misc]


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
