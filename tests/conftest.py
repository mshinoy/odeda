"""Shared fixtures.

Every test gets its own database in a temp directory. Nothing here ever touches the
real data directory or the Garmin token cache — the environment is redirected before
`garmin_analytics.config` is read.
"""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # so `import fitgen` works


@pytest.fixture
def settings(tmp_path, monkeypatch):
    from garmin_analytics.config import load_settings

    monkeypatch.setenv("GA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GA_DB", str(tmp_path / "data" / "test.db"))
    monkeypatch.setenv("GA_RAW_DIR", str(tmp_path / "data" / "raw"))
    monkeypatch.setenv("GA_TOKEN_DIR", str(tmp_path / "tokens"))
    monkeypatch.setenv("GA_HR_REST", "50")
    monkeypatch.setenv("GA_HR_MAX", "190")
    monkeypatch.setenv("GA_SEX", "male")
    return load_settings()


@pytest.fixture
def store(settings):
    from garmin_analytics.db.store import Store

    st = Store.open(settings)
    yield st
    st.close()


@pytest.fixture(scope="session")
def seeded_db(tmp_path_factory):
    """One small seeded database, built once and shared by the read-only tests.

    Three months rather than eighteen: the analytics under test do not care how long
    the series is, and a session-scoped 3-month seed keeps the suite under a second.
    """
    from garmin_analytics.config import load_settings
    from garmin_analytics.db.store import Store
    from garmin_analytics.seed.synthetic import seed_database

    tmp = tmp_path_factory.mktemp("seeded")
    import os

    old = {k: os.environ.get(k) for k in ("GA_DATA_DIR", "GA_DB", "GA_TOKEN_DIR")}
    os.environ["GA_DATA_DIR"] = str(tmp)
    os.environ["GA_DB"] = str(tmp / "seeded.db")
    os.environ["GA_TOKEN_DIR"] = str(tmp / "tokens")
    try:
        settings = load_settings()
        st = Store.open(settings)
        seed_database(st, end=date(2026, 9, 22), months=3, reset=True)
        st.close()
        yield settings
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


@pytest.fixture
def seeded_store(seeded_db):
    from garmin_analytics.db.store import Store

    st = Store.open(seeded_db)
    yield st
    st.close()
