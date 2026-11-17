"""Shared fixtures.

Every test gets its own database in a temp directory. Nothing here ever touches the
real data directory or the Garmin token cache — the environment is redirected before
`odeda.config` is read.
"""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent))  # so `import fitgen` works

# No test app ever starts the automatic sync. The tests that exercise the scheduler
# build their own with the interval they want.
os.environ["GA_AUTO_SYNC_HOURS"] = "0"
# Nor warms the cache in the background; `test_cache.py` drives a warmer directly.
os.environ["GA_CACHE_WARM"] = "0"


@pytest.fixture
def settings(tmp_path, monkeypatch):
    from odeda.config import load_settings

    monkeypatch.setenv("GA_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GA_DB", str(tmp_path / "data" / "test.db"))
    monkeypatch.setenv("GA_RAW_DIR", str(tmp_path / "data" / "raw"))
    monkeypatch.setenv("GA_TOKEN_DIR", str(tmp_path / "tokens"))
    monkeypatch.setenv("GA_HR_REST", "50")
    monkeypatch.setenv("GA_HR_MAX", "190")
    monkeypatch.setenv("GA_SEX", "male")
    return load_settings()


@pytest.fixture
def fake_ui(tmp_path):
    """A stand-in for the React build (`npm run build` in frontend/), so tests never
    depend on whether the real one has been built on this machine."""
    ui = tmp_path / "ui"
    (ui / "assets").mkdir(parents=True)
    (ui / "index.html").write_text(
        '<!doctype html><html><head><title>Odeda</title></head>'
        '<body><div id="root" data-spa-index></div></body></html>'
    )
    (ui / "assets" / "index-abc123.js").write_text("console.log('spa');")
    (ui / "favicon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>')
    return ui


@pytest.fixture
def store(settings):
    from odeda.db.store import Store

    st = Store.open(settings)
    yield st
    st.close()


@pytest.fixture(scope="session")
def seeded_db(tmp_path_factory):
    """One small seeded database, built once and shared by the read-only tests.

    Three months rather than eighteen: the analytics under test do not care how long
    the series is, and a session-scoped 3-month seed keeps the suite under a second.
    """
    from odeda.config import load_settings
    from odeda.db.store import Store
    from odeda.seed.synthetic import seed_database

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
    from odeda.db.store import Store

    st = Store.open(seeded_db)
    yield st
    st.close()


def add_calendar_race(store, day="2027-01-15", start="07:35", distance_m=21097.5,
                      title="RACE: Ooredoo Doha Half Marathon"):
    """Put a race in the plan, which is where the race lives (T57).

    A helper rather than a fixture: most tests that need one also need a particular
    store, and the four `config.RACE_*` constants they used to lean on are gone.
    """
    store.conn.execute(
        "INSERT INTO plan_sources (kind, url, label, enabled) "
        "VALUES ('ics', 'https://example.test/race.ics', 'Test', 1)"
    )
    source_id = store.conn.execute(
        "SELECT id FROM plan_sources ORDER BY id DESC LIMIT 1"
    ).fetchone()[0]
    store.conn.execute(
        "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, start_local, "
        "sport, kind, planned_min_m, planned_max_m, title, parse_status) "
        "VALUES (?, 'race-uid', '', ?, ?, 'running', 'race', ?, ?, ?, 'ok')",
        (source_id, day, f"{day}T{start}:00", distance_m, distance_m, title),
    )
    store.conn.commit()
