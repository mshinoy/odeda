"""The weather each activity was done in, from Open-Meteo.

Garmin's sync carries no weather, so it comes from outside, once per activity: the hours
the activity ran, at its first GPS fix, averaged into one row (`activity_weather`) and
kept. Nothing here is asked for twice, so the app does not depend on the service being up.

Two endpoints, because the reanalysis archive (ERA5) lags by about five days:

* **archive** for anything older than `ARCHIVE_LAG_DAYS`; final.
* **forecast** with a start and end date for the recent past, up to 92 days back; the
  models' own analysis of those hours. Such a row is marked `forecast` and is fetched
  again once the archive has the day (`refresh_provisional`).

The fetch sits behind a one-method transport so tests never touch the network, as for
the plan feed. A failure raises `WeatherError` with a message that is safe to show.
"""

from __future__ import annotations

import json
import logging
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
#: ERA5 reaches about five days back; a week keeps clear of the edge.
ARCHIVE_LAG_DAYS = 7
HOURLY = (
    "temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,"
    "wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,cloud_cover"
)
log = logging.getLogger(__name__)

#: Per automatic run; the first backfill drains in a few runs, a new activity is one call.
RUN_CAP = 120
#: A pause between calls, so a backfill is polite to a free service.
PAUSE_S = 0.5
#: A call is tried this many times before that activity is left for the next run.
ATTEMPTS = 3
#: Failures in a row that mean the service is down, not that one answer was bad.
GIVE_UP_AFTER = 5
USER_AGENT = "garmin-analytics (personal, self-hosted)"


class WeatherError(Exception):
    """The weather service could not be reached or answered badly."""


class Transport(Protocol):
    def get_json(self, url: str) -> dict[str, Any]: ...


class UrllibTransport:
    def __init__(self, timeout: float = 30.0) -> None:
        self.timeout = timeout

    def get_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise WeatherError(f"the weather service answered HTTP {exc.code}") from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise WeatherError(f"could not reach the weather service ({exc})") from None


def _as_utc(moment: str) -> datetime:
    return datetime.fromisoformat(moment.replace("Z", "+00:00")).astimezone(timezone.utc)


def endpoint_for(end: datetime, now: datetime) -> tuple[str, str]:
    """(url, source) for an activity that ended at `end`."""
    if now - end > timedelta(days=ARCHIVE_LAG_DAYS):
        return ARCHIVE_URL, "archive"
    return FORECAST_URL, "forecast"


def fetch_hours(
    transport: Transport, lat: float, lon: float, start: datetime, end: datetime, now: datetime
) -> tuple[list[dict[str, Any]], str]:
    """Hourly rows covering [start, end] (UTC), and which source gave them."""
    url, source = endpoint_for(end, now)
    query = urllib.parse.urlencode(
        {
            # Two decimals, about a kilometre: the weather grid is 25 km, and the service
            # never needs to learn where exactly the front door is.
            "latitude": f"{lat:.2f}",
            "longitude": f"{lon:.2f}",
            "start_date": start.date().isoformat(),
            "end_date": end.date().isoformat(),
            "hourly": HOURLY,
            "timezone": "UTC",
            "wind_speed_unit": "kmh",
        }
    )
    body = transport.get_json(f"{url}?{query}")
    hourly = body.get("hourly") if isinstance(body, dict) else None
    if not isinstance(hourly, dict) or not isinstance(hourly.get("time"), list):
        raise WeatherError("the weather service sent no hourly data")
    times = hourly["time"]
    rows: list[dict[str, Any]] = []
    for i, stamp in enumerate(times):
        row: dict[str, Any] = {"time": _as_utc(stamp + "Z")}
        for key, values in hourly.items():
            if key != "time" and isinstance(values, list) and i < len(values):
                row[key] = values[i]
        rows.append(row)
    return rows, source


def _weighted_mean(pairs: list[tuple[float, float]]) -> float | None:
    total = sum(w for _, w in pairs)
    return None if total <= 0 else sum(v * w for v, w in pairs) / total


def summarise(
    hours: list[dict[str, Any]], start: datetime, end: datetime
) -> dict[str, float | None] | None:
    """One reading for [start, end]: each hour counts for the part of it the activity covered.

    The hour stamped 06:00 covers 06:00 to 07:00. A zero-length activity counts the hour
    it began in. Returns None when no hour overlaps (the service had nothing for it).
    """
    if end <= start:
        end = start + timedelta(seconds=1)
    weights: list[tuple[dict[str, Any], float]] = []
    for row in hours:
        begins = row["time"]
        overlap = (min(end, begins + timedelta(hours=1)) - max(start, begins)).total_seconds()
        if overlap > 0:
            weights.append((row, overlap))
    if not weights:
        return None

    def mean(key: str) -> float | None:
        return _weighted_mean([(r[key], w) for r, w in weights if r.get(key) is not None])

    # Wind direction is an angle: average the vectors, each as long as its wind is strong.
    east = north = 0.0
    for row, weight in weights:
        speed, bearing = row.get("wind_speed_10m"), row.get("wind_direction_10m")
        if speed is None or bearing is None:
            continue
        east += math.sin(math.radians(bearing)) * speed * weight
        north += math.cos(math.radians(bearing)) * speed * weight
    direction = None if (east == 0 and north == 0) else math.degrees(math.atan2(east, north)) % 360

    gusts = [r["wind_gusts_10m"] for r, _ in weights if r.get("wind_gusts_10m") is not None]
    rain = [(r["precipitation"], w) for r, w in weights if r.get("precipitation") is not None]
    return {
        "temp_c": mean("temperature_2m"),
        "feels_like_c": mean("apparent_temperature"),
        "humidity_pct": mean("relative_humidity_2m"),
        "dew_point_c": mean("dew_point_2m"),
        "wind_kmh": mean("wind_speed_10m"),
        "wind_dir_deg": direction,
        "gust_kmh": max(gusts) if gusts else None,
        # Millimetres that fell during the run: each hour's total, by the share the run covered.
        "precip_mm": sum(v * (w / 3600.0) for v, w in rain) if rain else None,
        "cloud_pct": mean("cloud_cover"),
    }


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def start_point(store, activity_id: str) -> tuple[float, float] | None:
    """The first GPS fix, or None for an indoor activity."""
    row = store.conn.execute(
        "SELECT lat, lon FROM activity_samples WHERE activity_id = ? AND lat IS NOT NULL "
        "ORDER BY elapsed_s LIMIT 1",
        (activity_id,),
    ).fetchone()
    return None if row is None else (float(row["lat"]), float(row["lon"]))


def weather_for(store, activity_id: str) -> dict[str, Any] | None:
    row = store.conn.execute(
        "SELECT * FROM activity_weather WHERE activity_id = ?", (activity_id,)
    ).fetchone()
    return None if row is None else dict(row)


def fetch_activity(
    store, activity_id: str, transport: Transport | None = None, now: datetime | None = None
) -> dict[str, Any] | None:
    """Look up and store the weather of one activity; None when it has no place or time.

    Raises `WeatherError` if the service fails, leaving the activity without a row so the
    next run tries again.
    """
    row = store.conn.execute(
        "SELECT start_time_utc, duration_s FROM activities WHERE activity_id = ?", (activity_id,)
    ).fetchone()
    point = start_point(store, activity_id)
    if row is None or row["start_time_utc"] is None or point is None:
        return None

    start = _as_utc(row["start_time_utc"])
    end = start + timedelta(seconds=float(row["duration_s"] or 0))
    now = now or _utcnow()
    hours, source = fetch_hours(transport or UrllibTransport(), *point, start, end, now)
    reading = summarise(hours, start, end)
    if reading is None:
        return None

    store.conn.execute(
        "INSERT OR REPLACE INTO activity_weather (activity_id, fetched_at, source, lat, lon, "
        "temp_c, feels_like_c, humidity_pct, dew_point_c, wind_kmh, wind_dir_deg, gust_kmh, "
        "precip_mm, cloud_pct) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            activity_id, now.strftime("%Y-%m-%dT%H:%M:%SZ"), source, point[0], point[1],
            reading["temp_c"], reading["feels_like_c"], reading["humidity_pct"],
            reading["dew_point_c"], reading["wind_kmh"], reading["wind_dir_deg"],
            reading["gust_kmh"], reading["precip_mm"], reading["cloud_pct"],
        ),
    )
    store.conn.commit()
    return weather_for(store, activity_id)


def pending(store, now: datetime | None = None) -> list[str]:
    """Activities to look up, newest first: outdoor ones with no row yet, and rows taken
    from the forecast models that the archive has since replaced."""
    now = now or _utcnow()
    cutoff = (now - timedelta(days=ARCHIVE_LAG_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = store.conn.execute(
        "SELECT a.activity_id FROM activities a "
        "LEFT JOIN activity_weather w ON w.activity_id = a.activity_id "
        "WHERE a.start_time_utc IS NOT NULL "
        "AND EXISTS (SELECT 1 FROM activity_samples s WHERE s.activity_id = a.activity_id "
        "            AND s.lat IS NOT NULL) "
        "AND (w.activity_id IS NULL OR (w.source = 'forecast' AND a.start_time_utc < ?)) "
        "ORDER BY a.start_time_utc DESC",
        (cutoff,),
    ).fetchall()
    return [r["activity_id"] for r in rows]


def sync_weather(
    store,
    transport: Transport | None = None,
    cap: int | None = RUN_CAP,
    pause_s: float = PAUSE_S,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Look up the weather of every activity that lacks it, up to `cap` per run.

    A service failure stops the run (the rest would fail the same way) and is reported;
    what was fetched stays, and the next run carries on from there.
    """
    todo = pending(store, now)
    if not todo:
        return {"state": "done", "message": "Weather up to date.", "fetched": 0, "left": 0}

    batch = todo if cap is None else todo[:cap]
    fetched = failed = in_a_row = 0
    last_error = ""
    for activity_id in batch:
        for attempt in range(ATTEMPTS):
            try:
                if fetch_activity(store, activity_id, transport, now) is not None:
                    fetched += 1
                in_a_row = 0
                break
            except WeatherError as exc:
                last_error = str(exc)
                if attempt + 1 < ATTEMPTS and pause_s:
                    time.sleep(pause_s * 4 * (attempt + 1))
        else:
            failed += 1
            in_a_row += 1
            if in_a_row >= GIVE_UP_AFTER:
                return {
                    "state": "error",
                    "message": f"Weather: {last_error}",
                    "fetched": fetched,
                    "left": len(todo) - fetched,
                }
        if pause_s:
            time.sleep(pause_s)
    left = len(todo) - len(batch) + failed
    note = f" {left} more next time." if left else ""
    return {
        "state": "done",
        "message": f"Weather for {fetched} activit{'y' if fetched == 1 else 'ies'}.{note}",
        "fetched": fetched,
        "left": left,
    }
