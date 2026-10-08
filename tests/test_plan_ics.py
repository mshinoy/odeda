"""Subscribing to the plan calendar, without a calendar.

Everything here runs against a fake transport. The feed is one person's private Google
address and cannot be in a test, so the only way to know this is right before it meets a
real one is to drive the whole path — fetch, 304, a reset address, a deleted series —
against handcrafted bodies. `test_fitbit_auth.py` does the same for Google Health.
"""

from __future__ import annotations

from datetime import date

import pytest

from garmin_analytics.ingest import plan_ics

URL = "https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-s3cr3t/basic.ics"
TODAY = date(2026, 11, 1)


def feed(*events: str) -> str:
    body = "\r\n".join(events)
    return f"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Google//EN\r\n{body}\r\nEND:VCALENDAR\r\n"


FRIDAY_SERIES = (
    "BEGIN:VEVENT\r\nUID:dbrc-long-run\r\n"
    "DTSTART;TZID=Asia/Qatar:20261030T050000\r\nDTEND;TZID=Asia/Qatar:20261030T080000\r\n"
    "RRULE:FREQ=WEEKLY;BYDAY=FR;COUNT=3\r\n"
    "SUMMARY:DBRC Long Run\r\nDESCRIPTION:Week 1 — Fri target 14-15 km\r\nEND:VEVENT"
)

SATURDAY_SERIES = (
    "BEGIN:VEVENT\r\nUID:conversational-run\r\n"
    "DTSTART;TZID=Asia/Qatar:20261031T060000\r\nDTEND;TZID=Asia/Qatar:20261031T070000\r\n"
    "RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=3\r\n"
    "SUMMARY:DBRC Conversational Run\r\nEND:VEVENT"
)


class FakeTransport:
    """Answers a queue of responses, and records what it was asked."""

    def __init__(self, *responses: plan_ics.FeedResponse) -> None:
        self.responses = list(responses)
        self.requests: list[tuple[str, dict[str, str]]] = []

    def get(self, url: str, headers):
        self.requests.append((url, dict(headers)))
        if not self.responses:
            raise AssertionError("the transport was called more often than expected")
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def ok(body: str, **headers: str) -> plan_ics.FeedResponse:
    return plan_ics.FeedResponse(200, {"Content-Type": "text/calendar; charset=UTF-8", **headers}, body)


@pytest.fixture
def subscribed(store):
    plan_ics.set_source(store, URL, label="Training")
    return store


class TestSource:
    def test_a_calendar_can_be_subscribed_and_read_back(self, store):
        plan_ics.set_source(store, URL, label="Training")
        source = plan_ics.get_source(store)
        assert source is not None
        assert source["url"] == URL
        assert source["label"] == "Training"

    def test_subscribing_again_replaces_rather_than_accumulates(self, store):
        plan_ics.set_source(store, URL)
        plan_ics.set_source(store, URL.replace("s3cr3t", "new-s3cr3t"))
        assert store.scalar("SELECT COUNT(*) FROM plan_sources") == 1

    def test_something_that_is_not_a_url_is_refused(self, store):
        with pytest.raises(plan_ics.PlanFeedError):
            plan_ics.set_source(store, "paste the secret address here")

    def test_the_secret_is_not_recoverable_from_the_masked_form(self):
        masked = plan_ics.mask_url(URL)
        assert "s3cr3t" not in masked
        assert masked.startswith("https://calendar.google.com/")
        assert masked.endswith("basic.ics")

    def test_dropping_the_calendar_keeps_what_it_prescribed(self, subscribed):
        """A finished week is still a week the owner trained."""
        plan_ics.sync_plan(subscribed, FakeTransport(ok(feed(FRIDAY_SERIES))), today=TODAY)
        plan_ics.clear_source(subscribed)
        assert subscribed.scalar("SELECT COUNT(*) FROM plan_sources") == 0
        assert subscribed.scalar("SELECT COUNT(*) FROM plan_sessions") == 3
        assert subscribed.scalar(
            "SELECT COUNT(*) FROM plan_sessions WHERE withdrawn_at IS NULL"
        ) == 0


class TestSync:
    def test_a_series_becomes_one_session_per_week(self, subscribed):
        result = plan_ics.sync_plan(subscribed, FakeTransport(ok(feed(FRIDAY_SERIES))), today=TODAY)
        assert result["status"] == "ok"
        assert result["sessions"] == 3
        rows = plan_ics.sessions(subscribed)
        assert [r["day"] for r in rows] == ["2026-10-30", "2026-11-06", "2026-11-13"]
        assert rows[0]["title"] == "DBRC Long Run"
        assert rows[0]["start_local"] == "2026-10-30T05:00:00"
        assert rows[0]["end_local"] == "2026-10-30T08:00:00"

    def test_each_week_is_its_own_row_so_it_can_hold_its_own_target(self, subscribed):
        plan_ics.sync_plan(subscribed, FakeTransport(ok(feed(FRIDAY_SERIES))), today=TODAY)
        ids = subscribed.query("SELECT recurrence_id FROM plan_sessions ORDER BY day")
        assert [r["recurrence_id"] for r in ids] == [
            "20261030T050000",
            "20261106T050000",
            "20261113T050000",
        ]

    def test_syncing_twice_changes_nothing(self, subscribed):
        transport = FakeTransport(ok(feed(FRIDAY_SERIES)), ok(feed(FRIDAY_SERIES)))
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        second = plan_ics.sync_plan(subscribed, transport, today=TODAY)
        assert second["withdrawn"] == 0
        assert subscribed.scalar("SELECT COUNT(*) FROM plan_sessions") == 3

    def test_an_unchanged_feed_is_a_success_with_no_work(self, subscribed):
        transport = FakeTransport(
            ok(feed(FRIDAY_SERIES), ETag='W/"v1"'),
            plan_ics.FeedResponse(304, {}, ""),
        )
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        result = plan_ics.sync_plan(subscribed, transport, today=TODAY)
        assert result["status"] == "unchanged"
        assert transport.requests[1][1]["If-None-Match"] == 'W/"v1"'
        assert plan_ics.get_source(subscribed)["last_error"] is None

    def test_the_raw_feed_is_archived(self, subscribed):
        plan_ics.sync_plan(subscribed, FakeTransport(ok(feed(FRIDAY_SERIES))), today=TODAY)
        raw = subscribed.raw_documents("plan")
        assert len(raw) == 1
        assert "DBRC Long Run" in raw[0]["payload"]


class TestWithdrawal:
    def test_a_deleted_series_keeps_its_past_but_leaves_the_plan(self, subscribed):
        """What happened on 2026-09-19: the Saturday club run was deleted and Google
        took a year of past instances with it. The rows stay, stamped."""
        transport = FakeTransport(
            ok(feed(FRIDAY_SERIES, SATURDAY_SERIES)),
            ok(feed(FRIDAY_SERIES)),
        )
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        assert subscribed.scalar("SELECT COUNT(*) FROM plan_sessions") == 6

        result = plan_ics.sync_plan(subscribed, transport, today=TODAY)
        assert result["withdrawn"] == 3
        assert subscribed.scalar("SELECT COUNT(*) FROM plan_sessions") == 6
        live = [r["title"] for r in plan_ics.sessions(subscribed)]
        assert set(live) == {"DBRC Long Run"}
        stamped = subscribed.query(
            "SELECT day FROM plan_sessions WHERE withdrawn_at IS NOT NULL ORDER BY day"
        )
        assert [r["day"] for r in stamped] == ["2026-10-31", "2026-11-07", "2026-11-14"]

    def test_a_restored_series_comes_back_rather_than_duplicating(self, subscribed):
        transport = FakeTransport(
            ok(feed(FRIDAY_SERIES, SATURDAY_SERIES)),
            ok(feed(FRIDAY_SERIES)),
            ok(feed(FRIDAY_SERIES, SATURDAY_SERIES)),
        )
        for _ in range(3):
            plan_ics.sync_plan(subscribed, transport, today=TODAY)
        assert subscribed.scalar("SELECT COUNT(*) FROM plan_sessions") == 6
        assert subscribed.scalar(
            "SELECT COUNT(*) FROM plan_sessions WHERE withdrawn_at IS NULL"
        ) == 6

    def test_an_edited_description_is_marked_for_re_reading(self, subscribed):
        """The owner rewrites a week's target after a bad Friday. The stored prose has
        to follow, and the prose parser has to be told to look again."""
        edited = FRIDAY_SERIES.replace("Fri target 14-15 km", "Fri target 12 km (easy)")
        transport = FakeTransport(ok(feed(FRIDAY_SERIES)), ok(feed(edited)))
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        subscribed.conn.execute("UPDATE plan_sessions SET parse_status = 'ok'")
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        rows = plan_ics.sessions(subscribed)
        assert rows[0]["description"] == "Week 1 — Fri target 12 km (easy)"
        assert rows[0]["parse_status"] == "pending"

    def test_a_sync_does_not_discard_what_the_prose_parser_read(self, subscribed):
        """T36 fills sport, kind and the distances. A re-sync must leave them alone, or
        a correction the owner made survives exactly until the next six-hourly run."""
        transport = FakeTransport(ok(feed(FRIDAY_SERIES)), ok(feed(FRIDAY_SERIES)))
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        subscribed.conn.execute(
            "UPDATE plan_sessions SET sport = 'running', kind = 'long', "
            "planned_min_m = 14000, planned_max_m = 15000"
        )
        subscribed.conn.commit()
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        row = plan_ics.sessions(subscribed)[0]
        assert (row["sport"], row["kind"]) == ("running", "long")
        assert (row["planned_min_m"], row["planned_max_m"]) == (14000, 15000)


class TestFailures:
    def test_a_reset_address_says_so_instead_of_showing_an_empty_plan(self, subscribed):
        """A revoked private address redirects to a sign-in page, which arrives as a
        perfectly good 200 full of HTML and parses as zero sessions."""
        html = plan_ics.FeedResponse(200, {"Content-Type": "text/html"}, "<html>Sign in</html>")
        with pytest.raises(plan_ics.PlanFeedError, match="not a calendar"):
            plan_ics.sync_plan(subscribed, FakeTransport(html), today=TODAY)
        assert "reset" in plan_ics.get_source(subscribed)["last_error"]

    def test_a_404_is_explained_in_the_owners_terms(self, subscribed):
        gone = plan_ics.FeedResponse(404, {}, "")
        with pytest.raises(plan_ics.PlanFeedError, match="private address was reset"):
            plan_ics.sync_plan(subscribed, FakeTransport(gone), today=TODAY)

    def test_a_failed_sync_leaves_the_last_good_plan_in_place(self, subscribed):
        transport = FakeTransport(ok(feed(FRIDAY_SERIES)), plan_ics.FeedResponse(404, {}, ""))
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        with pytest.raises(plan_ics.PlanFeedError):
            plan_ics.sync_plan(subscribed, transport, today=TODAY)
        assert len(plan_ics.sessions(subscribed)) == 3

    def test_a_recovered_feed_clears_the_error(self, subscribed):
        transport = FakeTransport(plan_ics.FeedResponse(404, {}, ""), ok(feed(FRIDAY_SERIES)))
        with pytest.raises(plan_ics.PlanFeedError):
            plan_ics.sync_plan(subscribed, transport, today=TODAY)
        plan_ics.sync_plan(subscribed, transport, today=TODAY)
        assert plan_ics.get_source(subscribed)["last_error"] is None

    def test_no_calendar_subscribed_is_a_skip_not_a_failure(self, store):
        assert plan_ics.sync_plan(store, FakeTransport(), today=TODAY)["status"] == "skipped"

    def test_an_unsupported_rule_is_counted_and_flagged(self, subscribed):
        monthly = (
            "BEGIN:VEVENT\r\nUID:weigh-in\r\nDTSTART;TZID=Asia/Qatar:20261101T070000\r\n"
            "RRULE:FREQ=MONTHLY;BYMONTHDAY=1\r\nSUMMARY:Weigh-in\r\nEND:VEVENT"
        )
        result = plan_ics.sync_plan(subscribed, FakeTransport(ok(feed(monthly))), today=TODAY)
        assert result["unsupported"] == 1
        row = plan_ics.sessions(subscribed)[0]
        assert row["parse_status"] == "unsupported_rrule"
