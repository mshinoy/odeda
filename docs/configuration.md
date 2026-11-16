# Configuration, CLI and running it

Settings, commands, backups and the no-Docker route.

## Configuration

Backend settings are documented in [`.env.example`](../.env.example). The ones that matter:

| Variable | Default | Notes |
|---|---|---|
| `APP_PASSWORD` | *(empty)* | **Set this.** Empty means no authentication at all. |
| `GA_COOKIE_SECURE` | `0` | Set to `1` when behind HTTPS. |
| `GA_SEED_DEMO` | `0` | `1` generates synthetic data on first start. |
| `GA_HR_REST` / `GA_HR_MAX` | 52 / 187 | Used by TRIMP and zone maths. |
| `GA_RIDE_TO_RUN` | `0.6` | Share of a ride's heart-rate load that counts toward a missed long run, as running; `0` counts rides for nothing. |
| `GA_AUTO_SYNC_HOURS` | `6` | Hours between automatic syncs; `0` turns them off. |
| `TZ` | `Etc/UTC` | Your IANA zone. Anything anchored on "today" needs it. |

There is deliberately **no** `GARMIN_EMAIL` / `GARMIN_PASSWORD`. Credentials are
exchanged for a token and discarded.

Frontend settings are read by Vite at dev or build time. Locally they live in
[`frontend/.env`](../frontend/.env.example); for the Docker image, put the three map
settings in the root `.env`, where `docker-compose.yml` forwards them as build args:

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://127.0.0.1:8000` | Where the dev server proxies `/api`. |
| `VITE_MAPBOX_TOKEN` | *(empty)* | Set to use Mapbox styles. It is a public token and ends up in the bundle — restrict it by URL in your Mapbox account. |
| `VITE_MAP_STYLE_LIGHT` / `VITE_MAP_STYLE_DARK` | CARTO positron / dark-matter | MapLibre style URLs. |


## CLI

```
garmin-analytics login          authenticate with Garmin Connect (once)
garmin-analytics login --signin-url / --ticket    browser sign-in, when Garmin refuses the above
garmin-analytics backfill       pull EVERYTHING back to the start of the account
garmin-analytics backfill --estimate    size the job before starting it
garmin-analytics sync           incremental pull (--full to re-walk the window)
garmin-analytics renormalize    re-parse the raw archive, no network
garmin-analytics laps           the watch's laps and the workout plans they followed (--reparse: no network)
garmin-analytics cluster        (re)group GPS activities into routes
garmin-analytics import-zip     load Garmin's official data-export ZIP
garmin-analytics import-fit     load .fit files
garmin-analytics seed --reset   synthetic data for demos and tests
garmin-analytics serve          run the API and the built UI
garmin-analytics doctor         environment and data status (no credentials printed)
garmin-analytics report         today's readiness, load and race outlook
```

Inside Docker: `docker compose exec app garmin-analytics doctor`.

To back up everything — database, raw archive and token cache:

```bash
docker run --rm -v garmin-analytics-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/garmin-backup.tar.gz -C /data .
```


## Running without Docker

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && pip install -e .

garmin-analytics seed --reset      # ~3 years of synthetic data, no account needed
garmin-analytics serve             # API on http://127.0.0.1:8808
```

`serve` also serves the built UI from `garmin_analytics/ui/`. That directory is a
build artifact, not source: build it with `cd frontend && npm ci && npm run build`.
Without it, every non-API page answers 503 with that hint, and the API works as
normal. For frontend development see [CONTRIBUTING.md](../CONTRIBUTING.md).

For a real account: `garmin-analytics login`, then `garmin-analytics backfill`.
