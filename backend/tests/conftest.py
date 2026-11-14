from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from flameatlas.config import RAW_CORPUS  # noqa: E402
from flameatlas.db import connect  # noqa: E402
from flameatlas.etl.build import build  # noqa: E402
from flameatlas.services.repository import Repository, clear_cache  # noqa: E402


@pytest.fixture(scope="session")
def db_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("db") / "test.db"
    build(path, RAW_CORPUS, write_processed=False)
    return path


@pytest.fixture(scope="session")
def repo(db_path):
    clear_cache()
    return Repository(connect(db_path))
