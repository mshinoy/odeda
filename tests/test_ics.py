"""The iCalendar subset reader.

What is being pinned here is mostly what the reader *refuses*. A recurrence rule it
expands wrongly produces sessions on days nobody trained, and an adherence percentage
built on them is indistinguishable from a real one — so every unsupported rule has a
test proving it is flagged rather than guessed at.
"""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from garmin_analytics.ingest import ics

QATAR = ZoneInfo("Asia/Qatar")
LONDON = ZoneInfo("Europe/London")

WINDOW_END = datetime(2027, 1, 22, tzinfo=ZoneInfo("UTC"))


def feed(*events: str) -> str:
    body = "\r\n".join(events)
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n{body}\r\nEND:VCALENDAR\r\n"


def event(**over: str) -> str:
    fields = {
        "UID": "long-run",
        "DTSTART;TZID=Asia/Qatar": "20261030T050000",
        "DTEND;TZID=Asia/Qatar": "20261030T080000",
        "SUMMARY": "DBRC Long Run",
    }
    fields.update(over)
    lines = ["BEGIN:VEVENT"] + [f"{k}:{v}" for k, v in fields.items()] + ["END:VEVENT"]
    return "\r\n".join(lines)


def days(instances) -> list[str]:
    return [i.day for i in instances]


class TestLines:
    def test_a_folded_line_is_rejoined(self):
        text = "DESCRIPTION:Week 7 — Fri target 18 km\r\n  (Higdon says 12.9)"
        assert ics.unfold(text) == ["DESCRIPTION:Week 7 — Fri target 18 km (Higdon says 12.9)"]

    def test_folding_can_split_a_word(self):
        """Google folds at 75 octets, not at word boundaries."""
        assert ics.unfold("SUMMARY:Olympic Tr\r\n ack Ride") == ["SUMMARY:Olympic Track Ride"]

    def test_a_quoted_parameter_may_contain_a_colon(self):
        line = ics.parse_line('DTSTART;TZID="Odd:Zone":20261030T050000')
        assert line.name == "DTSTART"
        assert line.params["TZID"] == "Odd:Zone"
        assert line.value == "20261030T050000"

    def test_the_plans_own_punctuation_survives_unescaping(self):
        """The prescription text T36 has to read is full of what gets escaped."""
        raw = r"Week 7\nTue: 8-10 km\; Fri: 18 km\, above Higdon\\"
        assert ics.unescape(raw) == "Week 7\nTue: 8-10 km; Fri: 18 km, above Higdon\\"


class TestWeekly:
    def test_a_weekly_series_lands_on_the_same_weekday(self):
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=WEEKLY;BYDAY=FR;COUNT=3")), QATAR),
            WINDOW_END,
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-06", "2026-11-13"]

    def test_byday_with_several_days_gives_several_a_week(self):
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=WEEKLY;BYDAY=TU,FR;COUNT=4")), QATAR),
            WINDOW_END,
            QATAR,
        )
        # DTSTART is a Friday, so the first Tuesday of that week is behind it and the
        # series opens on the Friday.
        assert days(got) == ["2026-10-30", "2026-11-03", "2026-11-06", "2026-11-10"]

    def test_interval_skips_whole_weeks_rather_than_drifting(self):
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=WEEKLY;BYDAY=FR;INTERVAL=2;COUNT=3")), QATAR),
            WINDOW_END,
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-13", "2026-11-27"]

    def test_until_is_inclusive_of_its_own_instant(self):
        got = ics.expand(
            ics.parse_events(
                feed(event(RRULE="FREQ=WEEKLY;BYDAY=FR;UNTIL=20261113T020000Z")), QATAR
            ),
            WINDOW_END,
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-06", "2026-11-13"]

    def test_the_window_bounds_an_open_ended_rule(self):
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=WEEKLY;BYDAY=FR")), QATAR),
            datetime(2026, 11, 21, tzinfo=ZoneInfo("UTC")),
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-06", "2026-11-13", "2026-11-20"]

    def test_the_window_end_is_an_instant_not_a_date(self):
        """A 05:00 Doha session is 02:00 UTC, so a window ending at midnight UTC on its
        own day excludes it. The caller computes the end in the calendar's zone."""
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=WEEKLY;BYDAY=FR")), QATAR),
            datetime(2026, 11, 20, tzinfo=ZoneInfo("UTC")),
            QATAR,
        )
        assert days(got)[-1] == "2026-11-13"

    def test_count_is_counted_before_the_window_narrows_it(self):
        """`COUNT=5` is five occurrences of the rule, not five of the ones on screen."""
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=WEEKLY;BYDAY=FR;COUNT=5")), QATAR),
            datetime(2026, 11, 10, tzinfo=ZoneInfo("UTC")),
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-06"]


class TestDeletionsAndOverrides:
    def test_an_exdate_removes_one_instance(self):
        got = ics.expand(
            ics.parse_events(
                feed(
                    event(
                        RRULE="FREQ=WEEKLY;BYDAY=FR;COUNT=3",
                        **{"EXDATE;TZID=Asia/Qatar": "20261106T050000"},
                    )
                ),
                QATAR,
            ),
            WINDOW_END,
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-13"]

    def test_several_exdates_may_share_one_line(self):
        got = ics.expand(
            ics.parse_events(
                feed(
                    event(
                        RRULE="FREQ=WEEKLY;BYDAY=FR;COUNT=3",
                        **{"EXDATE;TZID=Asia/Qatar": "20261106T050000,20261113T050000"},
                    )
                ),
                QATAR,
            ),
            WINDOW_END,
            QATAR,
        )
        assert days(got) == ["2026-10-30"]

    def test_a_moved_instance_replaces_the_one_it_moved_from(self):
        """The override keeps the original recurrence id. Using the new time would
        leave the old instance standing and prescribe the session twice."""
        got = ics.expand(
            ics.parse_events(
                feed(
                    event(RRULE="FREQ=WEEKLY;BYDAY=FR;COUNT=2"),
                    event(
                        SUMMARY="DBRC Long Run (moved)",
                        **{
                            "RECURRENCE-ID;TZID=Asia/Qatar": "20261106T050000",
                            "DTSTART;TZID=Asia/Qatar": "20261107T053000",
                            "DTEND;TZID=Asia/Qatar": "20261107T083000",
                        },
                    ),
                ),
                QATAR,
            ),
            WINDOW_END,
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-07"]
        assert got[1].recurrence_id == "20261106T050000"
        assert got[1].summary == "DBRC Long Run (moved)"

    def test_a_cancelled_instance_disappears(self):
        got = ics.expand(
            ics.parse_events(
                feed(
                    event(RRULE="FREQ=WEEKLY;BYDAY=FR;COUNT=3"),
                    event(
                        STATUS="CANCELLED",
                        **{"RECURRENCE-ID;TZID=Asia/Qatar": "20261106T050000"},
                    ),
                ),
                QATAR,
            ),
            WINDOW_END,
            QATAR,
        )
        assert days(got) == ["2026-10-30", "2026-11-13"]


class TestRefusals:
    @pytest.mark.parametrize(
        "rule",
        [
            "FREQ=MONTHLY;BYMONTHDAY=15",
            "FREQ=YEARLY",
            "FREQ=WEEKLY;BYDAY=2FR",
            "FREQ=WEEKLY;BYSETPOS=-1;BYDAY=FR",
            "FREQ=DAILY;BYDAY=FR",
            "FREQ=HOURLY",
        ],
    )
    def test_an_unsupported_rule_is_flagged_not_expanded(self, rule):
        got = ics.expand(ics.parse_events(feed(event(RRULE=rule)), QATAR), WINDOW_END, QATAR)
        assert len(got) == 1
        assert got[0].unsupported_rrule == rule
        assert got[0].day == "2026-10-30"

    def test_a_dropped_part_would_have_multiplied_the_sessions(self):
        """`BYMONTHDAY` narrows a monthly rule to one day. Expanding the rule while
        ignoring the part that narrowed it turns 12 sessions a year into 365, which is
        the specific failure the refusal exists to prevent."""
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=MONTHLY;BYMONTHDAY=15")), QATAR),
            WINDOW_END,
            QATAR,
        )
        assert len(got) == 1

    def test_parse_rrule_names_what_it_did_not_understand(self):
        with pytest.raises(ics.UnsupportedRecurrence) as exc:
            ics.parse_rrule("FREQ=WEEKLY;BYMONTH=3;BYDAY=FR")
        assert "BYMONTH" in str(exc.value)

    def test_a_feed_that_is_not_a_calendar_is_refused(self):
        with pytest.raises(ics.IcsError):
            ics.parse_events("<html>sign in</html>", QATAR)


class TestTimeAndPlace:
    def test_a_reminder_inside_the_event_does_not_become_the_prescription(self):
        """A VALARM carries its own DESCRIPTION. Reading it would replace the week's
        targets with 'Reminder'."""
        raw = (
            "BEGIN:VEVENT\r\nUID:long-run\r\nDTSTART;TZID=Asia/Qatar:20261030T050000\r\n"
            "SUMMARY:DBRC Long Run\r\nDESCRIPTION:Fri target 18 km\r\n"
            "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nTRIGGER:-PT30M\r\n"
            "END:VALARM\r\nEND:VEVENT"
        )
        got = ics.expand(ics.parse_events(feed(raw), QATAR), WINDOW_END, QATAR)
        assert got[0].description == "Fri target 18 km"

    def test_an_all_day_event_keeps_its_date(self):
        got = ics.expand(
            ics.parse_events(
                feed(
                    "BEGIN:VEVENT\r\nUID:race\r\nDTSTART;VALUE=DATE:20270115\r\n"
                    "SUMMARY:Doha Marathon\r\nEND:VEVENT"
                ),
                QATAR,
            ),
            WINDOW_END,
            QATAR,
        )
        assert got[0].day == "2027-01-15"
        assert got[0].start.all_day

    def test_a_utc_timestamp_becomes_the_local_day(self):
        """22:30 UTC on the 29th is 01:30 on the 30th in Doha. Judging that session
        against the 29th's activities would never match."""
        got = ics.expand(
            ics.parse_events(
                feed(
                    "BEGIN:VEVENT\r\nUID:x\r\nDTSTART:20261029T223000Z\r\n"
                    "SUMMARY:Night run\r\nEND:VEVENT"
                ),
                QATAR,
            ),
            WINDOW_END,
            QATAR,
        )
        assert got[0].day == "2026-10-30"

    def test_weekly_recurrence_holds_the_wall_clock_across_a_dst_change(self):
        """Doha has no daylight saving, so this cannot bite the owner — but the app is
        meant to be run by other people, and adding seven absolute days to an aware
        datetime moves a 05:00 session to 04:00 the week the clocks go back."""
        got = ics.expand(
            ics.parse_events(
                feed(
                    "BEGIN:VEVENT\r\nUID:uk\r\nDTSTART;TZID=Europe/London:20261023T050000\r\n"
                    "RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=3\r\nSUMMARY:Long run\r\nEND:VEVENT"
                ),
                LONDON,
            ),
            WINDOW_END,
            LONDON,
        )
        # The UK clocks go back on 25 October 2026.
        assert days(got) == ["2026-10-23", "2026-10-30", "2026-11-06"]
        assert {i.start.naive.hour for i in got} == {5}

    def test_duration_stands_in_for_a_missing_end(self):
        got = ics.expand(
            ics.parse_events(
                feed(
                    "BEGIN:VEVENT\r\nUID:x\r\nDTSTART;TZID=Asia/Qatar:20261030T050000\r\n"
                    "DURATION:PT3H\r\nSUMMARY:Long run\r\nEND:VEVENT"
                ),
                QATAR,
            ),
            WINDOW_END,
            QATAR,
        )
        assert got[0].end is not None
        assert got[0].end.naive.hour == 8

    def test_a_window_start_drops_what_is_behind_it(self):
        got = ics.expand(
            ics.parse_events(feed(event(RRULE="FREQ=WEEKLY;BYDAY=FR;COUNT=4")), QATAR),
            WINDOW_END,
            QATAR,
            window_start=datetime(2026, 11, 10, tzinfo=ZoneInfo("UTC")),
        )
        assert days(got) == ["2026-11-13", "2026-11-20"]
