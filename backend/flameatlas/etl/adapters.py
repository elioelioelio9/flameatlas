"""One adapter per PSI experimental table.

Every adapter returns a list of *records* (dicts) matching the ``test`` table, each with a
``measurements`` list. Nothing is invented: a value that is not in the table stays ``None``,
and every interpretation of the raw text is recorded in ``quality`` flags and ``notes``.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from .parsing import (
    all_numbers,
    as_float,
    first_number,
    is_blank_row,
    length_mm,
    norm_header,
    o2_fraction,
    pressure_kpa,
    range_mid,
    read_csv,
    split_list,
)

Record = dict[str, Any]


# --------------------------------------------------------------------------- helpers
def _rows(table: dict) -> tuple[list[str], list[list[str]]]:
    rows = read_csv(table.get("csv", ""))
    if not rows:
        return [], []
    header = [norm_header(h) for h in rows[0]]
    body = []
    for r in rows[1:]:
        if is_blank_row(r):
            continue
        r = r + [""] * (len(header) - len(r))
        body.append(r)
    return header, body


def _raw(header: list[str], row: list[str]) -> dict[str, str]:
    return {h or f"col{i}": row[i] for i, h in enumerate(header) if i < len(row) and row[i] != ""}


def _rec(acc: str, table: dict, idx: int, header: list[str], row: list[str], **fields: Any) -> Record:
    rec: Record = {
        "test_id": f"{acc}:{table['file_name'].rsplit('_', 1)[-1].replace('.csv', '')}:{idx:04d}",
        "accession": acc,
        "record_type": "test",
        "source_file": table["file_name"],
        "source_row": idx + 2,  # 1-based, +1 for header
        "label": None,
        "test_date": None,
        "fuel": None,
        "fuel_phase": None,
        "material_class": None,
        "configuration": None,
        "thickness_mm": None,
        "o2_mole_frac": None,
        "pressure_kpa": None,
        "flow_cm_s": None,
        "flow_direction": None,
        "diluent": None,
        "co2_mole_frac": None,
        "he_mole_frac": None,
        "gravity": "microgravity",
        "outcome": None,
        "outcome_class": None,
        "quality": [],
        "notes": None,
        "raw": _raw(header, row),
        "measurements": [],
    }
    rec.update(fields)
    return rec


def _m(rec: Record, quantity: str, value: Any, unit: str | None, column: str, note: str | None = None) -> None:
    num = as_float(value) if not isinstance(value, (int, float)) else float(value)
    text = None if num is not None else (str(value).strip() or None)
    if num is None and text is None:
        return
    rec["measurements"].append(
        {"quantity": quantity, "value": num, "value_text": text, "unit": unit, "source_column": column, "note": note}
    )


def _col(header: list[str], *needles: str) -> int | None:
    for needle in needles:
        for i, h in enumerate(header):
            if needle.lower() in h.lower():
                return i
    return None


def _get(row: list[str], i: int | None) -> str:
    return row[i] if i is not None and i < len(row) else ""


# --------------------------------------------------------------------------- solid fuels
def _solid_material(text: str) -> tuple[str | None, str | None, float | None, list[str], dict[str, float]]:
    """Material class, configuration, thickness (mm), flags, extra dims from a BASS-style label."""
    t = text.lower()
    flags: list[str] = []
    extra: dict[str, float] = {}
    material = None
    if "pmma" in t and "nomex" in t:
        material = "PMMA + Nomex (composite sample)"
    elif "sibal" in t or "cotton" in t:
        material = "SIBAL (cotton-fiberglass fabric)"
    elif "nomex" in t:
        material = "Nomex"
    elif "candle" in t or "wax" in t:
        material = "Wax (candle)"
    elif "ultem" in t:
        material = "Ultem"
    elif "silicone" in t:
        material = "Silicone"
    elif "pmma" in t or "micron" in t or "rod" in t or "film" in t or "slab" in t or "sphere" in t or "spherical" in t:
        material = "PMMA"
    if not material and t.strip():
        material = text.strip()

    config = None
    if "sphere" in t or "spherical" in t:
        config = "sphere / spherical section"
    elif "rod" in t:
        config = "cylindrical rod"
    elif "film" in t or "micron" in t:
        config = "thin film"
    elif "slab" in t or "thick" in t:
        config = "slab"
    elif material and "SIBAL" in material:
        config = "fabric strip"
    elif material == "Nomex":
        config = "fabric"
    if "1 sided" in t:
        config = (config or "slab") + " (1-sided burning)"
    elif "2 sided" in t:
        config = (config or "slab") + " (2-sided burning)"

    thickness = None
    m = re.search(r"(\d+(?:\.\d+)?)\s*micron", t)
    if m:
        thickness = float(m.group(1)) / 1000.0
    else:
        m = re.search(r"(\d+(?:\.\d+)?)\s*mm(?:\s*thick|\s+pmma|\s+film|\s*$)", t)
        if m:
            thickness = float(m.group(1))
    if config == "cylindrical rod":
        frac = re.search(r"(\d+)\s*/\s*(\d+)\s*\"?", t)
        dec = re.search(r"(\d*\.\d+)\s*\"", t)
        if frac:
            extra["sample_diameter_mm"] = round(float(frac.group(1)) / float(frac.group(2)) * 25.4, 2)
        elif dec:
            extra["sample_diameter_mm"] = round(float(dec.group(1)) * 25.4, 2)
    w = re.search(r"(\d+(?:\.\d+)?)\s*cm(?:\s*wide)?", t)
    if w and "sphere" not in t and "spherical" not in t:
        extra["sample_width_cm"] = float(w.group(1))
    if "sphere" in t or "spherical" in t:
        d = re.search(r"(\d+(?:\.\d+)?)\s*cm", t)
        if d:
            extra["sample_diameter_mm"] = float(d.group(1)) * 10
    if thickness is not None:
        flags.append("parsed_from_text")
    return material, config, thickness, flags, extra


def adapt_bass(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    out = []
    i_mat = _col(header, "Fuel Sample Material")
    for idx, row in enumerate(body):
        label = _get(row, i_mat)
        material, config, thick, flags, extra = _solid_material(label)
        rec = _rec(
            acc, table, idx, header, row,
            label=f"Test {_get(row, _col(header, 'Test #'))}",
            test_date=_get(row, _col(header, "Date")) or None,
            fuel=label or None, fuel_phase="solid", material_class=material, configuration=config,
            thickness_mm=thick, quality=flags,
            notes="BASS table lists sample material only; flow and O2 per test are in the raw data files.",
        )
        for k, v in extra.items():
            _m(rec, k, v, "mm" if k.endswith("_mm") else "cm", "Fuel Sample Material", "parsed from label")
        out.append(rec)
    return out


def adapt_bass2(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    out = []
    c = lambda *n: _col(header, *n)  # noqa: E731
    for idx, row in enumerate(body):
        label = _get(row, c("Fuel Sample Material"))
        material, config, thick, flags, extra = _solid_material(label)
        o2, o2_flags = o2_fraction(_get(row, c("initial O2")))
        air_raw = _get(row, c("Air display"))
        flow = first_number(air_raw)
        q = flags + o2_flags
        if flow is not None:
            q += ["assumed_unit_cm_s", "first_of_flow_sequence"]
        low = air_raw.lower()
        outcome, oclass = None, None
        if "no ign" in low:
            outcome, oclass = air_raw, "no_ignition"
        elif "blowoff" in low:
            outcome, oclass = air_raw, "blowoff"
        elif "ext" in low:
            outcome, oclass = air_raw, "extinction"
        rec = _rec(
            acc, table, idx, header, row,
            label=_get(row, c("Test #")) or None,
            test_date=_get(row, c("Date")) or None,
            fuel=label or None, fuel_phase="solid", material_class=material, configuration=config,
            thickness_mm=thick, o2_mole_frac=o2, flow_cm_s=flow, outcome=outcome, outcome_class=oclass,
            quality=q,
            notes=("'Air display' holds the sequence of flow settings used during the test; the first value is "
                   "stored as flow (unit assumed cm/s, to verify against the BASS-II documentation)."),
        )
        for k, v in extra.items():
            _m(rec, k, v, "mm" if k.endswith("_mm") else "cm", "Fuel Sample Material", "parsed from label")
        _m(rec, "o2_final_pct", _get(row, c("final O2")), "% vol", "Calibrated final O2 % by vol")
        _m(rec, "co2_initial_pct", _get(row, c("Initial CO2")), "% vol", "Initial CO2 % by vol")
        _m(rec, "co2_final_pct", _get(row, c("Final CO2")), "% vol", "Final CO2 % by vol")
        _m(rec, "co_initial_ppm", _get(row, c("Initial CO")), "ppm", "Initial CO (ppm)")
        _m(rec, "co_final_ppm", _get(row, c("Final CO")), "ppm", "Final CO (ppm)")
        _m(rec, "flow_sequence", air_raw, "display units", "Air display")
        _m(rec, "frames_shot", _get(row, c("Total Frames")), "count", "Total Frames Shot")
        out.append(rec)
    return out


def adapt_saffire(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    out = []
    c = lambda *n: _col(header, *n)  # noqa: E731
    for idx, row in enumerate(body):
        sample = _get(row, 0)
        material_txt = _get(row, c("Material"))
        if not re.match(r"^(S\d|\d+-\d+)", sample):
            continue  # notes, pre-test flow visualisation rows
        if not material_txt and out:
            material_txt = out[-1]["fuel"] or ""
            inherited = True
        else:
            inherited = False
        material, config, _, mflags, _ = _solid_material(material_txt)
        thick_txt = _get(row, c("Thickness", "Samle Thickness"))
        thick_col = header[c("Thickness", "Samle Thickness")] if c("Thickness", "Samle Thickness") is not None else ""
        if "see" in thick_txt.lower():
            thick, tflags = None, ["value_refers_to_figure"]
        else:
            thick, tflags = length_mm(thick_txt)
            if thick is not None and "(cm)" in thick_col and "unit_missing" in tflags:
                thick, tflags = thick * 10.0, [f for f in tflags if f != "unit_missing"] + ["unit_from_header"]
            if " and " in thick_txt:
                tflags.append("multiple_values_first_kept")
        thick = round(thick, 3) if thick is not None else None
        o2, o2flags = o2_fraction(_get(row, c("Percent O2")))
        flow = first_number(_get(row, c("Air Flow")))
        direction = (_get(row, c("Flow Direction", "Direction")) or "").strip() or None
        q = tflags + o2flags + (["material_inherited_from_previous_row"] if inherited else [])
        notes = []
        if acc == "PSI-98":
            notes.append("SAFFIRE-I table reports SIBAL thickness as 0.37 cm; SAFFIRE-II lists SIBAL as 0.37 mm. "
                         "Value kept as reported — verify before quantitative use.")
            q.append("unit_inconsistency_across_tables")
        rec = _rec(
            acc, table, idx, header, row,
            label=f"Sample {sample}", fuel=material_txt or None, fuel_phase="solid",
            material_class=material, configuration="large flat sample in flow duct" if acc != "PSI-99" else "flat sample in flow duct",
            thickness_mm=thick, o2_mole_frac=o2, flow_cm_s=flow, flow_direction=direction,
            quality=q, notes=" ".join(notes) or None,
        )
        _m(rec, "sample_length_cm", first_number(_get(row, c("Sample Length", "Length"))), "cm", "Sample Length")
        _m(rec, "sample_width_cm", first_number(_get(row, c("Sample Width", "Width"))), "cm", "Sample Width")
        _m(rec, "ignition_power_w", first_number(_get(row, c("Ignition Power"))), "W", "Ignition Power (W)")
        _m(rec, "ignition_time_s", first_number(_get(row, c("Ignition Time"))), "s", "Ignition Time (s)")
        bt = _get(row, c("Burn Time"))
        _m(rec, "burn_time_s", first_number(bt) if first_number(bt) is not None else bt, "s", "Burn Time (s)")
        i_ugb = c("g Burn Length")
        if i_ugb is not None:  # SAFFIRE-II: micro-g vs 1-g comparison
            ug_len = _get(row, i_ugb)
            g1_len = _get(row, c("1-g Burn Length"))
            _m(rec, "ug_burn_length", ug_len, "cm", header[i_ugb], "µg burn length (as reported)")
            _m(rec, "ug_spread_rate", _get(row, c("g Spread Length")), "mm/s", "µg spread (as reported)")
            _m(rec, "1g_burn_length", g1_len, "cm", "1-g Burn Length", "normal-gravity reference test")
            _m(rec, "1g_spread_rate", _get(row, c("1-g Spread Rate")), "mm/s", "1-g Spread Rate")
            ug_num = first_number(ug_len)
            if ug_num is not None and ug_num < 1:
                rec["outcome"], rec["outcome_class"] = f"µg burn length {ug_len}", "no_sustained_spread"
            elif ug_num is not None:
                rec["outcome"], rec["outcome_class"] = f"µg burn length {ug_len}", "flame_spread"
        out.append(rec)
    return out


# --------------------------------------------------------------------------- smoke / detection
def adapt_same_r(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    for idx, row in enumerate(body):
        mat = _get(row, c("Sample Type"))
        rec = _rec(
            acc, table, idx, header, row, label=f"SAME-R test {_get(row, c('SAME Test'))}",
            test_date=_get(row, c("Date")) or None, fuel=mat or None, fuel_phase="solid",
            material_class=mat or None, configuration="heated wire/sample smoke source (pyrolysis)",
            flow_cm_s=first_number(_get(row, c("Inlet velocity"))), outcome=_get(row, c("Description")) or None,
        )
        _m(rec, "heater_resistance_ratio", _get(row, c("Rt/R0")), "-", "Rt/R0", "proxy for heater temperature")
        _m(rec, "duration_s", _get(row, c("Duration")), "s", "Duration (sec)")
        _m(rec, "primary_aging_time_s", _get(row, c("Primary aging")), "s", "Primary aging time (sec)")
        _m(rec, "primary_mixing_time_s", _get(row, c("Primary mixing")), "s", "Primary mixing time (sec)")
        _m(rec, "net_aging_time_s", _get(row, c("Net aging")), "s", "Net aging time (sec)")
        out.append(rec)
    return out


def adapt_same(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    for idx, row in enumerate(body):
        mat = _get(row, c("Sample Material"))
        matrix = "same conditions" in mat.lower()
        name = mat.split(":")[0].strip()
        rec = _rec(
            acc, table, idx, header, row, label=f"SAME sample {_get(row, 0)}", fuel=name or None,
            fuel_phase="solid", material_class=name or None, configuration="heated sample smoke source (pyrolysis)",
            record_type="test_matrix" if matrix else "test",
            flow_cm_s=first_number(_get(row, c("Air Flow"))),
            notes="Row states 'same conditions as samples 1-4' (Teflon matrix)." if matrix else None,
        )
        _m(rec, "weight_loss_rate", _get(row, c("Weight loss")), "mg/min", "Weight loss rate (mg/min)")
        _m(rec, "aging_duration_min", _get(row, c("Aging Duration")), "min", "Aging Duration (minutes)")
        out.append(rec)
    return out


def adapt_daft(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    return [
        _rec(acc, table, idx, header, row, record_type="session", label=_get(row, c("Session")) or None,
             test_date=_get(row, c("Actual Day")) or None, fuel="Arizona Road Dust (ARD Fine) aerosol",
             fuel_phase="aerosol", material_class="test dust", configuration=_get(row, c("Hardware")) or None,
             notes=_get(row, c("Sampled Location")) or None)
        for idx, row in enumerate(body)
    ]


# --------------------------------------------------------------------------- droplets / liquids
def adapt_flex(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    i_o2, i_n2 = c("O initial"), c("N initial")
    i_co2, i_he = c("CO initial"), c("He initial")
    out = []
    for idx, row in enumerate(body):
        p_raw = _get(row, c("Ambient pressure"))
        p = pressure_kpa(p_raw, "mmhg")
        q = []
        if p is not None and p <= 0:
            p, q = None, ["zero_pressure_dropped"]
        co2 = as_float(_get(row, i_co2))
        he = as_float(_get(row, i_he))
        dil = []
        if co2:
            dil.append("CO2")
        if he:
            dil.append("He")
        end = _get(row, c("Test end"))
        rec = _rec(
            acc, table, idx, header, row, label=_get(row, c("FLEX Identifier")) or None,
            test_date=_get(row, c("Test Date")) or None, fuel=_get(row, c("Fuel")) or None, fuel_phase="liquid",
            material_class=_get(row, c("Fuel")) or None, configuration="free-floating / tethered droplet",
            o2_mole_frac=as_float(_get(row, i_o2)), pressure_kpa=p, flow_cm_s=None,
            diluent="+".join(dil) if dil else "N2 only", co2_mole_frac=co2, he_mole_frac=he,
            outcome=end or None, outcome_class=end.lower() or None, quality=q,
            notes="Gas columns in the PSI header read 'O', 'N', 'CO', 'He' (subscripts lost): interpreted as O2, N2, CO2, He.",
        )
        _m(rec, "n2_mole_frac", _get(row, i_n2), "mole fraction", header[i_n2] if i_n2 is not None else "N")
        _m(rec, "droplet_initial_diameter", _get(row, c("Droplet initial")), "mm", "Droplet initial diameter; mm")
        _m(rec, "flame_extinction_diameter", _get(row, c("extinction diameter")), "mm",
           "Visible flame extinction diameter; mm")
        _m(rec, "burning_rate_constant", _get(row, c("Burning rate")), "mm²/s", "Burning rate; mm",
           "PSI header gives 'mm'; magnitudes match a d²-law burning-rate constant K (mm²/s) — verify")
        _m(rec, "burn_time_s", _get(row, c("Burn time")), "s", "Burn time; s")
        out.append(rec)
    return out


def adapt_flex2(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    for idx, row in enumerate(body):
        fuel = _get(row, 0)
        rec = _rec(
            acc, table, idx, header, row, record_type="test_matrix", label=f"FLEX-2 matrix: {fuel}", fuel=fuel,
            fuel_phase="liquid", material_class=fuel, configuration="droplet (pure or bi-component)",
            diluent=_get(row, c("Ambient Gas")) or None,
            notes="Test-matrix row: lists the ranges explored for this fuel, not individual runs.",
        )
        _m(rec, "o2_levels", _get(row, c("Oxygen Mole")), "mole fraction", "Oxygen Mole Fraction")
        _m(rec, "pressure_levels", _get(row, c("Ambient Pressure")), "atm", "Ambient Pressure (atm)")
        _m(rec, "flow_velocity_range", _get(row, c("Flow Velocity")), "cm/s", "Flow Velocity (cm/s)")
        _m(rec, "droplet_diameter_range", _get(row, c("Initial Droplet")), "mm", "Initial Droplet Diameter (mm)")
        out.append(rec)
    return out


def adapt_cfi(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    for idx, row in enumerate(body):
        he = as_float(_get(row, c("Helium")))
        fuel = _get(row, c("Fuel"))
        rec = _rec(
            acc, table, idx, header, row, label=f"Test {_get(row, 0)}", test_date=_get(row, c("Test Date")) or None,
            fuel=fuel or None, fuel_phase="liquid", material_class="n-dodecane / iso-dodecane",
            configuration="droplet" + (" on fiber" if _get(row, c("Fiber")).lower() == "yes" else " (free)"),
            o2_mole_frac=as_float(_get(row, c("Oxygen"))), pressure_kpa=pressure_kpa(_get(row, c("Pressure")), "atm"),
            he_mole_frac=he, diluent="He+N2" if he else "N2 only",
        )
        _m(rec, "n2_mole_frac", _get(row, c("Nitrogen")), "mole fraction", "Nitrogen")
        out.append(rec)
    return out


# --------------------------------------------------------------------------- gaseous flames (ACME, SPICE...)
def _spherical(acc: str, table: dict, inverse: bool, kind: str) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    last_fuel = None
    for idx, row in enumerate(body):
        fuel = _get(row, c("Fuel")) or last_fuel
        if kind == "flame_design" and inverse:
            fuel = "C2H4 (ethylene)"
        last_fuel = fuel
        if inverse:
            o2 = as_float(_get(row, c("XO2")))
            o2 = round(o2, 4) if o2 is not None else None
            p = pressure_kpa(_get(row, c("pmean", "approx p")), "atm" if kind == "flame_design" else "bar")
        else:
            o2 = as_float(_get(row, c("XO2 (init)", "XO2 before")))
            o2 = round(o2, 4) if o2 is not None else None
            p = pressure_kpa(_get(row, c("pmean", "approx p")), "atm" if kind == "flame_design" else "bar")
        q = ["o2_is_oxidizer_stream_not_ambient"] if inverse else []
        hot = _get(row, c("Hot ignition"))
        term = _get(row, c("Self-ext", "Self -ext"))
        outcome, oclass = None, None
        if hot:
            hl = hot.lower()
            if hl == "no":
                oclass = "no_ignition"
            elif hl == "flash":
                oclass = "flash_only"
            elif term.upper() == "SE":
                oclass = "self_extinguished"
            elif term.upper() == "FT":
                oclass = "burned_until_flow_terminated"
            else:
                oclass = "ignited"
            outcome = f"hot ignition: {hot}" + (f"; end: {term}" if term and term != "-" else "")
        rec = _rec(
            acc, table, idx, header, row, label=_get(row, c("Test")) or None, fuel=fuel, fuel_phase="gas",
            material_class=fuel,
            configuration=("inverse" if inverse else "normal") + " spherical diffusion flame (porous burner)",
            o2_mole_frac=o2, pressure_kpa=p, outcome=outcome, outcome_class=oclass, quality=q,
            notes=("Inverse flame: oxidizer flows from the burner into a fuel/N2 ambient — XO2 is the oxidizer-stream "
                   "O2, not a cabin-like ambient atmosphere.") if inverse else None,
        )
        _m(rec, "adiabatic_flame_temperature", _get(row, c("Tad")), "K", "Tad (K)")
        _m(rec, "stoichiometric_mixture_fraction", _get(row, c("Zst", "mean Zst")), "-", "Zst")
        _m(rec, "burn_time_s", _get(row, c("burn time")), "s", "burn time (sec)")
        _m(rec, "cool_flame", _get(row, c("Cool flame?")), None, "Cool flame?")
        _m(rec, "fuel_flow_mg_s", _get(row, c("mHC", "HC burnrate", "mfuel")), "mg/s", "fuel flow")
        _m(rec, "o2_flow_mg_s", _get(row, c("O2 flow rate", "mO2")), "mg/s", "O2 flow")
        _m(rec, "peak_burner_temperature_c", _get(row, c("Peak burner T (C", "Peak burner Temp (C")), "°C", "Peak burner T")
        _m(rec, "flame_color", _get(row, c("Color")), None, "Color")
        _m(rec, "comment", _get(row, c("Comments")), None, "Comments")
        out.append(rec)
    return out


def adapt_cfig_normal(acc, table):
    return _spherical(acc, table, inverse=False, kind="cfig")


def adapt_cfig_inverse(acc, table):
    return _spherical(acc, table, inverse=True, kind="cfig")


def adapt_fd_normal(acc, table):
    return _spherical(acc, table, inverse=False, kind="flame_design")


def adapt_fd_inverse(acc, table):
    return _spherical(acc, table, inverse=True, kind="flame_design")


def adapt_spice(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    for idx, row in enumerate(body):
        fuel = _get(row, c("Fuel"))
        flow = first_number(_get(row, c("Air Rate")))
        rec = _rec(
            acc, table, idx, header, row, label=f"GMT day {_get(row, 0)} {_get(row, c('GMT ignition'))}",
            fuel=fuel or None, fuel_phase="gas", material_class=fuel or None,
            configuration="co-flow laminar jet diffusion flame", flow_cm_s=flow if flow is None or flow >= 0 else None,
            quality=["negative_value_dropped"] if flow is not None and flow < 0 else [],
            notes="Air rate is the co-flow air velocity. Ambient O2 and pressure are not given in this table.",
        )
        _m(rec, "nozzle_diameter", _get(row, c("Nozzle")), "mm", "Nozzle (mm)")
        _m(rec, "fuel_flow_sccm", _get(row, c("Fuel Rate (sccm)")), "sccm", "Fuel Rate (sccm)")
        _m(rec, "fuel_flow_mg_s", _get(row, c("Fuel Rate (mg/s)")), "mg/s", "Fuel Rate (mg/s)")
        out.append(rec)
    return out


def adapt_bre(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    n = 0
    for idx, row in enumerate(body):
        o2_txt = _get(row, c("Oxygen Conc"))
        levels = split_list(o2_txt) or [o2_txt]
        date = f"{_get(row, c('Year'))}-{_get(row, c('Month'))}-{_get(row, c('Date'))}"
        for lvl in levels:
            o2, flags = o2_fraction(lvl)
            rec = _rec(
                acc, table, idx, header, row, record_type="session", label=f"BRE session {date}", test_date=date,
                fuel=_get(row, c("Fuel Bottle")) or None, fuel_phase="gas",
                material_class="gaseous fuel emulating a burning solid",
                configuration=f"porous burner {_get(row, c('Burner Size'))} mm, quiescent (no forced flow)",
                o2_mole_frac=o2, flow_cm_s=0.0, quality=flags + ["pressure_not_in_table"],
                notes="One record per O2 level listed for the day. Chamber pressure varied but is not given per test.",
            )
            rec["test_id"] = f"{acc}:BRE:{n:04d}"
            n += 1
            _m(rec, "flames_ignited_that_day", _get(row, c("Flames Ignited")), "count", "Flames Ignited",
               "count for the whole day (all O2 levels)")
            _m(rec, "burner_diameter", _get(row, c("Burner Size")), "mm", "Burner Size (mm)")
            out.append(rec)
    return out


def adapt_acme_sessions(acc: str, table: dict) -> list[Record]:
    """CLD Flame, E-FIELD, s-Flame, SLICE: one record per test day."""
    header, body = _rows(table)
    c = lambda *n: _col(header, *n)  # noqa: E731
    out = []
    for idx, row in enumerate(body):
        fuel = _get(row, c("Fuel Bottle", "Fuel Type"))
        if not fuel and not _get(row, c("Test Day", "Test Date")):
            continue
        atm = _get(row, c("Atmosphere"))
        o2, flags = o2_fraction(re.search(r"(\d+(?:\.\d+)?)\s*%\s*O2", atm).group(1)) if re.search(
            r"(\d+(?:\.\d+)?)\s*%\s*O2", atm) else (None, [])
        rec = _rec(
            acc, table, idx, header, row, record_type="session",
            label=_get(row, c("Test Type")) or f"session {idx + 1}",
            test_date=_get(row, c("Test Day", "Test Date")) or None, fuel=fuel or None, fuel_phase="gas",
            material_class=fuel or None,
            configuration={"PSI-21": "coflow laminar diffusion flame", "PSI-22": "coflow flame with electric field",
                           "PSI-23": "spherical diffusion flame", "PSI-106": "lifted jet flame (MSG flow duct)"}.get(acc),
            o2_mole_frac=o2, quality=flags,
        )
        _m(rec, "flames_ignited", _get(row, c("Flames ignited", "Flames Ignited")), "count", "Flames ignited")
        _m(rec, "fuel_concentration", _get(row, c("Fuel conc", "Fuel Conc")), None, "Fuel concentration")
        _m(rec, "mesh_polarity", _get(row, c("Mesh Polarity")), None, "Mesh Polarity")
        out.append(rec)
    return out


def adapt_data_reference(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    return [
        _rec(acc, table, idx, header, row, record_type="data_reference", label=_get(row, 1) or None,
             notes=f"Published dataset: {_get(row, 2)} (figure {_get(row, 3)})")
        for idx, row in enumerate(body)
    ]


def adapt_generic(acc: str, table: dict) -> list[Record]:
    header, body = _rows(table)
    return [_rec(acc, table, idx, header, row, label=_get(row, 0) or None, gravity="mixed") for idx, row in enumerate(body)]


# --------------------------------------------------------------------------- dispatch
def pick_adapter(acc: str, file_name: str) -> Callable[[str, dict], list[Record]]:
    f = file_name.lower()
    if acc == "PSI-26":
        return adapt_bass
    if acc == "PSI-25":
        return adapt_bass2
    if acc in ("PSI-98", "PSI-99", "PSI-100"):
        return adapt_saffire
    if acc == "PSI-101":
        return adapt_same_r
    if acc == "PSI-102":
        return adapt_same
    if acc == "PSI-47":
        return adapt_daft
    if acc == "PSI-69":
        return adapt_flex
    if acc == "PSI-68":
        return adapt_flex2
    if acc == "PSI-39":
        return adapt_cfi
    if acc == "PSI-159":
        return adapt_cfig_inverse if "inverse" in f else adapt_cfig_normal
    if acc == "PSI-10":
        return adapt_fd_inverse if "inverse" in f else adapt_fd_normal
    if acc == "PSI-107":
        return adapt_spice
    if acc == "PSI-20":
        return adapt_bre
    if acc in ("PSI-21", "PSI-22", "PSI-23", "PSI-106"):
        return adapt_acme_sessions
    if acc == "PSI-142":
        return adapt_data_reference
    return adapt_generic


def adapt_investigation(inv: dict) -> list[Record]:
    records: list[Record] = []
    ids: set[str] = set()
    seen: set[str] = set()
    for table in inv.get("experimentalTables", []):
        if not table.get("csv"):
            continue
        # PSI-108 ships the same table twice ('STDCE-1.csv' and 'STDCE-1(1).csv'): keep one.
        key = re.sub(r"\(\d+\)", "", table["file_name"])
        if key in seen:
            continue
        seen.add(key)
        adapter = pick_adapter(inv["accession"], table["file_name"])
        for rec in adapter(inv["accession"], table):
            if rec["test_id"] in ids:
                rec["test_id"] += f"-{len(records)}"
            ids.add(rec["test_id"])
            records.append(rec)
    return records


__all__ = ["adapt_investigation", "pick_adapter", "all_numbers", "range_mid"]
