"""What the plan asked of one activity (`plan.session_for_activity`, `/api/activities/{id}/plan`)."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from conftest import add_calendar_race
from odeda.analytics import plan as plan_mod
from odeda.api.server import create_app

TODAY = date(2026, 12, 1)


def _session(store, day, kind, metres, sport="running", optional=0, title="Long Run - DBRC"):
    sid = store.conn.execute("SELECT id FROM plan_sources ORDER BY id LIMIT 1").fetchone()[0]
    store.conn.execute(
        "INSERT INTO plan_sessions (source_id, uid, recurrence_id, day, start_local, sport, kind, "
        "planned_min_m, planned_max_m, title, optional, parse_status) "
        "VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'ok')",
        (sid, f"{kind}-{day}-{sport}", day, f"{day}T05:00:00", sport, kind, metres, metres, title, optional),
    )
    store.conn.commit()


def _activity(store, aid, day, metres, activity_type="running"):
    store.conn.execute(
        "INSERT INTO activities (activity_id, day, start_time_local, activity_type, distance_m, "
        "duration_s, trimp) VALUES (?, ?, ?, ?, ?, 5400, 80)",
        (aid, day, f"{day}T05:00:00", activity_type, metres),
    )
    store.conn.commit()


class TestSessionForActivity:
    def test_a_long_run_that_came_up_short_says_so_and_names_the_next_one(self, store):
        add_calendar_race(store)
        _session(store, "2026-11-27", "long", 15000)
        _session(store, "2026-12-04", "long", 16000)
        _activity(store, "run1", "2026-11-27", 11200)
        out = plan_mod.session_for_activity(store, "run1", TODAY)
        assert out["session"]["verdict"] == "short"
        assert out["session"]["kind"] == "long"
        assert out["session"]["actual_m"] == pytest.approx(11200)
        assert out["next"]["day"] == "2026-12-04"

    def test_an_activity_the_plan_never_asked_for_has_neither(self, store):
        add_calendar_race(store)
        _session(store, "2026-11-27", "long", 15000)
        _activity(store, "extra", "2026-11-20", 5000)
        assert plan_mod.session_for_activity(store, "extra", TODAY) == {"session": None, "next": None}

    def test_the_next_is_of_the_same_kind_and_sport(self, store):
        add_calendar_race(store)
        _session(store, "2026-11-27", "long", 15000)
        _session(store, "2026-12-02", "easy", 5000, title="Easy run")  # not a long run
        _session(store, "2026-12-03", "long", 16000, sport="cycling", title="Long ride")  # not a run
        _activity(store, "run1", "2026-11-27", 15200)
        assert plan_mod.session_for_activity(store, "run1", TODAY)["next"] is None

    def test_an_optional_session_is_not_something_to_look_forward_to(self, store):
        add_calendar_race(store)
        _session(store, "2026-11-27", "long", 15000)
        _session(store, "2026-12-04", "long", 16000, optional=1)
        _activity(store, "run1", "2026-11-27", 15200)
        assert plan_mod.session_for_activity(store, "run1", TODAY)["next"] is None

    def test_a_session_already_past_is_not_next(self, store):
        add_calendar_race(store)
        _session(store, "2026-11-20", "long", 14000)  # missed, behind us
        _session(store, "2026-11-27", "long", 15000)
        _activity(store, "run1", "2026-11-27", 15200)
        assert plan_mod.session_for_activity(store, "run1", TODAY)["next"] is None


class TestEndpoint:
    @pytest.fixture
    def client(self, settings):
        return TestClient(create_app(settings))

    def test_the_session_an_activity_fulfilled(self, client, store):
        add_calendar_race(store)
        _session(store, "2026-11-27", "long", 15000)
        _activity(store, "run1", "2026-11-27", 11200)
        body = client.get("/api/activities/run1/plan").json()
        assert body["session"]["title"] == "Long Run - DBRC"
        assert body["session"]["verdict"] == "short"

    def test_an_activity_outside_the_plan_is_an_empty_answer_not_an_error(self, client, store):
        _activity(store, "free", "2026-11-20", 5000)
        assert client.get("/api/activities/free/plan").json() == {"session": None, "next": None}

    def test_an_unknown_activity_is_a_404(self, client):
        assert client.get("/api/activities/nope/plan").status_code == 404
