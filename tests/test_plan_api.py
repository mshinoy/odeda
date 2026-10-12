"""`/api/plan` and the endpoints around it.

The empty-state cases get as much attention as the populated ones. This repository has
shipped three bugs in paths that only run when there is no data — `report` crashed on an
empty database, `serve` exited 1 when the file did not exist — and "no calendar
subscribed" is exactly that kind of path.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.api.server import create_app
from garmin_analytics.ingest import plan_ics


@pytest.fixture
def client(settings, store, fake_ui):
    """A client over the *same* database the test writes to. `store` is requested so the
    schema exists before the app opens its own connections to the file."""
    from dataclasses import replace

    return TestClient(create_app(replace(settings, ui_dir=fake_ui)))

URL = "https://calendar.google.com/calendar/ical/x%40group.calendar.google.com/private-s3cr3t/basic.ics"

FEED = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google//EN\r\n"
    "BEGIN:VEVENT\r\nUID:mon\r\nDTSTART;TZID=Asia/Qatar:20260928T043000\r\n"
    "DTEND;TZID=Asia/Qatar:20260928T051500\r\nSUMMARY:Easy run 7.2 km\r\n"
    "DESCRIPTION:HIGDON NOVICE 1 - WEEK 7 of 12 || MON (today): 7.2 km easy. || "
    "FRI - DBRC long run: target 18 km  (Higdon prescribes 11.3). || SUN = rest.\r\n"
    "END:VEVENT\r\n"
    "BEGIN:VEVENT\r\nUID:fri\r\nDTSTART;TZID=Asia/Qatar:20261002T050000\r\n"
    "DTEND;TZID=Asia/Qatar:20261002T080000\r\nSUMMARY:Long Run - DBRC\r\nEND:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)


class FakeTransport:
    def __init__(self, body: str = FEED, status: int = 200,
                 content_type: str = "text/calendar") -> None:
        self.body, self.status, self.content_type = body, status, content_type

    def get(self, url, headers):
        return plan_ics.FeedResponse(
            self.status, {"Content-Type": self.content_type}, self.body
        )


@pytest.fixture
def planned(client, store):
    """A subscribed calendar, synced, with one run done and one missed."""
    store.conn.execute(
        "INSERT INTO activities (activity_id, day, start_time_local, activity_type, "
        "distance_m, duration_s) VALUES "
        "('a-mon', '2026-09-28', '2026-09-28T04:30:00', 'running', 7400, 2400)"
    )
    store.conn.commit()
    plan_ics.set_source(store, URL, "Training")
    plan_ics.sync_plan(store, FakeTransport(), today=date(2026, 10, 5))
    return client


class TestEmptyState:
    def test_no_calendar_is_a_two_hundred_not_a_four_oh_four(self, client):
        r = client.get("/api/plan")
        assert r.status_code == 200
        body = r.json()
        assert body["subscribed"] is False
        assert body["source"] is None
        assert body["weeks"] == []
        assert body["adherence_4wk"] is None

    def test_targets_are_null_rather_than_invented(self, client):
        """D12: with no plan the panel shows its curves without a goal line. A number
        nobody chose is worse than none."""
        targets = client.get("/api/plan").json()["targets"]
        assert targets["peak_weekly_km"] is None
        assert targets["source"] == "none"

    def test_a_week_with_nothing_in_it_still_answers(self, client):
        r = client.get("/api/plan/week", params={"start": "2026-09-28"})
        assert r.status_code == 200
        assert r.json()["sessions"] == []

    def test_a_nonsense_week_is_rejected_not_crashed(self, client):
        assert client.get("/api/plan/week", params={"start": "last tuesday"}).status_code == 422


class TestSubscribing:
    def test_the_address_never_comes_back_out(self, client):
        r = client.put("/api/plan/source", json={"url": URL, "label": "Training"})
        assert r.status_code == 200
        source = r.json()["source"]
        assert "s3cr3t" not in str(r.json())
        assert source["url_masked"].endswith("basic.ics")
        assert source["label"] == "Training"

    def test_something_that_is_not_a_url_is_a_four_hundred(self, client):
        r = client.put("/api/plan/source", json={"url": "paste it here"})
        assert r.status_code == 400

    def test_unsubscribing_leaves_the_history(self, planned):
        before = planned.get("/api/plan").json()
        assert before["weeks"]
        after = planned.delete("/api/plan/source").json()
        assert after["subscribed"] is False
        # The sessions are withdrawn, so the live plan is empty but nothing was deleted.
        assert after["weeks"] == []


class TestThePlan:
    def test_the_week_note_reaches_the_api(self, planned):
        """Friday's 18 km exists only in Monday's description. If it survives the whole
        path — ICS, parse, collapse, match, serialise — the phase works."""
        week = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        friday = next(s for s in week["sessions"] if s["day"] == "2026-10-02")
        assert friday["planned_min_m"] == 18000
        assert friday["kind"] == "long"

    def test_a_done_session_carries_what_did_it(self, planned):
        week = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        monday = next(s for s in week["sessions"] if s["day"] == "2026-09-28")
        assert monday["verdict"] == "done"
        assert monday["activity_id"] == "a-mon"
        assert monday["actual_m"] == 7400

    def test_a_missed_session_says_so(self, planned):
        week = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        friday = next(s for s in week["sessions"] if s["day"] == "2026-10-02")
        assert friday["verdict"] == "missed"
        assert friday["activity_id"] is None

    def test_targets_come_from_the_plan(self, planned):
        targets = planned.get("/api/plan").json()["targets"]
        assert targets["source"] == "plan"
        assert targets["peak_weekly_km"] == pytest.approx(25.2, abs=0.1)

    def test_the_week_summary_is_weighted_not_counted(self, planned):
        """One of two sessions done, but the one missed is the long run, so adherence is
        below 50%."""
        summary = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()["summary"]
        assert summary["sessions_done"] == 1
        assert summary["adherence_pct"] < 50


class TestIgnoring:
    """T48. The endpoint has always accepted `ignore`; nothing read the row it wrote."""

    def _friday(self, client) -> int:
        week = client.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        return next(s for s in week["sessions"] if s["day"] == "2026-10-02")["session_ids"][0]

    def test_ignoring_the_missed_long_run_moves_the_percentage(self, planned):
        before = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()["summary"]
        assert before["sessions_planned"] == 2

        planned.put(f"/api/plan/sessions/{self._friday(planned)}/link", json={"ignore": True})

        after = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()["summary"]
        assert after["sessions_planned"] == 1
        assert after["adherence_pct"] == 100.0

    def test_the_ignored_session_is_still_on_the_page(self, planned):
        planned.put(f"/api/plan/sessions/{self._friday(planned)}/link", json={"ignore": True})
        week = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        friday = next(s for s in week["sessions"] if s["day"] == "2026-10-02")
        assert friday["ignored"] is True

    def test_undoing_it_puts_the_session_back(self, planned):
        session_id = self._friday(planned)
        planned.put(f"/api/plan/sessions/{session_id}/link", json={"ignore": True})
        planned.delete(f"/api/plan/sessions/{session_id}/link")
        summary = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()["summary"]
        assert summary["sessions_planned"] == 2
        assert summary["adherence_pct"] < 50


class TestDecisions:
    """T41: Settings lists what the owner overruled, because only those two things
    are stored. An `auto` match that goes wrong fixes itself; these never do."""

    def test_nothing_overruled_is_an_empty_list_not_a_missing_key(self, client):
        assert client.get("/api/plan").json()["decisions"] == []

    def test_a_manual_link_and_an_ignore_both_appear(self, planned):
        week = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        monday = next(s for s in week["sessions"] if s["day"] == "2026-09-28")["session_ids"][0]
        friday = next(s for s in week["sessions"] if s["day"] == "2026-10-02")["session_ids"][0]
        planned.put(f"/api/plan/sessions/{monday}/link", json={"activity_id": "a-mon"})
        planned.put(f"/api/plan/sessions/{friday}/link", json={"ignore": True})

        decisions = planned.get("/api/plan").json()["decisions"]
        assert {d["link_type"] for d in decisions} == {"manual", "ignored"}
        assert all(d["title"] for d in decisions)

    def test_undoing_one_takes_it_off_the_list(self, planned):
        week = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        monday = next(s for s in week["sessions"] if s["day"] == "2026-09-28")["session_ids"][0]
        planned.put(f"/api/plan/sessions/{monday}/link", json={"activity_id": "a-mon"})
        planned.delete(f"/api/plan/sessions/{monday}/link")
        assert planned.get("/api/plan").json()["decisions"] == []


class TestTheRacePanelsTargets:
    """D12: `/api/race` used to carry `ctl_target: 75` and `weekly_km_target: 55` on
    every install, synced or not. Both now come from the calendar or not at all."""

    def test_no_calendar_means_no_goal_line(self, client):
        race = client.get("/api/race").json()
        assert race["ctl_target"] is None
        assert race["weekly_km_target"] is None
        assert race["ctl_per_week_needed"] is None
        assert race["targets"]["source"] == "none"

    def test_the_volume_target_is_the_plans_peak_week(self, planned):
        race = planned.get("/api/race").json()
        assert race["weekly_km_target"] == pytest.approx(25.2, abs=0.1)
        assert race["targets"]["source"] == "plan"

    def test_a_plan_with_no_load_to_price_it_still_has_no_ctl_target(self, planned):
        """The fixture's one activity carries no TRIMP, so there is no load per
        kilometre to turn the plan's kilometres into a CTL. Volume target, no CTL
        target — the panel draws one goal line, not an invented second."""
        race = planned.get("/api/race").json()
        assert race["weekly_km_target"] is not None
        assert race["ctl_target"] is None

    def test_the_config_endpoint_no_longer_publishes_targets(self, client):
        assert "targets" not in client.get("/api/config").json()


class TestSync:
    def test_a_sync_reports_what_it_read(self, client, store, monkeypatch):
        monkeypatch.setattr(plan_ics, "UrllibTransport", lambda *a, **k: FakeTransport())
        plan_ics.set_source(store, URL)
        r = client.post("/api/plan/sync")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"
        assert r.json()["parsed_ok"] >= 2

    def test_a_dead_calendar_address_is_explained_not_a_stack_trace(
        self, client, store, monkeypatch
    ):
        """A reset private address answers 200 with a sign-in page. The owner needs to
        read "copy the new one", not a bare 502."""
        monkeypatch.setattr(
            plan_ics, "UrllibTransport",
            lambda *a, **k: FakeTransport("<html>Sign in</html>", content_type="text/html"),
        )
        plan_ics.set_source(store, URL)
        r = client.post("/api/plan/sync")
        assert r.status_code == 502
        assert "reset" in r.json()["detail"]

    def test_no_calendar_is_a_skip_not_an_error(self, client):
        r = client.post("/api/plan/sync")
        assert r.status_code == 200
        assert r.json()["status"] == "skipped"


class TestManualLinks:
    def _session_id(self, client, day: str) -> int:
        week = client.get("/api/plan/week", params={"start": day}).json()
        return next(s for s in week["sessions"] if s["day"] == day)["session_ids"][0]

    def test_the_owner_can_say_which_run_was_the_long_run(self, planned, store):
        store.conn.execute(
            "INSERT INTO activities (activity_id, day, start_time_local, activity_type, "
            "distance_m, duration_s) VALUES "
            "('a-sat', '2026-10-03', '2026-10-03T06:00:00', 'running', 18200, 9000)"
        )
        store.conn.commit()
        sid = self._session_id(planned, "2026-10-02")
        r = planned.put(f"/api/plan/sessions/{sid}/link", json={"activity_id": "a-sat"})
        assert r.status_code == 200
        assert r.json()["link_type"] == "manual"

    def test_an_ignored_session_can_be_set_and_cleared(self, planned):
        sid = self._session_id(planned, "2026-10-02")
        assert planned.put(f"/api/plan/sessions/{sid}/link",
                           json={"ignore": True}).json()["link_type"] == "ignored"
        assert planned.delete(f"/api/plan/sessions/{sid}/link").json()["link_type"] == "cleared"

    def test_an_activity_already_spoken_for_is_refused_by_name(self, planned):
        """The database would refuse it anyway; saying which session holds it is more
        use than a constraint violation."""
        monday = self._session_id(planned, "2026-09-28")
        friday = self._session_id(planned, "2026-10-02")
        planned.put(f"/api/plan/sessions/{monday}/link", json={"activity_id": "a-mon"})
        r = planned.put(f"/api/plan/sessions/{friday}/link", json={"activity_id": "a-mon"})
        assert r.status_code == 409
        assert str(monday) in r.json()["detail"]

    def test_linking_a_session_that_does_not_exist_is_a_four_oh_four(self, planned):
        assert planned.put("/api/plan/sessions/99999/link",
                           json={"activity_id": "a-mon"}).status_code == 404

    def test_linking_an_activity_that_does_not_exist_is_a_four_oh_four(self, planned):
        sid = self._session_id(planned, "2026-10-02")
        assert planned.put(f"/api/plan/sessions/{sid}/link",
                           json={"activity_id": "nope"}).status_code == 404


class TestEverySessionAtOnce:
    """`/api/plan/sessions`. The calendar draws a cell per day across the whole block,
    so fetching a week at a time would be twenty-one requests to render one page."""

    def test_no_calendar_is_an_empty_list_not_an_error(self, client):
        r = client.get("/api/plan/sessions")
        assert r.status_code == 200
        assert r.json()["sessions"] == []

    def test_it_returns_the_days_the_week_endpoint_would(self, planned):
        """Both read `judge_all`, so a cell and the week above it cannot disagree."""
        every = planned.get("/api/plan/sessions").json()["sessions"]
        one_week = planned.get("/api/plan/week", params={"start": "2026-09-28"}).json()
        same_week = [s for s in every if "2026-09-28" <= s["day"] <= "2026-10-04"]
        assert same_week == one_week["sessions"]

    def test_a_session_carries_its_own_day_so_the_view_can_bucket_it(self, planned):
        sessions = planned.get("/api/plan/sessions").json()["sessions"]
        assert sessions
        assert all(s["day"] for s in sessions)
        assert sessions == sorted(sessions, key=lambda s: s["day"])

    def test_the_verdicts_match_the_plan_itself(self, planned):
        every = planned.get("/api/plan/sessions").json()
        plan = planned.get("/api/plan").json()
        assert every["today"] == plan["today"]
