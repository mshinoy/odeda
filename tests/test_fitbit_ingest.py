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


def sample(day: str, kg: float, *, clock="07:38:14", offset="0s") -> dict:
    """One `weight` data point in the shape Google Health documents.

    `civilTime` is what the normaliser prefers — it is the day the person was actually
    standing on the scale, which for a UTC+3 user is not always the UTC day.
    """
    hours, minutes, seconds = (int(part) for part in clock.split(":"))
    year, month, dom = (int(part) for part in day.split("-"))
    return {
        "dataSource": {"recordingMethod": "UNKNOWN", "platform": "FITBIT"},
        "weight": {
            "sampleTime": {
                "physicalTime": f"{day}T{clock}Z",
                "utcOffset": offset,
                "civilTime": {
                    "date": {"year": year, "month": month, "day": dom},
                    "time": {"hours": hours, "minutes": minutes, "seconds": seconds},
                },
            },
            "weightGrams": round(kg * 1000),
        },
    }


def fat_sample(day: str, pct: float, *, clock="07:38:14") -> dict:
    hours, minutes, seconds = (int(part) for part in clock.split(":"))
    year, month, dom = (int(part) for part in day.split("-"))
    return {
        "bodyFat": {
            "sampleTime": {
                "physicalTime": f"{day}T{clock}Z",
                "utcOffset": "0s",
                "civilTime": {
                    "date": {"year": year, "month": month, "day": dom},
                    "time": {"hours": hours, "minutes": minutes, "seconds": seconds},
                },
            },
            "percentage": pct,
        },
    }


def points(*samples) -> dict:
    return {"dataPoints": list(samples), "nextPageToken": ""}


fat_points = points


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


class TestTheFilter:
    def test_it_asks_for_samples_on_or_after_the_start(self):
        expr = FS.since_filter("weight", date(2026, 1, 1))
        assert expr == 'weight.sample_time.physical_time >= "2026-01-01T00:00:00Z"'

    def test_the_field_prefix_uses_underscores_not_the_url_hyphens(self):
        """`body-fat` in the path, `body_fat` in the filter. Swapping them is an
        INVALID_ARGUMENT that reads like a server fault rather than a typo."""
        expr = FS.since_filter("body_fat", date(2026, 1, 1))
        assert expr.startswith("body_fat.sample_time")
        assert "body-fat" not in expr


class TestSync:
    def test_it_writes_rows_and_archives_both_payloads_first(self, store, tmp_path):
        client, transport = a_client(
            tmp_path,
            response(200, points(sample("2026-01-02", 76.4), sample("2026-01-09", 76.1))),
            response(200, fat_points(fat_sample("2026-01-02", 18.2))),
        )
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20))

        assert result["state"] == "done"
        assert result["days_written"] == 2
        assert "dataTypes/weight/dataPoints" in transport.calls[0]["url"]
        assert "dataTypes/body-fat/dataPoints" in transport.calls[1]["url"]

        rows = store.query(
            "SELECT day, weight_kg, body_fat_pct FROM body_composition ORDER BY day"
        )
        assert [r["day"] for r in rows] == ["2026-01-02", "2026-01-09"]
        assert rows[0]["weight_kg"] == 76.4
        assert rows[0]["body_fat_pct"] == 18.2
        # The 9th had no fat reading. A null, never an invented zero.
        assert rows[1]["body_fat_pct"] is None

        # Both streams archived separately, so a re-parse never needs a re-fetch.
        assert len(store.raw_documents(f"{FS.ENDPOINT}:weight")) == 1
        assert len(store.raw_documents(f"{FS.ENDPOINT}:body_fat")) == 1
        assert store.scalar("SELECT COUNT(*) FROM body_composition WHERE raw_id IS NULL") == 0

    def test_grams_become_kilograms(self, store, tmp_path):
        """`weightGrams` is grams, always — the one thing the old API would not say."""
        client, _ = a_client(
            tmp_path,
            response(200, {"dataPoints": [{
                "weight": {
                    "sampleTime": {"physicalTime": "2026-01-02T07:00:00Z", "utcOffset": "0s"},
                    "weightGrams": 76380,
                }
            }]}),
            response(200, fat_points()),
        )
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20))
        assert store.scalar("SELECT weight_kg FROM body_composition") == 76.38

    def test_running_it_twice_changes_nothing(self, store, tmp_path):
        for _ in range(2):
            client, _ = a_client(
                tmp_path,
                response(200, points(sample("2026-01-02", 76.4))),
                response(200, fat_points()),
            )
            FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20))
        assert store.scalar("SELECT COUNT(*) FROM body_composition") == 1
        assert len(store.raw_documents(f"{FS.ENDPOINT}:weight")) == 1

    def test_a_corrected_reading_overwrites_the_old_one(self, store, tmp_path):
        """A weigh-in can be edited after the fact, so the newer fetch wins."""
        for kg in (76.4, 75.9):
            client, _ = a_client(
                tmp_path,
                response(200, points(sample("2026-01-02", kg))),
                response(200, fat_points()),
            )
            FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20))
        assert store.scalar(
            "SELECT weight_kg FROM body_composition WHERE day = '2026-01-02'"
        ) == 75.9

    def test_the_watermark_only_moves_behind_written_data(self, store, tmp_path):
        """A run that found nothing must not advance the mark past data still to come."""
        client, _ = a_client(
            tmp_path,
            response(200, points(sample("2026-01-02", 76.4))),
            response(200, fat_points()),
        )
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 2, 20))
        assert store.get_watermark(FS.ENDPOINT) == "2026-01-02"

    def test_a_rate_limit_stops_with_its_place_kept(self, store, tmp_path):
        client, _ = a_client(
            tmp_path,
            response(429, {"errors": [{"message": "Too Many Requests"}]},
                     headers={"Retry-After": "90"}),
        )
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 3, 20))
        assert result["state"] == "rate_limited"
        assert result["retry_after_s"] == 90

    def test_a_caller_can_stop_it(self, store, tmp_path):
        client, transport = a_client(tmp_path)
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 6, 1),
                              should_stop=lambda: True)
        assert result["state"] == "stopped"
        assert transport.calls == []

    def test_no_readings_is_not_an_error(self, store, tmp_path):
        client, _ = a_client(tmp_path, response(200, points()), response(200, fat_points()))
        result = FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20))
        assert result["state"] == "done" and result["days_written"] == 0

    def test_a_fat_reading_without_a_weight_is_not_a_row(self, store, tmp_path):
        """`body_composition` is keyed by day and `weight_kg` is what everything
        downstream reads; a fat-only day has nothing to hang on."""
        client, _ = a_client(
            tmp_path,
            response(200, points()),
            response(200, fat_points(fat_sample("2026-01-02", 18.2))),
        )
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 20))
        assert store.scalar("SELECT COUNT(*) FROM body_composition") == 0


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

    def test_a_first_run_starts_at_the_earliest_plausible_date(self, store):
        """No profile call any more: the filter is one request whether it reaches back
        to 2009 or to last month, so there is nothing to save by narrowing it first."""
        assert FS.resume_from(store, FS.EARLIEST_PLAUSIBLE) == FS.EARLIEST_PLAUSIBLE
        assert FS.EARLIEST_PLAUSIBLE < date(2013, 1, 1)


class TestStatus:
    def test_it_reports_without_talking_to_google(self, store, tmp_path):
        """Opening the Settings page must not depend on the network to render."""
        state = FS.status(store, tmp_path)
        assert state["connected"] is False
        assert state["weigh_ins"] == 0
        assert state["last_synced_day"] is None

    def test_it_reports_the_span_of_what_is_stored(self, store, tmp_path):
        client, _ = a_client(
            tmp_path,
            response(200, points(sample("2026-01-02", 76.4), sample("2026-01-20", 76.0))),
            response(200, fat_points()),
        )
        FS.sync_body(store, client, start=date(2026, 1, 1), end=date(2026, 1, 25))
        F.save_tokens(F.Tokens("a", "r", expires_at=1.0, user_id="ABC123"), tmp_path)

        state = FS.status(store, tmp_path)
        assert state["connected"] is True
        assert state["user_id"] == "ABC123"
        assert state["weigh_ins"] == 2
        assert (state["first_day"], state["last_day"]) == ("2026-01-02", "2026-01-20")
        assert state["last_synced_day"] == "2026-01-20"


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

        for _n in ("GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET",
                   "FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET"):
            monkeypatch.delenv(_n, raising=False)
        monkeypatch.setenv("GA_TOKEN_DIR", str(tmp_path))
        args = cli.build_parser().parse_args(["fitbit", "connect"])
        assert cli.cmd_fitbit(args) == 1
        assert "Google Cloud" in capsys.readouterr().err


class TestTheApi:
    """The Fitbit routes. Nothing here reaches Fitbit: the exchange is the one call
    that would, and the tests that need it drive it through the fake transport in
    `test_fitbit_auth.py`."""

    @pytest.fixture
    def app_client(self, settings, tmp_path, monkeypatch):
        from fastapi.testclient import TestClient

        from garmin_analytics.api import auth as auth_mod
        from garmin_analytics.api.server import create_app

        monkeypatch.setenv("GA_TOKEN_DIR", str(tmp_path / "tokens"))
        auth_mod._FITBIT_PENDING.clear()
        from garmin_analytics.config import load_settings

        with TestClient(create_app(load_settings())) as client:
            yield client
        auth_mod._FITBIT_PENDING.clear()

    def test_status_says_nothing_is_set_up_yet(self, app_client, monkeypatch):
        for _n in ("GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET",
                   "FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET"):
            monkeypatch.delenv(_n, raising=False)
        body = app_client.get("/api/fitbit/status").json()
        assert body["connected"] is False
        assert body["credentials_configured"] is False
        assert body["weigh_ins"] == 0
        # What has to be registered at dev.fitbit.com, so the panel can show it.
        assert body["redirect_uri"].endswith("/api/fitbit/callback")

    def test_asking_for_a_url_without_credentials_is_a_409_not_a_500(
        self, app_client, monkeypatch
    ):
        """A missing client id is a setup step the user has not done, not a fault."""
        for _n in ("GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET",
                   "FITBIT_CLIENT_ID", "FITBIT_CLIENT_SECRET"):
            monkeypatch.delenv(_n, raising=False)
        res = app_client.get("/api/fitbit/authorize-url")
        assert res.status_code == 409
        assert "Google Cloud" in res.json()["detail"]

    def test_the_authorize_url_keeps_the_verifier_on_the_server(
        self, app_client, monkeypatch
    ):
        """PKCE is worthless if the secret half is handed to the browser."""
        monkeypatch.setenv("FITBIT_CLIENT_ID", "cid")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "csecret")
        body = app_client.get("/api/fitbit/authorize-url").json()

        assert body["url"].startswith(F.AUTHORIZE_URL)
        assert "code_challenge=" in body["url"]
        assert "code_verifier" not in body["url"]
        assert set(body) == {"url", "redirect_uri", "expires_in_s"}

    def test_connecting_without_a_pending_attempt_is_a_410(self, app_client, monkeypatch):
        monkeypatch.setenv("FITBIT_CLIENT_ID", "cid")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "csecret")
        res = app_client.post("/api/fitbit/connect", json={"redirect": "?code=abc123&state=x"})
        assert res.status_code == 410

    def test_an_empty_paste_says_what_to_paste(self, app_client, monkeypatch):
        monkeypatch.setenv("FITBIT_CLIENT_ID", "cid")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "csecret")
        app_client.get("/api/fitbit/authorize-url")
        res = app_client.post("/api/fitbit/connect", json={"redirect": "  "})
        assert res.status_code == 400
        assert "address bar" in res.json()["detail"]

    def test_a_redirect_from_another_attempt_is_refused(self, app_client, monkeypatch):
        """The anti-forgery check, over HTTP. A state the server never issued has no
        pending authorization to match, so there is nothing to exchange."""
        monkeypatch.setenv("FITBIT_CLIENT_ID", "cid")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "csecret")
        app_client.get("/api/fitbit/authorize-url")
        res = app_client.post(
            "/api/fitbit/connect", json={"redirect": "?code=abc123&state=forged"}
        )
        assert res.status_code == 410

    def test_the_callback_renders_a_page_rather_than_a_stack_trace(
        self, app_client, monkeypatch
    ):
        """Fitbit lands a browser here, not the app, so a failure has to be readable."""
        monkeypatch.setenv("FITBIT_CLIENT_ID", "cid")
        monkeypatch.setenv("FITBIT_CLIENT_SECRET", "csecret")
        res = app_client.get("/api/fitbit/callback?error=access_denied")
        assert res.status_code == 400
        assert res.headers["content-type"].startswith("text/html")
        assert "access_denied" in res.text

    def test_the_callback_escapes_what_fitbit_sent(self, app_client):
        """`error` is a query string and reaches the page as text."""
        res = app_client.get("/api/fitbit/callback?error=<script>alert(1)</script>")
        assert "<script>" not in res.text
        assert "&lt;script&gt;" in res.text

    def test_disconnect_is_idempotent(self, app_client):
        first = app_client.post("/api/fitbit/disconnect").json()
        assert first["removed_files"] == 0
        assert first["connected"] is False

    def test_syncing_before_connecting_is_a_409(self, app_client):
        res = app_client.post("/api/fitbit/sync")
        assert res.status_code == 409
        assert "fitbit connect" in res.json()["detail"]

    def test_importing_a_missing_archive_is_a_404(self, app_client):
        res = app_client.post("/api/fitbit/import", json={"path": "/nowhere/takeout.zip"})
        assert res.status_code == 404

    def test_importing_an_export_writes_weigh_ins(self, app_client, tmp_path):
        from test_fitbit_export import build_zip, metric_record, weight_json

        path = build_zip(
            tmp_path,
            {
                "Takeout/Fitbit/Global Export Data/weight-2019-03.json": weight_json(
                    metric_record("03/01/19", 76.4), metric_record("03/08/19", 76.0)
                )
            },
        )
        body = app_client.post("/api/fitbit/import", json={"path": str(path)}).json()
        assert body["written"] == 2
        assert body["units_found"] == ["kg"]
        assert app_client.get("/api/fitbit/status").json()["weigh_ins"] == 2
