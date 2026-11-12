"""T30: the app syncs Garmin and Google Health on its own, every few hours."""

from __future__ import annotations

import json
import threading
from dataclasses import replace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.analytics import performance as perf_mod
from garmin_analytics.analytics import routes as routes_mod
from garmin_analytics.api.server import create_app
from garmin_analytics.ingest import auto_sync as A
from garmin_analytics.ingest import connect as connect_mod
from garmin_analytics.ingest import details as details_mod
from garmin_analytics.ingest import fitbit as fitbit_mod
from garmin_analytics.ingest import fitbit_sync as fitbit_sync_mod

HOUR = 3600.0


def _garmin_connected(settings) -> None:
    settings.token_dir.mkdir(parents=True, exist_ok=True)
    connect_mod.token_file(settings.token_dir).write_text("{}")


def _fitbit_connected(settings) -> None:
    settings.token_dir.mkdir(parents=True, exist_ok=True)
    fitbit_mod.token_file(settings.token_dir).write_text("{}")


def _activity(store, aid: str, day: str = "2026-10-07") -> None:
    store.upsert("activities", ["activity_id"],
                 {"activity_id": aid, "day": day, "start_time_local": f"{day} 07:00:00",
                  "activity_type": "running"})


@pytest.fixture
def derive_calls(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(perf_mod, "rebuild_best_efforts",
                        lambda st: calls.append("best_efforts") or 0)
    monkeypatch.setattr(routes_mod, "cluster_all",
                        lambda st, **kw: calls.append("routes") or {})
    return calls


# ---------------------------------------------------------------------------
# Garmin
# ---------------------------------------------------------------------------


class TestGarmin:
    def test_skipped_when_not_connected(self, store, settings):
        assert A.sync_garmin(store, settings)["state"] == "skipped"

    def test_an_expired_session_is_an_error_not_a_crash(self, store, settings):
        _garmin_connected(settings)

        def expired(_token_dir):
            raise connect_mod.NotAuthenticated("The saved Garmin session is no longer good.")

        out = A.sync_garmin(store, settings, resume=expired)
        assert out == {"state": "error",
                       "message": "The saved Garmin session is no longer good."}

    def test_new_activity_gets_its_stream_and_derive_runs(
        self, store, settings, monkeypatch, derive_calls
    ):
        _garmin_connected(settings)
        monkeypatch.setattr(connect_mod, "sync",
                            lambda st, s, **kw: _activity(st, "a1"))
        fetched: list[str] = []
        monkeypatch.setattr(
            details_mod, "sync_activity_details",
            lambda st, aid, fetcher: fetched.append(aid) or {"gps": True, "samples": 9},
        )

        out = A.sync_garmin(store, settings, fetcher=lambda p: None,
                            resume=lambda d: "runner")

        assert fetched == ["a1"]
        assert derive_calls == ["best_efforts", "routes"]
        assert out["state"] == "done"
        assert out["new_activities"] == 1 and out["streams"] == 1
        assert out["message"] == "1 new activity, 1 stream."

    def test_a_run_that_finds_nothing_derives_nothing(
        self, store, settings, monkeypatch, derive_calls
    ):
        """Clustering is half a minute on the real data; a quiet run must not pay it."""
        _garmin_connected(settings)
        monkeypatch.setattr(connect_mod, "sync", lambda st, s, **kw: None)

        out = A.sync_garmin(store, settings, fetcher=lambda p: None,
                            resume=lambda d: "runner")

        assert derive_calls == []
        assert out["message"] == "0 new activities."

    def test_streams_without_gps_skip_route_clustering(
        self, store, settings, monkeypatch, derive_calls
    ):
        _garmin_connected(settings)
        monkeypatch.setattr(connect_mod, "sync",
                            lambda st, s, **kw: _activity(st, "gym1"))
        monkeypatch.setattr(details_mod, "sync_activity_details",
                            lambda st, aid, fetcher: {"gps": False, "samples": 3})

        A.sync_garmin(store, settings, fetcher=lambda p: None, resume=lambda d: "runner")
        assert derive_calls == ["best_efforts"]

    def test_one_failed_stream_does_not_end_the_run(
        self, store, settings, monkeypatch, derive_calls
    ):
        _garmin_connected(settings)

        def two(st, s, **kw):
            _activity(st, "bad", "2026-10-06")
            _activity(st, "good", "2026-10-07")

        def details(st, aid, fetcher):
            if aid == "bad":
                raise connect_mod.ConnectError("HTTP 500")
            return {"gps": False, "samples": 1}

        monkeypatch.setattr(connect_mod, "sync", two)
        monkeypatch.setattr(details_mod, "sync_activity_details", details)

        out = A.sync_garmin(store, settings, fetcher=lambda p: None,
                            resume=lambda d: "runner")
        assert out["state"] == "done"
        assert out["message"] == "2 new activities, 1 stream, 1 stream failed."

    def test_streams_are_capped_per_run(self, store, settings, monkeypatch, derive_calls):
        _garmin_connected(settings)
        for i in range(A.DETAIL_LIMIT + 5):
            _activity(store, f"old{i:03d}", "2020-01-01")
        monkeypatch.setattr(connect_mod, "sync", lambda st, s, **kw: None)
        fetched: list[str] = []
        monkeypatch.setattr(
            details_mod, "sync_activity_details",
            lambda st, aid, fetcher: fetched.append(aid) or {"gps": False},
        )

        A.sync_garmin(store, settings, fetcher=lambda p: None, resume=lambda d: "runner")
        assert len(fetched) == A.DETAIL_LIMIT


# ---------------------------------------------------------------------------
# Google Health
# ---------------------------------------------------------------------------


class TestFitbit:
    def test_skipped_when_not_connected(self, store, settings):
        assert A.sync_fitbit(store, settings)["state"] == "skipped"

    def test_reports_what_it_wrote(self, store, settings, monkeypatch):
        _fitbit_connected(settings)
        monkeypatch.setattr(
            fitbit_sync_mod, "sync_body",
            lambda st, client: {"state": "done", "days_written": 3,
                                "last_day": "2026-10-07"},
        )
        out = A.sync_fitbit(store, settings, client_factory=lambda d: object())
        assert out == {"state": "done", "message": "3 weigh-ins through 2026-10-07.",
                       "weigh_ins": 3}

    def test_rate_limited_is_not_a_failure(self, store, settings, monkeypatch):
        _fitbit_connected(settings)
        monkeypatch.setattr(
            fitbit_sync_mod, "sync_body",
            lambda st, client: {"state": "rate_limited", "days_written": 0,
                                "retry_after_s": 30},
        )
        out = A.sync_fitbit(store, settings, client_factory=lambda d: object())
        assert out["state"] == "done"

    def test_withdrawn_consent_is_an_error(self, store, settings):
        _fitbit_connected(settings)

        def gone(_token_dir):
            raise fitbit_mod.NeedsReauthorization("Reconnect Google Health in Settings.")

        out = A.sync_fitbit(store, settings, client_factory=gone)
        assert out == {"state": "error", "message": "Reconnect Google Health in Settings."}


# ---------------------------------------------------------------------------
# One run
# ---------------------------------------------------------------------------


class TestRunOnce:
    def test_nothing_connected(self, store, settings):
        out = A.run_once(store, settings)
        assert out["state"] == "done" and out["message"] == "Nothing is connected."
        row = store.sync_status(A.JOB)
        assert row["state"] == "done" and row["finished_at"]

    def test_the_row_is_its_own_and_leaves_the_backfill_alone(self, store, settings):
        store.set_sync_status("backfill", state="done", message="backfill complete")
        A.run_once(store, settings)
        assert store.sync_status("backfill")["message"] == "backfill complete"

    def test_one_source_raising_does_not_stop_the_other(self, store, settings):
        ran: list[str] = []

        def boom(st, s):
            raise RuntimeError("socket closed")

        def fitbit(st, s):
            ran.append("fitbit")
            return {"state": "done", "message": "2 weigh-ins through 2026-10-07."}

        out = A.run_once(store, settings, garmin=boom, fitbit=fitbit)

        assert ran == ["fitbit"]
        assert out["state"] == "error"
        assert out["message"] == "RuntimeError: socket closed"
        sources = json.loads(store.sync_status(A.JOB)["cursor"])
        assert sources["garmin"]["state"] == "error"
        assert sources["fitbit"]["state"] == "done"

    def test_messages_of_every_source_are_kept(self, store, settings):
        out = A.run_once(
            store, settings,
            garmin=lambda st, s: {"state": "done", "message": "1 new activity."},
            fitbit=lambda st, s: {"state": "skipped", "message": "not connected"},
            plan=lambda st, s: {"state": "done", "message": "7 prescribed sessions."},
            weather=lambda st, s: {"state": "done", "message": "Weather for 3 activities."},
        )
        assert out == {
            "state": "done",
            "message": "1 new activity. 7 prescribed sessions. Weather for 3 activities.",
            "sources": {
                "garmin": {"state": "done", "message": "1 new activity."},
                "fitbit": {"state": "skipped", "message": "not connected"},
                "plan": {"state": "done", "message": "7 prescribed sessions."},
                "weather": {"state": "done", "message": "Weather for 3 activities."},
            },
        }


# ---------------------------------------------------------------------------
# The schedule
# ---------------------------------------------------------------------------


class TestSchedule:
    NOW = 1_800_000_000.0  # 2027-01-15

    def test_first_run_is_due_immediately(self, store):
        assert A.next_due(store, 6 * HOUR, self.NOW) == self.NOW

    def test_due_an_interval_after_the_last_finished(self, store):
        store.set_sync_status(A.JOB, state="done", started_at="2027-01-15T07:00:00Z",
                              finished_at="2027-01-15T08:00:00Z")
        due = A.next_due(store, 6 * HOUR, self.NOW)
        assert A._stamp(due) == "2027-01-15T14:00:00Z"

    def test_a_run_that_died_counts_from_its_start(self, store):
        store.set_sync_status(A.JOB, state="running", started_at="2027-01-15T07:00:00Z",
                              finished_at=None)
        assert A._stamp(A.next_due(store, 6 * HOUR, self.NOW)) == "2027-01-15T13:00:00Z"

    def test_zero_hours_is_off(self, settings):
        auto = A.AutoSync(settings, 0)
        auto.start()
        assert not auto.enabled and auto._thread is None

    def test_waits_for_a_manual_sync(self, settings, store):
        clock = [self.NOW]
        runs: list[int] = []
        auto = A.AutoSync(settings, 6, is_busy=lambda: True,
                          run=lambda st, s: runs.append(1), clock=lambda: clock[0])
        assert auto.run_now() is None
        assert runs == []
        assert auto.due_at(store) == self.NOW + A.BUSY_RETRY_S

    def test_does_not_run_twice_at_once(self, settings):
        gate, entered = threading.Event(), threading.Event()
        runs: list[int] = []

        def slow(st, s):
            runs.append(1)
            entered.set()
            gate.wait(5)
            return {}

        auto = A.AutoSync(settings, 6, run=slow)
        t = threading.Thread(target=auto.run_now)
        t.start()
        assert entered.wait(5)
        assert auto.running
        assert auto.run_now() is None
        gate.set()
        t.join(5)
        assert runs == [1] and not auto.running

    def test_the_thread_runs_once_and_then_waits_the_interval(self, settings):
        ran = threading.Event()
        runs: list[int] = []

        def run(st, s):
            runs.append(1)
            out = A.run_once(st, s, garmin=lambda *a: {"state": "skipped", "message": ""},
                             fitbit=lambda *a: {"state": "skipped", "message": ""})
            ran.set()
            return out

        auto = A.AutoSync(settings, 6, run=run, startup_delay_s=0, poll_s=0.05)
        auto.start()
        try:
            assert ran.wait(5)
            # Another few polls: the next run is six hours out, so nothing happens.
            threading.Event().wait(0.3)
        finally:
            auto.stop()
        assert runs == [1]


# ---------------------------------------------------------------------------
# The API
# ---------------------------------------------------------------------------


class TestApi:
    def test_status_when_off(self, settings):
        body = TestClient(create_app(settings)).get("/api/sync/auto").json()
        assert body == {
            "enabled": False, "interval_hours": 0.0, "running": False, "state": None,
            "message": None, "started_at": None, "finished_at": None,
            "next_run_at": None, "sources": {},
        }

    def test_status_after_a_run(self, settings, store):
        A.run_once(store, settings)
        app = create_app(replace(settings, auto_sync_hours=6))
        body = TestClient(app).get("/api/sync/auto").json()
        assert body["enabled"] is True and body["interval_hours"] == 6.0
        assert body["state"] == "done" and body["message"] == "Nothing is connected."
        assert body["sources"]["garmin"] == {"state": "skipped",
                                             "message": "Garmin is not connected."}
        finished = A._epoch(body["finished_at"])
        assert A._epoch(body["next_run_at"]) == finished + 6 * HOUR

    def test_a_failure_fixed_since_by_hand_is_not_shown(self, settings, store):
        """2026-10-08: Google Health was reconnected and synced by hand at 08:21, and
        Settings went on showing the 08:06 automatic run's expired-token error."""
        A.run_once(store, settings,
                   garmin=lambda st, s: {"state": "done", "message": "0 new activities."},
                   fitbit=lambda st, s: {"state": "error", "message": "invalid_grant"})
        auto = A.AutoSync(settings, 6)
        assert A.status(store, auto)["sources"]["fitbit"]["state"] == "error"

        store.set_watermark(fitbit_sync_mod.ENDPOINT, "2026-10-08", "ok")
        store.conn.execute("UPDATE sync_watermark SET last_run_at = '2999-01-01T00:00:00Z' "
                           "WHERE endpoint = ?", (fitbit_sync_mod.ENDPOINT,))
        assert A.status(store, auto)["sources"]["fitbit"] == {
            "state": "done", "message": "Synced since, without a problem."}

    def test_the_server_starts_and_stops_the_scheduler(self, settings):
        app = create_app(replace(settings, auto_sync_hours=6))
        with TestClient(app):
            assert app.state.auto_sync._thread.is_alive()
        assert not app.state.auto_sync._thread.is_alive()

    @pytest.mark.parametrize("path", ["/api/sync/start", "/api/fitbit/sync"])
    def test_manual_sync_is_refused_while_an_automatic_one_runs(self, settings, path):
        _garmin_connected(settings)
        app = create_app(settings)
        app.state.auto_sync._lock.acquire()
        try:
            res = TestClient(app).post(path)
        finally:
            app.state.auto_sync._lock.release()
        assert res.status_code == 409
        assert res.json()["detail"] == "an automatic sync is running"

    def test_a_rate_limited_watermark_does_not_break_sync_status(self, settings, store):
        store.set_watermark(fitbit_sync_mod.ENDPOINT, "2026-10-01", "rate_limited",
                            "rate limited; retry in 30s")
        res = TestClient(create_app(settings)).get("/api/sync/status")
        assert res.status_code == 200, res.text
        statuses = {w["endpoint"]: w["status"] for w in res.json()["watermarks"]}
        assert statuses[fitbit_sync_mod.ENDPOINT] == "rate_limited"


class TestSigninExpiryInStatus:
    """T32: Settings is told when Google will end the sign-in, without a network call."""

    def test_reported_from_the_cache(self, settings):
        F = fitbit_mod
        F.save_tokens(F.Tokens("a", "r", expires_at=0.0, refresh_issued_at=1_800_000_000.0),
                      settings.token_dir)
        body = TestClient(create_app(settings)).get("/api/fitbit/status").json()
        assert body["connected"] is True
        assert body["signin_expires_at"] == A._stamp(1_800_000_000.0 + 7 * 24 * HOUR)

    def test_null_when_not_connected(self, settings):
        body = TestClient(create_app(settings)).get("/api/fitbit/status").json()
        assert body["signin_expires_at"] is None



class TestPlanSource:
    """The calendar as the third source."""

    def test_no_calendar_is_a_skip_not_a_failure(self, store, settings):
        out = A.sync_plan(store, settings)
        assert out["state"] == "skipped"

    def test_an_unchanged_feed_is_a_good_run_that_wrote_nothing(self, store, settings, monkeypatch):
        from garmin_analytics.ingest import plan_ics

        monkeypatch.setattr(plan_ics, "sync_plan",
                            lambda st, *a, **k: {"status": "unchanged"})
        out = A.sync_plan(store, settings)
        assert out["state"] == "done"
        assert "unchanged" in out["message"]

    def test_a_dead_address_is_an_error_the_owner_can_act_on(self, store, settings, monkeypatch):
        from garmin_analytics.ingest import plan_ics

        def boom(st, *a, **k):
            raise plan_ics.PlanFeedError("the private address was reset")

        monkeypatch.setattr(plan_ics, "sync_plan", boom)
        out = A.sync_plan(store, settings)
        assert out["state"] == "error"
        assert "reset" in out["message"]

    def test_the_plan_runs_after_garmin(self, store, settings):
        """Adherence is judged against activities. Reading the calendar before Garmin
        has been pulled scores this morning's long run as missed for six hours."""
        order = []
        A.run_once(
            store, settings,
            garmin=lambda st, s: order.append("garmin") or {"state": "skipped", "message": ""},
            fitbit=lambda st, s: order.append("fitbit") or {"state": "skipped", "message": ""},
            plan=lambda st, s: order.append("plan") or {"state": "skipped", "message": ""},
        )
        assert order == ["garmin", "fitbit", "plan"]
