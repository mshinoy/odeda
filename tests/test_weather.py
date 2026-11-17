"""Open-Meteo weather per activity (`ingest/weather.py`), with a fake transport."""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

import pytest

from odeda.ingest import weather as w

NOW = datetime(2026, 11, 12, 12, 0, tzinfo=timezone.utc)


def _hours(start_hour, rows, day="2026-11-01"):
    """rows: [(temp, speed, direction)] one per consecutive hour from start_hour on 2026-11-01."""
    return {
        "hourly": {
            "time": [f"{day}T{start_hour + i:02d}:00" for i in range(len(rows))],
            "temperature_2m": [r[0] for r in rows],
            "apparent_temperature": [r[0] + 2 for r in rows],
            "relative_humidity_2m": [60 for _ in rows],
            "dew_point_2m": [20 for _ in rows],
            "wind_speed_10m": [r[1] for r in rows],
            "wind_direction_10m": [r[2] for r in rows],
            "wind_gusts_10m": [r[1] * 2 for r in rows],
            "precipitation": [0.0 for _ in rows],
            "cloud_cover": [10 for _ in rows],
        }
    }


class FakeTransport:
    def __init__(self, body=None, error=None):
        self.body, self.error, self.urls = body, error, []

    def get_json(self, url):
        self.urls.append(url)
        if self.error:
            raise self.error
        return self.body


def _activity(store, aid="a1", start="2026-11-01T06:30:00Z", duration=3600, gps=True):
    store.conn.execute(
        "INSERT INTO activities (activity_id, day, start_time_local, start_time_utc, "
        "activity_type, duration_s) VALUES (?, '2026-11-01', '2026-11-01T09:30:00', ?, 'running', ?)",
        (aid, start, duration),
    )
    if gps:
        store.conn.execute(
            "INSERT INTO activity_samples (activity_id, elapsed_s, lat, lon) VALUES (?, 0, 25.3, 51.5)",
            (aid,),
        )
    store.conn.commit()


class TestSummarise:
    def test_each_hour_counts_for_the_part_the_run_covered(self):
        hours, _ = w.fetch_hours(
            FakeTransport(_hours(6, [(20, 10, 0), (30, 10, 0)])), 25.3, 51.5,
            datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc),
            datetime(2026, 11, 1, 7, 30, tzinfo=timezone.utc), NOW,
        )
        out = w.summarise(
            hours, datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc),
            datetime(2026, 11, 1, 7, 30, tzinfo=timezone.utc),
        )
        assert out["temp_c"] == pytest.approx(25.0)  # half in each hour
        assert out["wind_dir_deg"] == pytest.approx(0.0)

    def test_wind_direction_averages_across_north_not_through_south(self):
        hours = [
            {"time": datetime(2026, 11, 1, 6, tzinfo=timezone.utc), "wind_speed_10m": 10, "wind_direction_10m": 350},
            {"time": datetime(2026, 11, 1, 7, tzinfo=timezone.utc), "wind_speed_10m": 10, "wind_direction_10m": 10},
        ]
        out = w.summarise(
            hours, datetime(2026, 11, 1, 6, tzinfo=timezone.utc), datetime(2026, 11, 1, 8, tzinfo=timezone.utc)
        )
        assert out["wind_dir_deg"] == pytest.approx(0.0, abs=0.01) or out["wind_dir_deg"] == pytest.approx(360.0, abs=0.01)

    def test_a_stronger_hour_pulls_the_direction_harder(self):
        hours = [
            {"time": datetime(2026, 11, 1, 6, tzinfo=timezone.utc), "wind_speed_10m": 30, "wind_direction_10m": 90},
            {"time": datetime(2026, 11, 1, 7, tzinfo=timezone.utc), "wind_speed_10m": 3, "wind_direction_10m": 270},
        ]
        out = w.summarise(
            hours, datetime(2026, 11, 1, 6, tzinfo=timezone.utc), datetime(2026, 11, 1, 8, tzinfo=timezone.utc)
        )
        assert out["wind_dir_deg"] == pytest.approx(90.0)

    def test_gusts_are_the_highest_hour_and_rain_is_a_total(self):
        hours = [
            {"time": datetime(2026, 11, 1, 6, tzinfo=timezone.utc), "wind_gusts_10m": 20, "precipitation": 2.0},
            {"time": datetime(2026, 11, 1, 7, tzinfo=timezone.utc), "wind_gusts_10m": 35, "precipitation": 1.0},
        ]
        out = w.summarise(
            hours, datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc), datetime(2026, 11, 1, 7, 30, tzinfo=timezone.utc)
        )
        assert out["gust_kmh"] == 35
        assert out["precip_mm"] == pytest.approx(1.5)

    def test_no_overlapping_hour_is_none(self):
        hours = [{"time": datetime(2026, 11, 2, 6, tzinfo=timezone.utc), "temperature_2m": 20}]
        assert w.summarise(
            hours, datetime(2026, 11, 1, 6, tzinfo=timezone.utc), datetime(2026, 11, 1, 7, tzinfo=timezone.utc)
        ) is None


class TestFetch:
    def test_an_old_activity_uses_the_archive_and_a_recent_one_the_forecast(self, store):
        _activity(store)
        t = FakeTransport(_hours(6, [(25, 12, 45), (26, 12, 45)]))
        got = w.fetch_activity(store, "a1", t, now=NOW)
        assert got["source"] == "archive"
        assert t.urls[0].startswith(w.ARCHIVE_URL)
        q = parse_qs(urlparse(t.urls[0]).query)
        assert q["start_date"] == ["2026-11-01"] and q["wind_speed_unit"] == ["kmh"]

        _activity(store, "a2", start="2026-11-10T06:30:00Z")
        t2 = FakeTransport(_hours(6, [(25, 12, 45), (26, 12, 45)], day="2026-11-10"))
        got2 = w.fetch_activity(store, "a2", t2, now=NOW)
        assert got2["source"] == "forecast"
        assert t2.urls[0].startswith(w.FORECAST_URL)

    def test_the_row_is_stored_and_read_back(self, store):
        _activity(store)
        w.fetch_activity(store, "a1", FakeTransport(_hours(6, [(25, 12, 90), (25, 12, 90)])), now=NOW)
        row = w.weather_for(store, "a1")
        assert row["temp_c"] == pytest.approx(25.0)
        assert row["wind_dir_deg"] == pytest.approx(90.0)
        assert (row["lat"], row["lon"]) == (25.3, 51.5)

    def test_an_indoor_activity_is_left_alone_and_asks_nothing(self, store):
        _activity(store, gps=False)
        t = FakeTransport(_hours(6, [(25, 12, 90)]))
        assert w.fetch_activity(store, "a1", t, now=NOW) is None
        assert t.urls == []

    def test_a_failure_stores_nothing_so_the_next_run_tries_again(self, store):
        _activity(store)
        with pytest.raises(w.WeatherError):
            w.fetch_activity(store, "a1", FakeTransport(error=w.WeatherError("down")), now=NOW)
        assert w.weather_for(store, "a1") is None

    def test_an_answer_without_hours_is_an_error(self, store):
        _activity(store)
        with pytest.raises(w.WeatherError):
            w.fetch_activity(store, "a1", FakeTransport({"error": True}), now=NOW)


class TestSync:
    def test_it_fetches_what_is_missing_newest_first_and_stops_at_the_cap(self, store):
        for i, day in enumerate(("2026-10-01", "2026-10-02", "2026-10-03")):
            _activity(store, f"a{i}", start=f"{day}T06:30:00Z")
        calls = []

        class T:
            def get_json(self, url):
                calls.append(url)
                day = parse_qs(urlparse(url).query)["start_date"][0]
                return _hours(6, [(25, 12, 90), (25, 12, 90)], day=day)

        out = w.sync_weather(store, T(), cap=2, pause_s=0, now=NOW)
        assert out["fetched"] == 2 and out["left"] == 1 and out["state"] == "done"
        assert [parse_qs(urlparse(u).query)["start_date"][0] for u in calls] == ["2026-10-03", "2026-10-02"]
        assert w.sync_weather(store, T(), cap=None, pause_s=0, now=NOW)["fetched"] == 1
        assert w.pending(store, NOW) == []

    def test_a_forecast_row_is_fetched_again_once_the_archive_has_the_day(self, store):
        _activity(store, start="2026-11-10T06:30:00Z")
        body = _hours(6, [(25, 12, 90), (25, 12, 90)], day="2026-11-10")
        w.fetch_activity(store, "a1", FakeTransport(body), now=NOW)
        assert w.weather_for(store, "a1")["source"] == "forecast"
        assert w.pending(store, NOW) == []
        later = datetime(2026, 11, 20, tzinfo=timezone.utc)
        assert w.pending(store, later) == ["a1"]

    def test_a_service_that_stays_down_stops_the_run_and_is_reported(self, store):
        for i in range(w.GIVE_UP_AFTER):
            _activity(store, f"a{i}", start=f"2026-10-0{i + 1}T06:30:00Z")
        out = w.sync_weather(store, FakeTransport(error=w.WeatherError("down")), pause_s=0, now=NOW)
        assert out["state"] == "error" and "down" in out["message"]
        assert out["left"] == w.GIVE_UP_AFTER

    def test_one_timeout_is_retried_and_one_bad_activity_does_not_stop_the_rest(self, store):
        for i, day in enumerate(("2026-10-01", "2026-10-02", "2026-10-03")):
            _activity(store, f"a{i}", start=f"{day}T06:30:00Z")
        calls = []

        class Flaky:
            def get_json(self, url):
                calls.append(url)
                day = parse_qs(urlparse(url).query)["start_date"][0]
                if day == "2026-10-02":
                    raise w.WeatherError("always fails")
                if len(calls) == 1:
                    raise w.WeatherError("timed out once")
                return _hours(6, [(25, 12, 90), (25, 12, 90)], day=day)

        out = w.sync_weather(store, Flaky(), pause_s=0, now=NOW)
        assert out["state"] == "done" and out["fetched"] == 2 and out["left"] == 1
        assert w.weather_for(store, "a0") is not None and w.weather_for(store, "a1") is None


class TestApi:
    @pytest.fixture
    def client(self, settings):
        from fastapi.testclient import TestClient

        from odeda.api.server import create_app
        from odeda.db.store import Store

        with Store.open(settings) as st:
            _activity(st, "a1")
            _activity(st, "a2", gps=False)
            w.fetch_activity(st, "a1", FakeTransport(_hours(6, [(25, 12, 90), (25, 12, 90)])), now=NOW)
        return TestClient(create_app(settings))

    def test_the_reading_of_an_activity(self, client):
        body = client.get("/api/activities/a1/weather").json()["weather"]
        assert body["source"] == "archive"
        assert body["temp_c"] == pytest.approx(25.0)
        assert body["wind_dir_deg"] == pytest.approx(90.0)

    def test_an_indoor_activity_has_none(self, client):
        assert client.get("/api/activities/a2/weather").json() == {"weather": None}

    def test_an_unknown_activity_is_a_404(self, client):
        assert client.get("/api/activities/nope/weather").status_code == 404
