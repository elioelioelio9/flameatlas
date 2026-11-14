"""Small, well-tested parsing helpers for messy PSI experimental tables."""

from __future__ import annotations

import csv
import io
import re
from typing import Any

NUM_RE = re.compile(r"[-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?")

MMHG_TO_KPA = 0.133322368
ATM_TO_KPA = 101.325
BAR_TO_KPA = 100.0
PSI_TO_KPA = 6.894757


def read_csv(text: str) -> list[list[str]]:
    rows = list(csv.reader(io.StringIO(text)))
    return [[c.strip() for c in r] for r in rows]


def is_blank_row(row: list[str]) -> bool:
    return not any(c.strip() for c in row)


def first_number(value: Any) -> float | None:
    """First numeric value in a string ('~ 21.5' -> 21.5, '20 cm/s' -> 20). None if absent."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    m = NUM_RE.search(str(value))
    return float(m.group()) if m else None


def all_numbers(value: Any) -> list[float]:
    if value is None:
        return []
    return [float(x) for x in NUM_RE.findall(str(value))]


def range_mid(value: Any) -> tuple[float | None, bool]:
    """'21.5 - 21.7' -> (21.6, True); '22.1 to 22.0' -> (22.1, True: first value kept as initial).

    Returns (value, was_range).
    """
    if value is None:
        return None, False
    s = str(value)
    nums = all_numbers(s)
    if not nums:
        return None, False
    if " to " in s and len(nums) >= 2:
        return nums[0], True  # 'initial to final': keep the initial value
    if re.search(r"\d\s*-\s*\d", s) and len(nums) >= 2:
        return (nums[0] + nums[1]) / 2.0, True
    return nums[0], False


def length_mm(value: Any) -> tuple[float | None, list[str]]:
    """Parse a length with unit to millimetres. Handles 'micron', 'mm', 'cm', inches (")."""
    flags: list[str] = []
    if value is None or str(value).strip() == "":
        return None, flags
    s = str(value).strip().lower()
    num = first_number(s)
    if num is None:
        return None, flags
    if re.match(r"^0\d", s) and "." not in s.split()[0]:
        # PSI typo such as '037 mm' (meaning 0.37 mm)
        num = float("0." + s.split()[0].lstrip("0"))
        flags.append("typo_corrected_leading_zero")
    if "micron" in s or "µm" in s or "um " in s:
        return round(num / 1000.0, 4), flags
    if "mm" in s:
        return round(num, 4), flags
    if "cm" in s:
        return round(num * 10.0, 4), flags
    if '"' in s or "inch" in s:
        frac = re.search(r"(\d+)\s*/\s*(\d+)", s)
        inches = float(frac.group(1)) / float(frac.group(2)) if frac else num
        return round(inches * 25.4, 4), flags
    flags.append("unit_missing")
    return num, flags


def pressure_kpa(value: Any, default_unit: str) -> float | None:
    """Convert a pressure to kPa. default_unit in {'mmhg','atm','bar','psi','kpa'}."""
    s = str(value or "").strip().lower()
    num = first_number(s)
    if num is None:
        return None
    unit = default_unit
    for u in ("mmhg", "atm", "bar", "psi", "kpa"):
        if u in s:
            unit = u
            break
    factor = {"mmhg": MMHG_TO_KPA, "atm": ATM_TO_KPA, "bar": BAR_TO_KPA, "psi": PSI_TO_KPA, "kpa": 1.0}[unit]
    return round(num * factor, 3)


def o2_fraction(value: Any) -> tuple[float | None, list[str]]:
    """O2 as mole fraction from '21.5', '0.21', '~ 22.1', '3400%' (PSI typo for 34 %)."""
    flags: list[str] = []
    if value is None or str(value).strip() == "":
        return None, flags
    s = str(value)
    v, was_range = range_mid(s)
    if v is None:
        return None, flags
    if was_range:
        flags.append("range_collapsed")
    if "~" in s:
        flags.append("approximate")
    if "%" in s and v > 100:
        v = v / 100.0  # '3400%' -> 34
        flags.append("typo_corrected_percent")
    if v > 1.0:
        v = v / 100.0
    if not (0.0 < v <= 1.0):
        return None, flags + ["out_of_range_dropped"]
    return round(v, 5), flags


def split_list(value: str) -> list[str]:
    return [p.strip() for p in re.split(r"[;]", value or "") if p.strip()]


def as_float(value: Any) -> float | None:
    if value is None:
        return None
    s = str(value).strip()
    if s == "" or s.lower() in {"n/a", "na", "none", "-", "?", "ramped"}:
        return None
    try:
        return float(s)
    except ValueError:
        return first_number(s) if NUM_RE.fullmatch(s.replace(" ", "")) else None


def norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", h.replace("﻿", "")).strip()
