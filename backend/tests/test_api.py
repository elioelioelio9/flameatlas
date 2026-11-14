"""HTTP-level tests (skipped automatically if FastAPI is not installed)."""

import os

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="module")
def client(db_path):
    os.environ["FLAMEATLAS_DB"] = str(db_path)
    import importlib

    from flameatlas import config

    importlib.reload(config)
    from flameatlas.api import main

    importlib.reload(main)
    with TestClient(main.app) as c:
        yield c


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_rank_endpoint(client):
    r = client.post("/api/rank", json={"need": "detection"}).json()
    assert r["results"][0]["accession"] == "PSI-101"


def test_investigation_detail(client):
    r = client.get("/api/investigations/PSI-69").json()
    assert r["doi"] == "10.60555/mbq8-0451" and r["profile"]["n_tests"] == 274


def test_export_endpoint(client):
    r = client.post("/api/extract/export", json={"accessions": ["PSI-99"]})
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"


def test_ask_endpoint(client):
    r = client.post("/api/ask", json={"question": "smoke particle size in microgravity"}).json()
    assert r["sources"]
