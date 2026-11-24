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
