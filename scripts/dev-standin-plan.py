"""Load a stand-in training plan into the throwaway development copy.

The owner's real calendar address is a credential and is not in this checkout, so the
plan views cannot be looked at on real data without something to stand in for it. This
writes a Higdon Novice 1 block remapped to the Qatar week — Monday/Tuesday/Wednesday
easy, Friday long, Sunday rest — ending on race day, straight into the copy that
`scripts/dev-real-data.sh` makes.

    GA_DB=~/.cache/garmin-dev/garmin.db GA_DATA_DIR=~/.cache/garmin-dev \
        .venv/bin/python scripts/dev-standin-plan.py

Never point it at the real database: it subscribes a calendar that does not exist.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta

from garmin_analytics.db.store import Store
from garmin_analytics.ingest import plan_ics

RACE_DAY = date(2027, 1, 15)

#: Monday, Tuesday, Wednesday, Friday, in kilometres. Twelve weeks to race day, with
#: the Friday long runs set above the book the way the owner's own plan has them.
WEEKS = [
    (4.8, 4.8, 6.4, 14.0),
    (4.8, 4.8, 6.4, 14.5),
    (4.8, 6.4, 6.4, 16.0),
    (4.8, 6.4, 8.0, 16.5),
    (6.4, 6.4, 8.0, 17.0),
    (6.4, 8.0, 8.0, 18.0),
    (6.4, 8.0, 9.7, 19.0),
    (6.4, 8.0, 9.7, 20.0),
    (4.8, 6.4, 6.4, 12.0),
    (4.8, 4.8, 4.8, 8.0),
    (3.2, 3.2, 3.2, 5.0),
    (3.2, 3.2, 0.0, 21.1),
]


def block(today: date) -> list[tuple[float, float, float, float]]:
    """The twelve-week plan, preceded by enough base weeks to cover `today`.

    A block that starts in the future gives every view its empty state and nothing
    else, which is not what the plan pages need to be looked at on.
    """
    race_monday = RACE_DAY - timedelta(days=RACE_DAY.weekday())
    start_monday = today - timedelta(days=today.weekday() + 7 * 6)
    weeks = (race_monday - start_monday).days // 7 + 1
    base = [(4.0, 4.0, 5.0, 10.0)] * max(weeks - len(WEEKS), 0)
    return (base + WEEKS)[-weeks:]


def feed(today: date | None = None) -> str:
    today = today or date.today()
    weeks = block(today)
    first_monday = RACE_DAY - timedelta(days=4 + 7 * (len(weeks) - 1))
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//garmin-analytics stand-in//EN"]
    for index, prescribed in enumerate(weeks):
        monday = first_monday + timedelta(days=7 * index)
        for offset, km in zip((0, 1, 2, 4), prescribed):
            if km <= 0:
                continue
            day = (monday + timedelta(days=offset)).strftime("%Y%m%d")
            label = "LONG RUN" if offset == 4 else "Run"
            lines += [
                "BEGIN:VEVENT",
                f"UID:standin-{index}-{offset}",
                f"DTSTART;TZID=Asia/Qatar:{day}T050000",
                f"DTEND;TZID=Asia/Qatar:{day}T063000",
                f"SUMMARY:W{index + 1}: {label} {km} km",
                "END:VEVENT",
            ]
        sunday = (monday + timedelta(days=6)).strftime("%Y%m%d")
        lines += [
            "BEGIN:VEVENT",
            f"UID:standin-{index}-rest",
            f"DTSTART;TZID=Asia/Qatar:{sunday}T060000",
            f"DTEND;TZID=Asia/Qatar:{sunday}T063000",
            f"SUMMARY:W{index + 1}: Rest",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"


class StandInTransport:
    def get(self, url: str, headers: dict[str, str]) -> plan_ics.FeedResponse:
        return plan_ics.FeedResponse(200, {"Content-Type": "text/calendar"}, feed())


def main() -> int:
    store = Store.open()
    if store.settings.db_path.name == "garmin.db" and "garmin-dev" not in str(
        store.settings.db_path
    ):
        print(f"Refusing to write to {store.settings.db_path}: use the dev copy.", file=sys.stderr)
        return 1
    plan_ics.set_source(
        store,
        "https://calendar.google.com/calendar/ical/stand-in/private-not-a-real-address/basic.ics",
        "Stand-in plan (development only)",
    )
    print(plan_ics.sync_plan(store, StandInTransport()))
    store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
