"""The day the plan begins, and what it takes out of every figure.

Found on the owner's real calendar, which is a general one rather than a training-only
one: `Katara Hills - Run - DBRC` is a weekly club run with 285 instances going back to
2021. `window()` caps only the end of recurrence expansion, so the plan reached back five
years and averaged its targets over four years of single-session weeks that nobody ever
prescribed. The feed here is that shape, small enough to count by hand.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from garmin_analytics.api.server import create_app
from garmin_analytics.ingest import plan_ics

URL = "https://calendar.google.com/calendar/ical/x%40group.calendar.google.com/private-s3cr3t/basic.ics"

#: A club run that has repeated weekly since 2021, plus one session inside the block the
#: owner actually started in September 2026. The first is the whole problem.
FEED = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google//EN\r\n"
    "BEGIN:VEVENT\r\nUID:club\r\nDTSTART;TZID=Asia/Qatar:20210810T053000\r\n"
    "DTEND;TZID=Asia/Qatar:20210810T063000\r\nRRULE:FREQ=WEEKLY;BYDAY=TU\r\n"
    "SUMMARY:Katara Hills - Run - DBRC\r\n"
    "DESCRIPTION:Club run 8-10 km\r\nEND:VEVENT\r\n"
    "BEGIN:VEVENT\r\nUID:long\r\nDTSTART;TZID=Asia/Qatar:20260925T050000\r\n"
    "DTEND;TZID=Asia/Qatar:20260925T080000\r\nSUMMARY:Easy run 12.0 km\r\n"
    "END:VEVENT\r\n"
    "END:VCALENDAR\r\n"
)

TODAY = date(2026, 10, 9)
START = "2026-09-01"


class FakeTransport:
    def get(self, url, headers):
        return plan_ics.FeedResponse(200, {"Content-Type": "text/calendar"}, FEED)


@pytest.fixture
def client(settings, store, fake_ui):
    from dataclasses import replace

    return TestClient(create_app(replace(settings, ui_dir=fake_ui)))


@pytest.fixture
def subscribed(client, store):
    plan_ics.set_source(store, URL, "Training")
    plan_ics.sync_plan(store, FakeTransport(), today=TODAY)
    return client


def weeks_of(body) -> list[str]:
    return [w["start"] for w in body["weeks"]]


class TestTheBugItFixes:
    def test_without_a_start_day_the_club_run_backfills_five_years(self, subscribed):
        """The behaviour being corrected, pinned so it cannot come back by accident."""
        body = subscribed.get("/api/plan").json()
        assert body["source"]["start_day"] is None
        assert min(weeks_of(body)) < "2022-01-01"
        assert len(body["weeks"]) > 200

    def test_a_start_day_draws_the_line(self, subscribed):
        r = subscribed.put("/api/plan/start", json={"start_day": START})
        assert r.status_code == 200
        body = r.json()
        assert body["source"]["start_day"] == START
        assert min(weeks_of(body)) >= "2026-08-31"  # the Monday of the week START is in
        # Far fewer than the 285 the whole calendar gives. Not a fixed number: this
        # feed names no race, so the forward end is `VIEW_HORIZON_DAYS`, not race day.
        assert len(body["weeks"]) < 60

    def test_targets_stop_being_averaged_over_five_years(self, subscribed):
        before = subscribed.get("/api/plan").json()["targets"]["mean_weekly_km"]
        after = (
            subscribed.put("/api/plan/start", json={"start_day": START})
            .json()["targets"]["mean_weekly_km"]
        )
        assert before is not None and after is not None
        assert after > before

    def test_the_week_endpoint_agrees_with_the_plan(self, subscribed):
        """One line in `judge_all`, so the two cannot disagree about where it starts."""
        subscribed.put("/api/plan/start", json={"start_day": START})
        stale = subscribed.get("/api/plan/week", params={"start": "2021-08-09"}).json()
        assert stale["sessions"] == []


class TestItIsAResetNotADelete:
    def test_nothing_is_deleted(self, subscribed, store):
        before = store.scalar("SELECT COUNT(*) FROM plan_sessions")
        subscribed.put("/api/plan/start", json={"start_day": START})
        assert store.scalar("SELECT COUNT(*) FROM plan_sessions") == before
        assert store.scalar(
            "SELECT COUNT(*) FROM plan_sessions WHERE withdrawn_at IS NOT NULL"
        ) == 0

    def test_clearing_it_brings_the_history_home_with_no_resync(self, subscribed):
        subscribed.put("/api/plan/start", json={"start_day": START})
        body = subscribed.put("/api/plan/start", json={"start_day": None}).json()
        assert body["source"]["start_day"] is None
        assert min(weeks_of(body)) < "2022-01-01"

    def test_replacing_a_rotated_address_keeps_the_start_day(self, subscribed):
        subscribed.put("/api/plan/start", json={"start_day": START})
        rotated = URL.replace("private-s3cr3t", "private-r0tat3d")
        body = subscribed.put("/api/plan/source", json={"url": rotated}).json()
        assert body["source"]["start_day"] == START


class TestItRefusesWhatWouldBreakIt:
    def test_a_start_day_past_the_whole_calendar_is_refused(self, subscribed):
        """T57 changed what this is measured against. It used to refuse anything after
        `config.RACE_DATE`, which meant the reset control stopped working on the day it
        was most wanted — starting the next block after a race. It now refuses a day
        after the last session the calendar actually holds, which is what "would leave
        nothing prescribed" was always trying to say."""
        r = subscribed.put("/api/plan/start", json={"start_day": "2030-06-01"})
        assert r.status_code == 400
        assert "last session" in r.json()["detail"]

    def test_a_start_day_after_the_race_but_inside_the_calendar_is_allowed(self, subscribed):
        """The bug this replaces: a new block beginning after race day was refused."""
        r = subscribed.put("/api/plan/start", json={"start_day": "2027-02-01"})
        assert r.status_code == 200

    def test_something_that_is_not_a_date_is_refused(self, subscribed):
        assert subscribed.put(
            "/api/plan/start", json={"start_day": "september"}
        ).status_code == 400

    def test_setting_one_with_no_calendar_is_refused(self, client):
        r = client.put("/api/plan/start", json={"start_day": START})
        assert r.status_code == 400


class TestTheMigration:
    def test_an_existing_database_gains_the_column_in_place(self, settings, store):
        """The version bump is what makes this reach an existing database: the schema
        fingerprint is keyed on SCHEMA_VERSION and the field registry, and a new plan
        column touches neither."""
        from garmin_analytics.db import store as store_mod

        plan_ics.set_source(store, URL, "Training")
        store.conn.execute("ALTER TABLE plan_sources DROP COLUMN start_day")
        store.conn.execute("PRAGMA user_version = 0")
        store.conn.commit()
        assert "start_day" not in {
            r[1] for r in store.conn.execute("PRAGMA table_info(plan_sources)")
        }

        store_mod.migrate(store.conn)

        columns = {r[1] for r in store.conn.execute("PRAGMA table_info(plan_sources)")}
        assert "start_day" in columns
        # the subscription survived the upgrade
        assert store.scalar("SELECT COUNT(*) FROM plan_sources") == 1
        assert store.scalar("SELECT MAX(version) FROM schema_migrations") == store_mod.SCHEMA_VERSION
