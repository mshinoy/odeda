"""Rolling baselines and z-scores for the recovery metrics.

The point of this module is the early-warning signal: a resting HR 2σ above its own
60-day baseline, or an HRV 2σ below, is the classic pre-illness / overreaching tell.
Absolute values are useless here — everything is relative to the athlete's own baseline.
"""

from __future__ import annotations

import math
from typing import Iterable, Sequence

BASELINE_DAYS = 60
Z_FLAG = 1.5  # |z| beyond this is surfaced as a deviation

# Direction each metric moves when things are going *well*.
# +1 : higher is better, -1 : lower is better.
METRIC_DIRECTION = {
    "resting_hr": -1,
    "hrv": +1,
    "sleep_score": +1,
    "total_sleep_s": +1,
    "bb_high": +1,
    "stress_avg": -1,
    "bb_low": +1,
}


def mean(values: Sequence[float]) -> float | None:
    vals = [float(v) for v in values if v is not None]
    return sum(vals) / len(vals) if vals else None


def stdev(values: Sequence[float]) -> float | None:
    """Sample standard deviation (n-1). None for fewer than 2 observations."""
    vals = [float(v) for v in values if v is not None]
    if len(vals) < 2:
        return None
    m = sum(vals) / len(vals)
    var = sum((v - m) ** 2 for v in vals) / (len(vals) - 1)
    return math.sqrt(var)


def rolling_mean(series: Sequence[float | None], window: int) -> list[float | None]:
    """Trailing mean over `window` days, ignoring None. None until any data exists."""
    out: list[float | None] = []
    for i in range(len(series)):
        chunk = [v for v in series[max(0, i - window + 1) : i + 1] if v is not None]
        out.append(sum(chunk) / len(chunk) if chunk else None)
    return out


def zscore(value: float | None, baseline: Sequence[float | None]) -> float | None:
    """Z-score of `value` against a baseline sample.

    None when the value is missing or the baseline has no spread — a zero-variance
    baseline cannot say how unusual anything is.
    """
    if value is None:
        return None
    vals = [float(v) for v in baseline if v is not None]
    if len(vals) < 2:
        return None
    m = sum(vals) / len(vals)
    sd = stdev(vals)
    if sd is None or sd < 1e-9:
        return None
    return (float(value) - m) / sd


def series_trend(
    days: Sequence[str],
    values: Sequence[float | None],
    metric: str,
    baseline_days: int = BASELINE_DAYS,
) -> dict[str, object]:
    """Rolling means (7/28/90), current z-score vs a trailing baseline, and a verdict."""
    r7 = rolling_mean(values, 7)
    r28 = rolling_mean(values, 28)
    r90 = rolling_mean(values, 90)

    # Baseline excludes today so today is scored against history, not against itself.
    baseline = values[max(0, len(values) - 1 - baseline_days) : len(values) - 1]
    latest = values[-1] if values else None
    z = zscore(latest, baseline)
    direction = METRIC_DIRECTION.get(metric, +1)

    if z is None:
        verdict = "insufficient data"
    elif abs(z) < Z_FLAG:
        verdict = "normal"
    elif z * direction > 0:
        verdict = "better than baseline"
    else:
        verdict = "worse than baseline"

    return {
        "metric": metric,
        "days": list(days),
        "values": [None if v is None else round(float(v), 2) for v in values],
        "roll7": [None if v is None else round(v, 2) for v in r7],
        "roll28": [None if v is None else round(v, 2) for v in r28],
        "roll90": [None if v is None else round(v, 2) for v in r90],
        "latest": None if latest is None else round(float(latest), 2),
        "baseline_mean": (lambda m: None if m is None else round(m, 2))(mean(baseline)),
        "baseline_sd": (lambda s: None if s is None else round(s, 2))(stdev(baseline)),
        "z": None if z is None else round(z, 2),
        "flagged": bool(z is not None and abs(z) >= Z_FLAG),
        "verdict": verdict,
    }


# ---------------------------------------------------------------------------
# Store-backed
# ---------------------------------------------------------------------------

TREND_METRICS = ["resting_hr", "hrv", "sleep_score", "total_sleep_s", "bb_high", "stress_avg"]


def daily_frame(store, days: int | None = None) -> list[dict[str, object]]:
    sql = "SELECT * FROM v_daily ORDER BY day"
    rows = store.query(sql)
    if days is not None:
        rows = rows[-days:]
    return rows


def compute_trends(store, days: int | None = 180, metrics: Iterable[str] | None = None) -> dict:
    rows = daily_frame(store, days)
    if not rows:
        return {"metrics": {}, "flags": []}
    day_list = [str(r["day"]) for r in rows]
    out: dict[str, object] = {}
    flags: list[dict[str, object]] = []
    for metric in metrics or TREND_METRICS:
        values = [r.get(metric) for r in rows]
        t = series_trend(day_list, values, metric)
        out[metric] = t
        if t["flagged"]:
            flags.append({"metric": metric, "z": t["z"], "verdict": t["verdict"]})
    return {"metrics": out, "flags": flags, "baseline_days": BASELINE_DAYS, "z_threshold": Z_FLAG}
