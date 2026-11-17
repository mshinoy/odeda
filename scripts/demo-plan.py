#!/usr/bin/env python3
"""Load a neutral demo training plan into a demo instance of Odeda.

The seeded demo data (`GA_SEED_DEMO=1`) has activities but no training plan and no race, so Today,
Train and the race card show "No training plan is connected". This uploads one through the
ordinary plan-upload API (`POST /api/plan/upload`), shaped like the seeded athlete's week
(Tuesday intervals, Wednesday easy, Thursday tempo, Saturday long, Sunday easy) and building to
the Doha Half Marathon on 15 January 2027, with a cut-back week and a two-week taper.

    python3 scripts/demo-plan.py preview   # what it would do, writes nothing
    python3 scripts/demo-plan.py apply     # upload it
    ODEDA_URL=http://127.0.0.1:8002 python3 scripts/demo-plan.py apply

Only for a demo instance: it replaces whatever plan the instance has. The dates are fixed, so
move `mon` and the race week if the demo is rebuilt long after November 2026.
"""
import csv, io, json, os, sys, urllib.error, urllib.request, datetime as dt
D = dt.date
rows = []
def add(day, title, km): rows.append((day.isoformat(), title, km))
mon = D(2026, 10, 19)                      # a Monday, four weeks back
long_km = {0:16, 1:14, 2:16, 3:14, 4:17, 5:18, 6:19, 7:20, 8:16, 9:19, 10:16, 11:10}   # weeks from mon
for w in range(0, 13):
    m = mon + dt.timedelta(weeks=w)
    lk = long_km.get(w)
    taper = w >= 10
    if w == 12:                                                    # race week, Mon Jan 11
        add(m + dt.timedelta(days=1), "Easy run", 5)
        add(m + dt.timedelta(days=3), "Shakeout run", 3)
        add(m + dt.timedelta(days=4), "RACE: Doha Half Marathon", "")
        continue
    add(m + dt.timedelta(days=1), "Interval run", 7 if taper else 9)
    add(m + dt.timedelta(days=2), "Easy run", 7 if taper else 8)
    add(m + dt.timedelta(days=3), "Tempo run", 7 if taper else 9)
    add(m + dt.timedelta(days=5), "Long run", lk)
    # The seeded athlete rides on the Sundays one and three weeks back; the plan says so too,
    # so those rides count as done instead of as a swapped run.
    if w in (0, 2):
        add(m + dt.timedelta(days=6), "Long ride", 40)
    else:
        add(m + dt.timedelta(days=6), "Easy run", 5 if taper else 6)
buf = io.StringIO(); w = csv.writer(buf); w.writerow(["date", "title", "distance_km"])
for r in rows: w.writerow(r)
body = {"content": buf.getvalue(), "effective_day": "2026-10-19", "label": "Demo half marathon plan"}
def call(path):
    req = urllib.request.Request(os.environ.get("ODEDA_URL", "http://127.0.0.1:8002") + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        return {"error": e.code, "body": e.read().decode()[:400]}
print(len(rows), "sessions")
out = call("/api/plan/upload/preview" if sys.argv[1] == "preview" else "/api/plan/upload")
print(json.dumps(out, indent=1)[:900])
