from flameatlas.etl.parsing import first_number, length_mm, o2_fraction, pressure_kpa, range_mid


def test_o2_fraction_variants():
    assert o2_fraction("21.5 - 21.7")[0] == 0.216
    assert o2_fraction("~ 22.1")[0] == 0.221
    assert o2_fraction("0.21")[0] == 0.21
    v, flags = o2_fraction("3400%")  # PSI typo for 34 %
    assert v == 0.34 and "typo_corrected_percent" in flags
    assert o2_fraction("")[0] is None


def test_lengths_to_mm():
    assert length_mm("100 micron")[0] == 0.1
    assert length_mm("0.27 mm")[0] == 0.27
    assert length_mm(".33 cm")[0] == 3.3
    v, flags = length_mm("037 mm")  # PSI typo for 0.37 mm
    assert v == 0.37 and "typo_corrected_leading_zero" in flags
    assert round(length_mm('1/4" clear rod')[0], 2) == 6.35


def test_pressure_conversions():
    assert pressure_kpa("760", "mmhg") == 101.325
    assert pressure_kpa("1 atm", "atm") == 101.325
    assert pressure_kpa("1.0", "bar") == 100.0
    assert round(pressure_kpa("8.2 psi", "kpa"), 1) == 56.5


def test_ranges_and_numbers():
    assert range_mid("22.1 to 22.0") == (22.1, True)
    assert first_number("20 cm/s") == 20.0
    assert first_number("n/a") is None
