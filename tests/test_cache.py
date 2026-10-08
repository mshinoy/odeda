"""The analytics cache (`api/cache.py`): kept until the data changes, and warmed."""

from __future__ import annotations

import threading
import time

import pytest

from garmin_analytics.api import cache as cache_mod


@pytest.fixture(autouse=True)
def _fresh_cache():
    cache_mod.clear()
    yield
    cache_mod.clear()


def _write(store, value: str = "x") -> None:
    with store.tx():
        store.conn.execute(
            "INSERT OR REPLACE INTO sync_status (job, state, phase) VALUES (?, ?, ?)",
            ("cache-test", "idle", value),
        )


class Counter:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self) -> int:
        self.calls += 1
        return self.calls


class TestDataVersion:
    def test_a_commit_changes_it_even_before_a_checkpoint(self, settings, store):
        before = cache_mod.data_version(settings)
        _write(store)
        assert cache_mod.data_version(settings) != before

    def test_reading_does_not(self, settings, store):
        before = cache_mod.data_version(settings)
        store.query("SELECT COUNT(*) FROM activities")
        assert cache_mod.data_version(settings) == before

    def test_opening_and_closing_a_connection_does_not(self, settings):
        # The server's normal day: no connection held open, each request opens one,
        # and the last close makes SQLite delete the WAL, the next open recreate it.
        from garmin_analytics.db.store import Store

        with Store.open(settings) as st:
            _write(st)
        before = cache_mod.data_version(settings)
        for _ in range(3):
            with Store.open(settings) as st:
                time.sleep(0.01)
                assert cache_mod.data_version(settings) == before
                st.query("SELECT COUNT(*) FROM activities")
            assert cache_mod.data_version(settings) == before


class TestCached:
    def test_kept_while_nothing_is_written_however_long(self, settings, store, monkeypatch):
        compute = Counter()
        assert cache_mod.cached(settings, "k", compute) == 1
        # No clock is consulted: an hour later it is still the same answer.
        monkeypatch.setattr(time, "time", lambda: 10**10)
        assert cache_mod.cached(settings, "k", compute) == 1
        assert compute.calls == 1

    def test_a_write_recomputes(self, settings, store):
        compute = Counter()
        cache_mod.cached(settings, "k", compute)
        _write(store)
        assert cache_mod.cached(settings, "k", compute) == 2

    def test_keys_are_separate(self, settings, store):
        cache_mod.cached(settings, "a", lambda: "A")
        assert cache_mod.cached(settings, "b", lambda: "B") == "B"
        assert cache_mod.cached(settings, "a", lambda: "not again") == "A"

    def test_an_answer_overtaken_by_a_write_is_not_kept(self, settings, store):
        def compute_while_written() -> str:
            _write(store, "during")
            return "stale"

        assert cache_mod.cached(settings, "k", compute_while_written) == "stale"
        assert cache_mod.cached(settings, "k", lambda: "fresh") == "fresh"


def _wait_for(condition, timeout: float = 3.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return False


class TestCacheWarmer:
    def _warmer(self, settings, busy: threading.Event | None = None):
        calls = Counter()
        warmer = cache_mod.CacheWarmer(
            settings,
            warm=calls,
            is_busy=lambda: busy is not None and busy.is_set(),
            poll_s=0.05,
        )
        return warmer, calls

    def test_warms_at_startup(self, settings, store):
        warmer, calls = self._warmer(settings)
        warmer.start()
        try:
            assert _wait_for(lambda: calls.calls == 1)
        finally:
            warmer.stop()

    def test_warms_again_once_after_a_change_settles(self, settings, store):
        warmer, calls = self._warmer(settings)
        warmer.start()
        try:
            assert _wait_for(lambda: calls.calls == 1)
            for i in range(3):
                _write(store, str(i))
            assert _wait_for(lambda: calls.calls == 2)
            time.sleep(0.3)
            assert calls.calls == 2  # nothing changed since: no more work
        finally:
            warmer.stop()

    def test_waits_while_a_sync_runs(self, settings, store):
        busy = threading.Event()
        busy.set()
        warmer, calls = self._warmer(settings, busy)
        warmer.start()
        try:
            time.sleep(0.3)
            assert calls.calls == 0
            busy.clear()
            assert _wait_for(lambda: calls.calls == 1)
        finally:
            warmer.stop()
