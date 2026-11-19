# Configuration, CLI and running it

Settings, commands, backups and the no-Docker route.

## Configuration

**Three of these can be set in Settings instead:** the time zone, resting and maximum heart
rate, and the password. A value saved there wins over `.env`, survives restarts, and "Back to
the defaults" returns to what `.env` says. Changing heart rate recomputes the stored load for
every activity, offline. Editing `APP_PASSWORD` in `.env` afterwards still rotates the password,
because only a *changed* environment value overrides the one chosen in Settings.

Backend settings are documented in [`.env.example`](../.env.example). The ones that matter:

| Variable | Default | Notes |
|---|---|---|
| `APP_PASSWORD` | *(empty)* | **Set this.** Empty means no authentication at all. |
| `GA_COOKIE_SECURE` | `0` | Set to `1` when behind HTTPS. |
| `GA_SEED_DEMO` | `0` | `1` generates synthetic data on first start. |
| `GA_DEMO` | `0` | `1` makes the instance a read-only demo: every change is refused, there is no sign-in, and a banner says the data is synthetic. Use it with `GA_SEED_DEMO=1` for a public demo. |
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
odeda login          authenticate with Garmin Connect (once)
odeda login --signin-url / --ticket    browser sign-in, when Garmin refuses the above
odeda backfill       pull EVERYTHING back to the start of the account
odeda backfill --estimate    size the job before starting it
odeda sync           incremental pull (--full to re-walk the window)
odeda renormalize    re-parse the raw archive, no network
odeda laps           the watch's laps and the workout plans they followed (--reparse: no network)
odeda cluster        (re)group GPS activities into routes
odeda import-zip     load Garmin's official data-export ZIP
odeda import-fit     load .fit files
odeda seed --reset   synthetic data for demos and tests
odeda serve          run the API and the built UI
odeda doctor         environment and data status (no credentials printed)
odeda report         today's readiness, load and race outlook
```

Inside Docker: `docker compose exec app odeda doctor`.

To back up everything — database, raw archive and token cache:

```bash
docker run --rm -v garmin-analytics-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/garmin-backup.tar.gz -C /data .
```


## Running without Docker

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt && pip install -e .

odeda seed --reset      # ~3 years of synthetic data, no account needed
odeda serve             # API on http://127.0.0.1:8808
```

`serve` also serves the built UI from `odeda/ui/`. That directory is a
build artifact, not source: build it with `cd frontend && npm ci && npm run build`.
Without it, every non-API page answers 503 with that hint, and the API works as
normal. For frontend development see [CONTRIBUTING.md](../CONTRIBUTING.md).

For a real account: `odeda login`, then `odeda backfill`.
