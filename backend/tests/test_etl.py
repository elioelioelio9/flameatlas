import json


def test_counts(repo):
    m = repo.meta()
    assert int(m["n_investigations"]) == 26
    assert int(m["n_tests"]) > 2000
    assert int(m["n_measurements"]) > 7000


def test_missing_values_are_null_not_zero(repo):
    # SPICE does not report ambient O2: it must be NULL, never 0
    n_zero = repo.conn.execute("SELECT COUNT(*) FROM test WHERE accession='PSI-107' AND o2_mole_frac = 0").fetchone()[0]
    n_null = repo.conn.execute("SELECT COUNT(*) FROM test WHERE accession='PSI-107' AND o2_mole_frac IS NULL").fetchone()[0]
    assert n_zero == 0 and n_null > 400


def test_flex_units(repo):
    row = repo.conn.execute("SELECT * FROM test WHERE test_id = 'PSI-69:FLEX:0000'").fetchone()
    assert row["fuel"] == "Methanol"
    assert abs(row["pressure_kpa"] - 757.7 * 0.133322368) < 0.01
    assert row["o2_mole_frac"] == 0.21
    assert row["source_row"] == 2


def test_inverse_flames_are_flagged(repo):
    rows = repo.conn.execute("SELECT quality FROM test WHERE accession='PSI-159' AND configuration LIKE 'inverse%'").fetchall()
    assert rows and all("o2_is_oxidizer_stream_not_ambient" in json.loads(r["quality"]) for r in rows)


def test_out_of_scope_kept_but_flagged(repo):
    inv = repo.investigation("PSI-181")
    assert inv["in_scope"] is False and "Materials science" in inv["scope_note"]


def test_every_test_traceable(repo):
    bad = repo.conn.execute("SELECT COUNT(*) FROM test WHERE source_file IS NULL OR source_row IS NULL").fetchone()[0]
    assert bad == 0


def test_computed_insights_present(repo):
    ids = {i["id"] for i in repo.insights()}
    assert {"flex-o2-burnout", "saffire2-ug-vs-1g", "bass2-reduced-o2", "bre-elevated-o2-no-flow"} <= ids
