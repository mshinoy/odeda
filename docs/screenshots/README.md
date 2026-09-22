# Screenshots

Captured on 2026-09-22 from headless Chromium against the synthetic seed
(`scripts/verify.sh` builds the same database). Regenerate with:

```bash
garmin-analytics serve --port 8817 &
chromium-browser --headless --disable-gpu --no-sandbox --hide-scrollbars \
  --virtual-time-budget=9000 --window-size=1280,1400 \
  --screenshot="$HOME/overview.png" "http://127.0.0.1:8817/#overview"
```

Note: a snap-packaged Chromium cannot write into `/tmp`; point `--screenshot`
somewhere under `$HOME`.

| File | Tab |
|---|---|
| `overview.png` | Overview — readiness hero, stats, baseline flags, trends |
| `load.png` | Training Load — CTL/ATL, TSB, daily TRIMP, weekly table |
| `recovery.png` | Sleep & Recovery — baselines, sleep stages, HRV, RHR, Body Battery |
| `activities.png` | Activities — sortable, filterable table |
| `activity-drawer.png` | Activity detail drawer, opened via `#activities/<id>` |
| `performance.png` | Performance — best efforts, decoupling, efficiency factor, VO₂max |
| `race.png` | Race — countdown, Riegel projection, CTL and volume vs target |

The orange banner across the top is the synthetic-data warning. It is absent
once real Garmin data replaces the seed.
