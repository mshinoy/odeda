"""The owner's changes to the plan: moved sessions, a different distance, sessions of
their own. They are read on top of the calendar and survive a sync."""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from odeda.analytics import plan as plan_mod
from odeda.api.server import create_app
from odeda.ingest import plan_ics

from tests.test_plan_api import FakeTransport, URL, client, planned  # noqa: F401

TODAY = date(2026, 10, 5)


def session_id(client, title: str) -> int:
    rows = client.get("/api/plan/sessions").json()["sessions"]
    return next(r["session_ids"][0] for r in rows if r["title"].startswith(title))


def days(client) -> dict[str, dict]:
    return {r["title"]: r for r in client.get("/api/plan/sessions").json()["sessions"]}


class TestEditing:
    def test_a_moved_session_is_judged_on_its_new_day(self, planned):
        sid = session_id(planned, "Long Run")
        r = planned.put(f"/api/plan/sessions/{sid}/edit", json={"day": "2026-10-03"})
        assert r.status_code == 200
        row = days(planned)["Long Run - DBRC"]
        assert row["day"] == "2026-10-03"
        assert row["edited"] is True
        assert row["original_day"] == "2026-10-02"

    def test_a_changed_distance_is_what_the_plan_asks(self, planned):
        sid = session_id(planned, "Long Run")
        planned.put(f"/api/plan/sessions/{sid}/edit", json={"distance_m": 12000})
        row = days(planned)["Long Run - DBRC"]
        assert row["planned_min_m"] == 12000 and row["planned_max_m"] == 12000

    def test_undoing_it_gives_the_calendars_session_back(self, planned):
        sid = session_id(planned, "Long Run")
        before = days(planned)["Long Run - DBRC"]
        planned.put(f"/api/plan/sessions/{sid}/edit", json={"day": "2026-10-03"})
        planned.delete(f"/api/plan/sessions/{sid}/edit")
        after = days(planned)["Long Run - DBRC"]
        assert after["day"] == before["day"] and after["edited"] is False

    def test_asking_for_what_the_calendar_says_is_not_an_edit(self, planned):
        sid = session_id(planned, "Long Run")
        planned.put(f"/api/plan/sessions/{sid}/edit", json={"day": "2026-10-03"})
        planned.put(f"/api/plan/sessions/{sid}/edit", json={"day": "2026-10-02"})
        assert days(planned)["Long Run - DBRC"]["edited"] is False

    def test_a_sync_does_not_undo_an_edit(self, planned, store):
        sid = session_id(planned, "Long Run")
        planned.put(f"/api/plan/sessions/{sid}/edit", json={"day": "2026-10-03", "distance_m": 9000})
        plan_ics.sync_plan(store, FakeTransport(), today=TODAY)
        row = days(planned)["Long Run - DBRC"]
        assert row["day"] == "2026-10-03" and row["planned_min_m"] == 9000

    def test_bad_input_is_refused(self, planned):
        sid = session_id(planned, "Long Run")
        assert planned.put(f"/api/plan/sessions/{sid}/edit", json={"day": "friday"}).status_code == 422
        assert planned.put(f"/api/plan/sessions/{sid}/edit", json={"distance_m": -5}).status_code == 422
        assert planned.put("/api/plan/sessions/99999/edit", json={"day": "2026-10-03"}).status_code == 404


class TestOwnSessions:
    def add(self, client, **over):
        body = {"day": "2026-10-04", "sport": "running", "distance_m": 6000, **over}
        return client.post("/api/plan/sessions", json=body)

    def test_an_added_session_is_part_of_the_plan(self, planned):
        r = self.add(planned, title="Shakeout")
        assert r.status_code == 200
        row = days(planned)["Shakeout"]
        assert row["own"] is True and row["day"] == "2026-10-04"
        assert row["planned_min_m"] == 6000

    def test_it_survives_a_sync(self, planned, store):
        self.add(planned, title="Shakeout")
        plan_ics.sync_plan(store, FakeTransport(), today=TODAY)
        assert "Shakeout" in days(planned)

    def test_it_can_be_removed_but_a_calendar_session_cannot(self, planned):
        sid = self.add(planned, title="Shakeout").json()["session_id"]
        assert planned.delete(f"/api/plan/sessions/{sid}").status_code == 200
        assert "Shakeout" not in days(planned)
        calendar = session_id(planned, "Long Run")
        assert planned.delete(f"/api/plan/sessions/{calendar}").status_code == 404

    def test_only_known_sports_and_real_days(self, planned):
        assert self.add(planned, sport="curling").status_code == 422
        assert self.add(planned, day="soon").status_code == 422
        assert self.add(planned, distance_m=0).status_code == 422
