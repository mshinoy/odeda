# Getting your data in

How data reaches the app, what the backfill does, and what to do when Garmin refuses a sign-in. Most people only need the [quickstart](../README.md#quickstart).

Garmin has **no self-serve API for individuals** — the Connect Developer Program is
enterprise-only. So there are three routes in, in order of convenience:

| Path | What it needs | What you get |
|---|---|---|
| Garmin Connect (default) | Your Garmin login | Everything, including sleep, HRV, Body Battery, stress, training readiness |
| Official data export | Garmin's GDPR export ZIP, no credentials | Most of it, as a one-off |
| `.fit` / `.gpx` / `.tcx` | The files themselves | Full per-second streams including GPS |

**The backfill pulls everything, back to the start of your account** — not a recent
window. For a multi-year account that is thousands of requests, so it:

* rate-limits politely and backs off exponentially on HTTP 429;
* **checkpoints after every single activity**, and derives its work queue from the
  database rather than an in-memory list, so killing it at request 4 000 of 6 000
  and re-running resumes at 4 001;
* reports progress, rate and ETA to stdout *and* to `/api/sync/status`;
* is safely re-runnable — archived payloads dedupe on content hash.

`backfill --estimate` gives the request count and a time range before you commit. On
the synthetic 3.3-year seed that was about 7 500 requests and 1¼–3 hours; the range
is derived from the configured per-request delay, and Garmin's real throttling is
undocumented. `backfill --detail-limit 50` fetches fifty activity streams and stops,
which tells you within minutes whether ingestion works at all.

`sync` walks a window of days and records a per-endpoint watermark. If a short test
sync has moved the watermarks to today, a later run resumes from today and skips the
years behind it; `sync --full` re-walks the whole `--days` window instead.

**After the first backfill, the app keeps itself current.** Every 6 hours the server
runs that same incremental sync for Garmin, fetches streams, the watch's laps and any
workout plan for new activities, and pulls Google Health weigh-ins, skipping whichever source is not connected. Best efforts
and routes are recomputed only when something new arrived. The interval is counted
from the last run, which is stored in the database, so a restart does not reset it.
Settings shows how the last run went. `GA_AUTO_SYNC_HOURS` changes the interval, and
`0` turns it off.

Raw payloads are archived **verbatim** before anything is normalised, so improving a
parser never means re-fetching. `odeda renormalize` rebuilds every table
from the archive with no network access at all.

## Signing in to Garmin

`odeda login` (or `POST /api/garmin/login`) takes your email and password,
handles MFA, and writes a token cache to `garmin_tokens.json` in the token directory
(`/data/tokens` in the container), mode 0600. The password is used for the token
exchange and discarded. The refresh token is long-lived, so this is a rare chore.

Garmin decides whether a sign-in looks like a browser before it looks at your
password. The client tries five sign-in routes and falls through on a rate limit or a
bot challenge; a 503 from the API (429 on the CLI) means all five were refused. That
is Garmin refusing the *address*, not the password — from one datacenter host on
2026-09-23 both mobile routes got 429 and both portal routes a 403 Cloudflare
challenge. The 429 lifts on its own. Meanwhile, use the **browser sign-in**, which
depends on no scripted login:

1. `odeda login --signin-url` prints a Garmin sign-in URL. Open it in any
   browser and sign in, including MFA. The page goes blank and the address bar ends
   with `?ticket=ST-…`.
2. `odeda login --ticket` and paste that URL. Tickets are single-use and
   expire in minutes; if one is rejected, sign in again for a fresh one.

Over HTTP: `GET /api/garmin/signin-url`, then `POST /api/garmin/ticket` with
`{"ticket": "…"}`. If you already hold a `garmin_tokens.json` from another machine,
`scripts/install-tokens.sh <dir>` copies it into the running container's volume. A
token cache from the old `garth` client is a different format and will not work.

Needing no login at all: request Garmin's official data export in your account
settings and `odeda import-zip` it. That gets history, not ongoing sync.


## A scale that writes to Fitbit

An Aria, say, is a second source, and the only
one that knows what you weigh. Its data now reaches you through the
[Google Health API](https://developers.google.com/health), which replaces the retiring
Fitbit Web API. Create a **Web application** OAuth client in Google Cloud, enable the
Google Health API on it, put the client ID and secret in the environment as
`GOOGLE_HEALTH_CLIENT_ID` and `GOOGLE_HEALTH_CLIENT_SECRET`, and connect it from
Settings or with `odeda fitbit connect`. See
[docs/google-health-setup.md](google-health-setup.md) for the console steps, including the test-user
allowlist that consent fails without. There is also an offline route that needs no app
at all: `odeda import-fitbit <takeout.zip>` reads a Fitbit export from Google
Takeout. Either way the weigh-ins land in `body_composition` and turn into the
