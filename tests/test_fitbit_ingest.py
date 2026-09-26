"""Fitbit weigh-ins: fetching them, normalising them, and surviving the rate limit.

The numbers that drive the design are worth stating, because they are what make this
module look the way it does. Fitbit allows 150 requests an hour. The owner has years of
history. A day-by-day walk of three years is 1,096 requests — eight hours of mostly
sleeping — and the same three years through the 31-day range form is 36. So the window
size is not a tuning knob; it is the difference between a backfill that finishes over
lunch and one that does not finish.

What is pinned here:

  * windows are inclusive at both ends and never exceed what the endpoint accepts;
  * raw-first, so a re-parse never needs a re-fetch;
  * the day with several readings keeps the earliest (D5), and the sentinel 23:59:59
    that Fitbit uses for a manual entry does not count as the latest reading;
  * a 429 stops the run with its place kept, instead of throwing away the windows that
    already landed;
  * the watermark advances only behind data that has actually been written, and a
    re-sync re-reads behind it, because Fitbit lets a reading be edited after the fact.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from garmin_analytics.ingest import fitbit as F
from garmin_analytics.ingest import fitbit_sync as FS
from garmin_analytics.ingest import normalize as norm
from test_fitbit_auth import CREDS, FakeTransport, response


def weight_log(*records) -> dict:
    return {"weight": list(records)}


def reading(day: str, kg: float, *, fat=None, bmi=None, time="07:38:14", source="Aria") -> dict:
    """One record in the shape Fitbit documents for the weight log."""
    record = {
        "date": day,
        "logId": abs(hash(day + time)) % 10**13,
        "source": source,
        "time": time,
        "weight": kg,
    }
    if fat is not None:
        record["fat"] = fat
    if bmi is not None:
        record["bmi"] = bmi
    return record


def a_client(tmp_path, *replies, now=1_000_000.0):
    transport = FakeTransport(*replies)
    return (
        F.FitbitClient(
            CREDS,
            F.Tokens("access-1", "refresh-1", expires_at=now + 28800, user_id="ABC"),
            tmp_path,
            transport=transport,
            clock=lambda: now,
        ),
        transport,
    )


# ---------------------------------------------------------------------------


class TestNormalising:
    def test_a_weigh_in_becomes_a_row(self):
        rows = norm.normalize_fitbit_weight(
            weight_log(reading("2026-03-01", 76.4, fat=18.2, bmi=23.85))
        )
        assert rows == [
            {"day": "2026-03-01", "weight_kg": 76.4, "body_fat_pct": 18.2, "bmi": 23.85}
        ]

    def test_the_earliest_reading_of_the_day_wins(self):
        """D5. Keeping the last would compare a 07:00 reading against a 21:00 one and
        call the 1.2 kg of dinner between them a trend."""
        rows = norm.normalize_fitbit_weight(
            weight_log(
                reading("2026-03-01", 77.6, time="21:04:00"),
                reading("2026-03-01", 76.4, time="07:02:11"),
                reading("2026-03-01", 76.9, time="12:30:00"),
            )
        )
        assert [r["weight_kg"] for r in rows] == [76.4]

    def test_a_manual_entry_does_not_masquerade_as_the_last_reading(self):
        """Fitbit sets `time` to 23:59:59 when an entry was logged without one. Sorted
        as a clock time that is the latest reading of the day; it is really no time at
        all, so it goes last in the ordering and only wins when it is alone."""
        rows = norm.normalize_fitbit_weight(
            weight_log(
                reading("2026-03-01", 80.0, time="23:59:59", source="API"),
                reading("2026-03-01", 76.4, time="06:55:00"),
            )
        )
        assert rows[0]["weight_kg"] == 76.4

    def test_a_manual_entry_alone_is_still_a_reading(self):
        rows = norm.normalize_fitbit_weight(
            weight_log(reading("2026-03-01", 80.0, time="23:59:59", source="API"))
        )
        assert rows[0]["weight_kg"] == 80.0

    def test_a_weight_without_a_fat_measurement_does_not_invent_a_zero(self):
        """A manual weight entry has no body fat. Writing 0 % would put a lean-mass
        line through the athlete's entire body weight."""
        rows = norm.normalize_fitbit_weight(weight_log(reading("2026-03-01", 76.4)))
        assert rows[0]["body_fat_pct"] is None

    def test_days_come_back_in_order(self):
        rows = norm.normalize_fitbit_weight(
            weight_log(
                reading("2026-03-03", 76.0),
                reading("2026-03-01", 76.4),
                reading("2026-03-02", 76.2),
            )
        )
        assert [r["day"] for r in rows] == ["2026-03-01", "2026-03-02", "2026-03-03"]

    def test_a_bare_list_is_accepted_so_the_export_path_shares_this_function(self):
        rows = norm.normalize_fitbit_weight([reading("2026-03-01", 76.4)])
        assert rows[0]["weight_kg"] == 76.4

    @pytest.mark.parametrize("payload", [{}, {"weight": None}, [], None, {"weight": [1, 2]}])
    def test_nothing_usable_is_no_rows_rather_than_an_exception(self, payload):
        assert norm.normalize_fitbit_weight(payload) == []

    def test_a_record_without_a_weight_is_dropped(self):
        assert norm.normalize_fitbit_weight(weight_log({"date": "2026-03-01"})) == []


class TestWindows:
    def test_a_window_is_inclusive_at_both_ends(self):
        """31 days means the 1st to the 31st. `start + 31 days` is 32 days and a 400."""
        spans = FS.windows(date(2026, 1, 1), date(2026, 1, 31))
        assert spans == [(date(2026, 1, 1), date(2026, 1, 31))]
        assert (spans[0][1] - spans[0][0]).days + 1 == FS.WINDOW_DAYS

    def test_a_span_splits_without_gaps_or_overlaps(self):
        spans = FS.windows(date(2026, 1, 1), date(2026, 4, 15))
        assert spans[0][0] == date(2026, 1, 1)
        assert spans[-1][1] == date(2026, 4, 15)
        for earlier, later in zip(spans, spans[1:]):
            assert (later[0] - earlier[1]).days == 1
        assert all((b - a).days + 1 <= FS.WINDOW_DAYS for a, b in spans)

    def test_three_years_is_about_thirty_six_calls(self):
        """The whole argument for the range form, as a number.

        1,096 days at one call a day against 36 at 31 days a call: 150 an hour makes the
        first an eight-hour job and the second a two-minute one.
        """
        spans = FS.windows(date(2023, 9, 26), date(2026, 9, 26))
        assert 35 <= len(spans) <= 37

    def test_one_day_is_one_window(self):
        assert FS.windows(date(2026, 1, 5), date(2026, 1, 5)) == [
            (date(2026, 1, 5), date(2026, 1, 5))
        ]

    def test_an_end_before_the_start_is_no_work(self):
        assert FS.windows(date(2026, 2, 1), date(2026, 1, 1)) == []


class TestSync:
    def test_it_writes_rows_and_archives_the_payload_first(self, store, tmp_path):
        payload = weight_log(
            reading("2026-01-02", 76.4, fat=18.2, bmi=23.85),
            reading("2026-01-09", 76.1, fat=18.0, bmi=23.75),
        )
        client, transport = a_client(tmp_path, response(200, payload))
        result = FS.sync_body(
            store, client,
            start=date(2026, 1, 1), end=date(2026, 1, 20),
            sleep=lambda _s: None,
        )

        assert result["state"] == "done"
        assert result["days_written"] == 2
        assert transport.calls[0]["url"].endswith(
            "/1/user/-/body/log/weight/date/2026-01-01/2026-01-20.json"
        )
        rows = store.query("SELECT day, weight_kg, body_fat_pct FROM body_composition ORDER BY day")
        assert [r["day"] for r in rows] == ["2026-01-02", "2026-01-09"]
        assert rows[0]["weight_kg"] == 76.4

        raw = store.raw_documents(FS.ENDPOINT)
        assert len(raw) == 1
        assert raw[0]["source"] == "fitbit"
        # The ref key is the window that was asked for, so a re-run dedupes on it.
        assert raw[0]["ref_key"] == "2026-01-01:2026-01-20"
        # Every row points at the archived document it came from.
        assert store.scalar("SELECT COUNT(*) FROM body_composition WHERE raw_id IS NULL") == 0

    def test_running_it_twice_changes_nothing(self, store, tmp_path):
        payload = weight_log(reading("2026-01-02", 76.4))
        for _ in range(2):
            client, _ = a_client(tmp_path, response(200, payload))
            FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20),
                         sleep=lambda _s: None)
        assert store.scalar("SELECT COUNT(*) FROM body_composition") == 1
        assert len(store.raw_documents(FS.ENDPOINT)) == 1

    def test_a_corrected_reading_overwrites_the_old_one(self, store, tmp_path):
        """Fitbit lets a weigh-in be edited after the fact, so the newer fetch wins."""
        client, _ = a_client(tmp_path, response(200, weight_log(reading("2026-01-02", 76.4))))
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20),
                     sleep=lambda _s: None)
        client, _ = a_client(tmp_path, response(200, weight_log(reading("2026-01-02", 75.9))))
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20),
                     sleep=lambda _s: None)
        assert store.scalar("SELECT weight_kg FROM body_composition WHERE day = '2026-01-02'") == 75.9

    def test_the_watermark_only_moves_behind_written_data(self, store, tmp_path):
        client, _ = a_client(
            tmp_path,
            response(200, weight_log(reading("2026-01-02", 76.4))),
            response(200, weight_log(reading("2026-02-03", 76.0))),
        )
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 2, 20),
                     sleep=lambda _s: None)
        assert store.get_watermark(FS.ENDPOINT) == "2026-02-20"

    def test_a_rate_limit_keeps_the_windows_it_already_did(self, store, tmp_path):
        """The failure this exists to prevent: a 429 on window 31 throwing away 30."""
        client, _ = a_client(
            tmp_path,
            response(200, weight_log(reading("2026-01-02", 76.4))),
            response(429, {"errors": [{"message": "Too Many Requests"}]},
                     headers={"fitbit-rate-limit-reset": "900"}),
        )
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 3, 20),
                              sleep=lambda _s: None)

        assert result["state"] == "rate_limited"
        assert result["retry_after_s"] == 900
        assert result["windows_done"] == 1
        assert store.scalar("SELECT COUNT(*) FROM body_composition") == 1
        # And it says where it stopped, so the next run resumes rather than restarts.
        assert store.get_watermark(FS.ENDPOINT) == "2026-01-31"

    def test_it_stops_before_draining_the_hourly_budget(self, store, tmp_path):
        """The budget is shared with the rest of the app. A backfill that spends the
        last request leaves the Settings page unable to render for an hour."""
        client, transport = a_client(
            tmp_path,
            response(200, weight_log(reading("2026-01-02", 76.4)),
                     headers={"fitbit-rate-limit-remaining": str(FS.RESERVE_CALLS)}),
        )
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 6, 1),
                              sleep=lambda _s: None)
        assert result["state"] == "rate_limited"
        assert result["windows_done"] == 1
        assert len(transport.calls) == 1

    def test_a_caller_can_stop_it(self, store, tmp_path):
        client, transport = a_client(tmp_path)
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 6, 1),
                              should_stop=lambda: True, sleep=lambda _s: None)
        assert result["state"] == "stopped"
        assert transport.calls == []

    def test_it_paces_itself_between_windows(self, store, tmp_path):
        """One second a call. The limit is 150 an hour and even ten years of history is
        120 calls, so there is nothing to gain by going faster."""
        slept: list[float] = []
        client, _ = a_client(
            tmp_path,
            response(200, weight_log()),
            response(200, weight_log()),
            response(200, weight_log()),
        )
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 3, 20),
                     sleep=slept.append)
        # Three windows, two gaps: no sleep after the last one.
        assert slept == [FS.PAUSE_S, FS.PAUSE_S]

    def test_an_empty_window_is_not_an_error(self, store, tmp_path):
        client, _ = a_client(tmp_path, response(200, weight_log()))
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20),
                              sleep=lambda _s: None)
        assert result["state"] == "done" and result["days_written"] == 0


class TestResuming:
    def test_a_first_run_starts_at_the_account(self, store):
        assert FS.resume_from(store, date(2019, 5, 1)) == date(2019, 5, 1)

    def test_a_later_run_re_reads_behind_the_watermark(self, store):
        """Not paranoia: a weigh-in can be corrected or back-dated in the Fitbit app,
        and the upsert is keyed by day, so re-reading is free and not re-reading is a
        wrong number that never fixes itself."""
        store.set_watermark(FS.ENDPOINT, "2026-06-30", "ok", None)
        expected = date(2026, 6, 30) - timedelta(days=FS.RESYNC_OVERLAP_DAYS)
        assert FS.resume_from(store, date(2019, 5, 1)) == expected

    def test_a_corrupt_watermark_falls_back_rather_than_crashing(self, store):
        store.set_watermark(FS.ENDPOINT, "not-a-date", "ok", None)
        assert FS.resume_from(store, date(2019, 5, 1)) == date(2019, 5, 1)

    def test_the_account_start_comes_from_the_profile(self, tmp_path):
        client, _ = a_client(tmp_path, response(200, {"user": {"memberSince": "2014-07-19"}}))
        assert FS.account_start(client) == date(2014, 7, 19)

    def test_an_unreadable_profile_does_not_fail_a_backfill(self, tmp_path):
        """A handful of empty windows is a cheaper failure than no backfill at all."""
        client, _ = a_client(tmp_path, response(500, {"errors": [{"message": "boom"}]}))
        assert FS.account_start(client) == FS.EARLIEST_PLAUSIBLE

    def test_a_member_date_before_fitbit_existed_is_clamped(self, tmp_path):
        client, _ = a_client(tmp_path, response(200, {"user": {"memberSince": "1999-01-01"}}))
        assert FS.account_start(client) == FS.EARLIEST_PLAUSIBLE


class TestStatus:
    def test_it_reports_without_talking_to_fitbit(self, store, tmp_path):
        """Opening the Settings page must not spend one of 150 requests."""
        state = FS.status(store, tmp_path)
        assert state["connected"] is False
        assert state["weigh_ins"] == 0
        assert state["last_synced_day"] is None

    def test_it_reports_the_span_of_what_is_stored(self, store, tmp_path):
        client, _ = a_client(
            tmp_path,
            response(200, weight_log(reading("2026-01-02", 76.4), reading("2026-01-20", 76.0))),
        )
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 25),
                     sleep=lambda _s: None)
        F.save_tokens(F.Tokens("a", "r", expires_at=1.0, user_id="ABC123"), tmp_path)

        state = FS.status(store, tmp_path)
        assert state["connected"] is True
        assert state["user_id"] == "ABC123"
        assert state["weigh_ins"] == 2
        assert (state["first_day"], state["last_day"]) == ("2026-01-02", "2026-01-20")
        assert state["last_synced_day"] == "2026-01-25"


class TestTheCommand:
    def test_the_four_actions_parse(self):
        from garmin_analytics import cli

        parser = cli.build_parser()
        for action in ("connect", "sync", "status", "disconnect"):
            args = parser.parse_args(["fitbit", action])
            assert args.action == action and callable(args.func)

    def test_an_unknown_action_is_refused_rather_than_guessed(self):
        from garmin_analytics import cli

        with pytest.raises(SystemExit):
            cli.build_parser().parse_args(["fitbit", "backfill-everything"])

    def test_no_secret_can_be_passed_as_an_argument(self):
        """The same rule the Garmin commands follow: the client secret is read from the
        environment at the point of use and is not a flag anyone can leave in a shell
        history or a process list."""
        from garmin_analytics import cli

        options = cli.build_parser().parse_args(["fitbit", "connect"]).__dict__
        assert "client_secret" not in options and "secret" not in options

    def test_a_missing_credential_is_one_line_not_a_traceback(self, capsys, monkeypatch, tmp_path):
        from garmin_analytics import cli

        monkeypatch.delenv("FITBIT_CLIENT_ID", raising=False)
        monkeypatch.delenv("FITBIT_CLIENT_SECRET", raising=False)
        monkeypatch.setenv("GA_TOKEN_DIR", str(tmp_path))
        args = cli.build_parser().parse_args(["fitbit", "connect"])
        assert cli.cmd_fitbit(args) == 1
        assert "dev.fitbit.com" in capsys.readouterr().err
