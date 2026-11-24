"""The named plan (Higdon Novice 1, week 5 of 12) the week notes say is driving the numbers."""

from __future__ import annotations

from datetime import date

import pytest

from odeda.analytics import plan as plan_mod
from odeda.ingest import plan_ics
from odeda.plan import parse as P

URL = "https://calendar.google.com/calendar/ical/x%40group.calendar.google.com/private-s3cr3t/basic.ics"

FEED = (
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google//EN\r\n"
    "BEGIN:VEVENT\r\nUID:mon\r\nDTSTART;TZID=Asia/Qatar:20260928T043000\r\n"
    "DTEND;TZID=Asia/Qatar:20260928T051500\r\nSUMMARY:Easy run 7.2 km\r\n"
    "DESCRIPTION:HIGDON NOVICE 1 - WEEK 7 of 12 || MON (today): 7.2 km easy. || SUN = rest.\r\n"
    "END:VEVENT\r\nEND:VCALENDAR\r\n"
)


class Transport:
    def get(self, url, headers):
        return plan_ics.FeedResponse(200, {"Content-Type": "text/calendar"}, FEED)


class TestHeader:
    def test_reads_the_name_and_week(self):
        got = P.plan_header("HIGDON NOVICE 1 - WEEK 5 of 12 || MON: 6.4 km easy.")
        assert got == {"name": "Higdon Novice 1", "week": 5, "weeks": 12}

    @pytest.mark.parametrize(
        "text",
        ["", "no header || MON: 5 km", "HIGDON NOVICE 1 - WEEK 5 of 12", "X - WEEK 14 of 12 || y"],
    )
    def test_no_header_is_none(self, text):
        assert P.plan_header(text) is None


class TestNamedPlan:
    @pytest.fixture
    def synced(self, store):
        plan_ics.set_source(store, URL, "Training")
        plan_ics.sync_plan(store, Transport(), today=date(2026, 10, 5))
        return store

    def test_this_weeks_note_names_the_plan(self, synced):
        assert plan_mod.named_plan(synced, date(2026, 9, 30)) == {
            "name": "Higdon Novice 1", "week": 7, "weeks": 12,
        }

    def test_the_week_count_moves_on_without_a_new_note(self, synced):
        assert plan_mod.named_plan(synced, date(2026, 10, 6))["week"] == 8

    def test_before_the_first_note_there_is_no_plan(self, synced):
        assert plan_mod.named_plan(synced, date(2026, 9, 20)) is None

    def test_past_the_last_week_there_is_no_plan(self, synced):
        assert plan_mod.named_plan(synced, date(2026, 11, 20)) is None

    def test_with_no_calendar_there_is_none(self, store):
        assert plan_mod.named_plan(store, date(2026, 10, 5)) is None


class TestActivePlan:
    @pytest.fixture
    def synced(self, store):
        plan_ics.set_source(store, URL, "Training")
        plan_ics.sync_plan(store, Transport(), today=date(2026, 10, 5))
        return store

    def test_a_named_plan_takes_precedence(self, synced):
        source = plan_ics.get_source(synced)
        got = plan_mod.active_plan(synced, date(2026, 9, 30), source)
        assert got == {"kind": "named", "name": "Higdon Novice 1", "week": 7, "weeks": 12}

    def test_otherwise_the_calendar_is_shown(self, synced):
        source = plan_ics.get_source(synced)
        got = plan_mod.active_plan(synced, date(2026, 11, 20), source)
        assert got == {"kind": "calendar", "name": "Training", "week": None, "weeks": None}

    def test_nothing_subscribed_names_nothing(self, store):
        assert plan_mod.active_plan(store, date(2026, 10, 5), None) is None


class TestAnyPlanName:
    NOTE = (
        "RUNNA HALF - WEEK 3 of 10 || TUE - club: Runna says 6.4 km; club does 8-10 km. "
        "|| FRI - long run: Runna prescribes 9.7 km."
    )

    def test_the_plans_own_name_is_the_voice_whose_number_is_quoted(self):
        notes = P.parse_week_note(self.NOTE)
        assert notes[1].plan_m == 6400.0 and notes[1].min_m == 8000.0
        assert notes[4].plan_m == 9700.0

    def test_higdon_still_reads_as_before(self):
        notes = P.parse_week_note("HIGDON NOVICE 1 - WEEK 5 of 12 || FRI - long run: target 17 km (Higdon prescribes 9.7).")
        assert notes[4].min_m == 17000.0
        assert notes[4].plan_m == 9700.0
