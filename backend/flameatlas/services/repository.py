"""Read-side data access. All SQL lives here; services work on plain dicts."""

from __future__ import annotations

import json
import sqlite3
from functools import lru_cache
from typing import Any

from ..db import row_to_dict, rows_to_dicts

TEST_NUMERIC = ("thickness_mm", "o2_mole_frac", "pressure_kpa", "flow_cm_s", "co2_mole_frac", "he_mole_frac")


class Repository:
    def __init__(self, conn: sqlite3.Connection):
        self.conn = conn

    # ---------------------------------------------------------------- meta
    def meta(self) -> dict[str, str]:
        return {r["key"]: r["value"] for r in self.conn.execute("SELECT key, value FROM meta")}

    # ---------------------------------------------------------------- investigations
    def investigations(self, include_out_of_scope: bool = True) -> list[dict[str, Any]]:
        sql = "SELECT * FROM investigation"
        if not include_out_of_scope:
            sql += " WHERE in_scope = 1"
        invs = rows_to_dicts(self.conn.execute(sql + " ORDER BY accession").fetchall())
        prof = self.profiles()
        for inv in invs:
            inv["profile"] = prof.get(inv["accession"], empty_profile())
        return invs

    def investigation(self, accession: str) -> dict[str, Any] | None:
        inv = row_to_dict(self.conn.execute("SELECT * FROM investigation WHERE accession = ?", (accession,)).fetchone())
        if inv is None:
            return None
        inv["profile"] = self.profiles().get(accession, empty_profile())
        inv["publications"] = rows_to_dicts(
            self.conn.execute("SELECT title, authors, doi FROM publication WHERE accession = ?", (accession,)).fetchall())
        inv["insights"] = [i for i in self.insights() if any(s.get("accession") == accession for s in i["sources"])]
        return inv

    # ---------------------------------------------------------------- profiles (data-derived condition ranges)
    def profiles(self) -> dict[str, dict[str, Any]]:
        return _profiles_cached(id(self.conn), self.conn)

    # ---------------------------------------------------------------- tests
    def tests(self, accessions: list[str] | None = None, record_types: tuple[str, ...] | None = None,
              limit: int | None = None, offset: int = 0) -> list[dict[str, Any]]:
        sql, args = "SELECT * FROM test WHERE 1=1", []
        if accessions:
            sql += f" AND accession IN ({','.join('?' * len(accessions))})"
            args += accessions
        if record_types:
            sql += f" AND record_type IN ({','.join('?' * len(record_types))})"
            args += list(record_types)
        sql += " ORDER BY accession, source_file, source_row"
        if limit is not None:
            sql += " LIMIT ? OFFSET ?"
            args += [limit, offset]
        return rows_to_dicts(self.conn.execute(sql, args).fetchall())

    def measurements_for(self, test_ids: list[str]) -> dict[str, list[dict[str, Any]]]:
        out: dict[str, list[dict[str, Any]]] = {}
        for i in range(0, len(test_ids), 900):
            batch = test_ids[i:i + 900]
            rows = self.conn.execute(
                f"SELECT test_id, quantity, value, value_text, unit, source_column, note FROM measurement "
                f"WHERE test_id IN ({','.join('?' * len(batch))})", batch).fetchall()
            for r in rows:
                out.setdefault(r["test_id"], []).append(dict(r))
        return out

    def measurement_quantities(self) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            "SELECT m.quantity, m.unit, t.accession, COUNT(*) n, SUM(m.value IS NOT NULL) n_numeric "
            "FROM measurement m JOIN test t ON t.test_id = m.test_id GROUP BY m.quantity, m.unit, t.accession "
            "ORDER BY m.quantity").fetchall()
        return [dict(r) for r in rows]

    # ---------------------------------------------------------------- other tables
    def habitats(self) -> list[dict[str, Any]]:
        return rows_to_dicts(self.conn.execute("SELECT * FROM habitat").fetchall())

    def habitat(self, hid: str) -> dict[str, Any] | None:
        return row_to_dict(self.conn.execute("SELECT * FROM habitat WHERE id = ?", (hid,)).fetchone())

    def insights(self) -> list[dict[str, Any]]:
        return rows_to_dicts(self.conn.execute("SELECT * FROM insight").fetchall())

    def earth(self) -> list[dict[str, Any]]:
        return rows_to_dicts(self.conn.execute("SELECT * FROM earth_application").fetchall())

    def variables(self) -> list[dict[str, Any]]:
        return rows_to_dicts(self.conn.execute("SELECT * FROM variable").fetchall())

    def chunks(self) -> list[dict[str, Any]]:
        return [dict(r) for r in self.conn.execute("SELECT id, accession, section, text FROM chunk").fetchall()]


def empty_profile() -> dict[str, Any]:
    return {"n_tests": 0, "n_records": 0, "record_types": {}, "fuel_phases": [], "ranges": {}, "coverage": {},
            "measured_quantities": [], "outcome_classes": {}}


_PROFILE_CACHE: dict[int, dict[str, dict[str, Any]]] = {}


def _profiles_cached(key: int, conn: sqlite3.Connection) -> dict[str, dict[str, Any]]:
    if key in _PROFILE_CACHE:
        return _PROFILE_CACHE[key]
    prof: dict[str, dict[str, Any]] = {}
    rows = conn.execute("SELECT * FROM test").fetchall()
    for r in rows:
        acc = r["accession"]
        p = prof.setdefault(acc, empty_profile())
        p["n_records"] += 1
        p["record_types"][r["record_type"]] = p["record_types"].get(r["record_type"], 0) + 1
        if r["record_type"] == "test":
            p["n_tests"] += 1
        if r["fuel_phase"] and r["fuel_phase"] not in p["fuel_phases"]:
            p["fuel_phases"].append(r["fuel_phase"])
        if r["outcome_class"]:
            p["outcome_classes"][r["outcome_class"]] = p["outcome_classes"].get(r["outcome_class"], 0) + 1
        quality = json.loads(r["quality"] or "[]")
        for col in TEST_NUMERIC:
            v = r[col]
            if v is None:
                continue
            if col == "o2_mole_frac" and "o2_is_oxidizer_stream_not_ambient" in quality:
                key2 = "o2_oxidizer_stream"
            else:
                key2 = col
            rng = p["ranges"].setdefault(key2, [v, v])
            rng[0], rng[1] = min(rng[0], v), max(rng[1], v)
            p["coverage"][key2] = p["coverage"].get(key2, 0) + 1
    for r in conn.execute("SELECT t.accession, m.quantity, COUNT(*) n FROM measurement m JOIN test t "
                          "ON t.test_id = m.test_id GROUP BY t.accession, m.quantity"):
        prof.setdefault(r["accession"], empty_profile())["measured_quantities"].append({"quantity": r["quantity"], "n": r["n"]})
    _PROFILE_CACHE[key] = prof
    return prof


def clear_cache() -> None:
    _PROFILE_CACHE.clear()
    _search_index_cache.cache_clear()


@lru_cache(maxsize=4)
def _search_index_cache(key: int) -> Any:  # placeholder used by search module
    return None
