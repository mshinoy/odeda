# What it does, in detail

Everything below is computed by the backend and served by the API. The short version is in the [README](../README.md#what-you-get).

## Routes and maps

This is the part that does not exist elsewhere. Garmin shows you 163 unrelated
activities; what you actually have is **one route you have run 163 times**.

* **Clustering.** Tracks are resampled to a fixed number of points *by distance*, so
  a slow run and a fast run of the same loop line up. Two tracks are compared by
  symmetric path overlap — the fraction of each lying within 45 m of the other,
  taking the worse of the two, which is what stops a 5 km out-and-back being
  swallowed by the 10 km route that contains it.
* **Clustering gets some wrong, so you can fix it.** Rename, merge, split, or move a
  single activity. A route you have touched is *pinned* and never re-filed
  automatically.
* **Segment analysis** — the headline. Each attempt is split into fixed segments
  (200 m / 500 m / 1 km depending on route length), and each segment's speed is
  divided by *that attempt's own average* before aggregating. So the profile shows
  where **the route** is fast or slow rather than which days were, with median HR,
  gradient and cadence alongside.
* **Map data.** Per-activity tracks, a two-attempt comparison, a lifetime heatmap
  aggregated server-side onto a grid, and per-activity streams (`/streams`) as one
  column per channel with one entry per sample — lat/lon are null where there was no
  GPS, so a map and a chart index the same arrays.
* **Indoor activities degrade gracefully.** A treadmill run has no route and no
  track, and everything else still works.

## Your edits survive every sync

Garmin gets things wrong. The design point:

```
activities   ← what Garmin said.   A sync rewrites this freely.
overrides    ← what you said.      Nothing in the sync path touches it.
v_activities ← COALESCE(override, garmin_value).  Everything reads this.
```

A sync *cannot* clobber an edit, because there is no code path where it would even
look at the overrides table. Every edit is timestamped and revertible to the value
Garmin supplied. Editable: title, activity type, notes, RPE, private, and
exclude-from-stats — for the time you left the watch running in the car.

Excluding an activity removes it from *every* statistic, not just the obvious ones:
the training-load curve, the records wall, the lifetime totals, the streaks, the
weekly running volume and your shoes' mileage. Retyping a walk as a run moves it
between the per-sport totals everywhere for the same reason — everything reads the
same edit-resolved view.

Adding another editable field is an entry in [a registry](../odeda/db/fields.py)
plus the matching attribute on the API's response model; the view DDL, validation and
the `/api/fields` description an editor is built from are generated from the registry.
See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-an-editable-field).

## Gear

Shoes, bikes, straps — brand, model, nickname, purchase date, an initial distance
offset for mileage they already had, and a retirement threshold with a warning state.

* Assign gear to **any** activity, retroactively, at any time.
* **Bulk reassign** across a date range and activity type — the only sane way to add
  gear to years of imported history that has none. A dry run tells you how many
  activities it would touch before you commit. By default it replaces an earlier
  assignment of the same kind; `only_unassigned` makes it additive.
* Default gear per activity type, applied to **new** activities only — backfilling
  four years of history with today's shoes would simply be a lie.
* Mileage counts activities you have not excluded from stats, so a bad GPS fix does
  not retire your shoes early.

## Aggregates

Lifetime and per-period, filterable by type, date range and gear: totals, "you have
run 833 times over 3.3 years at an average of 5:42/km", pace / distance / duration
histograms, HR-zone split, day-of-week and time-of-day heatmaps, seasonality,
consistency streaks, a records wall, and year-over-year change on every headline
metric.

Average pace is **distance-weighted** (total distance over total time), not the mean
of per-activity paces — otherwise a 400 m stride counts as much as a 30 km long run.

## And the rest

Training load (TRIMP → CTL/ATL/TSB with ramp-rate warnings), recovery trends against
rolling baselines (RHR, HRV, sleep, Body Battery) with anomaly flags, rolling best
efforts, aerobic decoupling, efficiency factor, VO2max, and a race panel with a
Riegel projection.

Best efforts are extracted from every activity that has a distance stream, but the
records wall and the race projection only read the foot-borne ones. A bike covers
5 km in nine minutes; letting that count as a "5 k PB" makes the wall meaningless
and the Riegel projection — a running formula — absurd. Ask the aggregates for
cycling and you get the cycling records, which is the case where you meant it.
