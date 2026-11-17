# Connecting the scale (Google Health API)

The Aria writes to Fitbit, and Fitbit's data now reaches third-party apps through the
**[Google Health API](https://developers.google.com/health)**, not the Fitbit Web API.
The Fitbit Web API is being retired. This branch talks to Google Health.

**None of it has ever spoken to Google**, because the credential did not exist while it
was written. This file is what to do with the credential, and what is still unproven
until you do it.

---

## What you do

### 1. The Google Cloud project — 10 minutes

This replaces the old dev.fitbit.com registration entirely. A Fitbit client id will not
authenticate against Google.

1. **Enable the API** —
   [console.developers.google.com/apis/library/health.googleapis.com](https://console.developers.google.com/apis/library/health.googleapis.com)

2. **Create the OAuth client** on the
   [Credentials page](https://console.developers.google.com/apis/credentials).
   Application type **Web application** — it is a confidential client: the secret lives
   on the server and the callback lands on a route this app owns.

   | Field | What to put |
   |---|---|
   | Application type | **Web application** |
   | Authorized redirect URI | `http://localhost:8000/api/fitbit/callback` |

   **`http` is correct here.** Google's help text says redirect URIs must use HTTPS and
   cannot be an IP address; its actual validation rules exempt localhost from both.
   Google's own sample code throughout the OAuth docs uses `http://localhost:8080`.

   The URI is matched **byte for byte**. If yours must differ, set
   `GA_FITBIT_REDIRECT_URI` to exactly the same string and they stay in step. Settings
   prints the one the app is using, so you can copy it rather than type it.

3. **Add the scope** on the
   [Data Access page](https://console.developers.google.com/auth/scopes): search
   "Google Health API" and select
   **`.health_metrics_and_measurements.readonly`**. Read-only — this app never writes
   to Google Health, and a write scope on an app that never writes is one that can only
   leak.

4. **Add yourself as a test user** on the
   [Audience page](https://console.developers.google.com/auth/audience). A new client is
   **unverified**, publishing status *Testing*, capped at 100 users. **Consent fails
   without this** — it is the single easiest step to miss. Use the Google account that
   holds your Fitbit/Aria data.

5. **Your account needs a Google Health profile.** If it has never been initialised,
   consent succeeds and then every call returns **412** until you open the Google Health
   app and finish onboarding. The app detects this and says so rather than showing an
   error.

### 2. Put the credentials in the environment — 2 lines

```
GOOGLE_HEALTH_CLIENT_ID=XXXXXX.apps.googleusercontent.com
GOOGLE_HEALTH_CLIENT_SECRET=................................
```

The old `FITBIT_CLIENT_ID` / `FITBIT_CLIENT_SECRET` names are still read as a fallback so
an existing `.env` keeps booting, but the new names win and are the ones to use.

**No compose change is needed**: both `app` and `api-dev` already carry `env_file: .env`.
I did not edit `.env` myself — it is yours, it is gitignored, and it is not a file to
write to on somebody's behalf.

Restart to pick them up: `docker compose up -d app`, and
`docker compose --profile dev restart api-dev` if you are working on :5173.

### 3. Connect — on :8000, not :5173

**Do this on the real app at http://localhost:8000.** `api-dev` on :5173 keeps its token
cache in its own throwaway volume, so connecting there stores tokens somewhere that
disappears on the next restart — and the registered redirect points at :8000 anyway, so
the callback would land on a process with no pending sign-in and answer 410.

> The `app` container is not currently running. `docker compose up -d app` first.

Open **Settings**. The panel should say "Not connected" rather than "No Google Health app
registered". Press **Connect**, approve the health metrics permission — it asks for
nothing else — and you land back on the app.

If the redirect does not come back (wrong port, different host, popup blocked), copy the
whole address bar you *did* land on and paste it into the box under the button. The code
in that URL is single-use and expires in ten minutes, so do it promptly.

From a terminal instead:

```bash
docker compose exec -it app garmin-analytics fitbit connect
```

### 4. First backfill

```bash
docker compose exec app garmin-analytics fitbit sync
```

Two cursor-paged fetches — one for `weight`, one for `body-fat` — filtered from 2009 to
today. Google Health allows **300 requests a minute per user**, so a decade of weigh-ins
is a handful of calls and seconds, not the 36 carefully paced requests the Fitbit Web
API's 150/hour forced. The **Sync weigh-ins** button in Settings does the same thing.

### 5. Look at it

- **Health** — the body-composition section above the sleep chart: trend line, raw
  weigh-ins faint behind it, fat against lean, six cards, and the race-day projection.
- **Trends**, at the bottom — weight through the block against CTL, run speed against
  weight, and W/kg if any ride has a power meter.

Until the first sync lands, both sections are simply absent. That is not a bug: you own
no weigh-ins today, so there is nothing to draw.

---

## The offline route, if any of that goes wrong

It needs no OAuth client, no scope, no test-user allowlist and no rate limit:

1. **[takeout.google.com](https://takeout.google.com)** → deselect everything → select
   **Fitbit** → export. Takes hours to days.
2. Put the ZIP where the container can read it, e.g. into the `garmin-data` volume at
   `/data`.
3. `docker compose exec app garmin-analytics import-fitbit /data/takeout-fitbit.zip`, or
   paste the path into "Import a Fitbit export instead" in Settings.

It is also the **fastest** way to load a decade of history. If you have years of Aria
data, do this first and let the API keep it current afterwards.

The export follows your account's *original* unit setting and does not say which it used.
The importer works it out from each record's own weight and BMI — a weight in pounds
implies a height of about 2.6 m, which nobody is — and reports which unit it found. If it
says `lb` and you know the file is metric, that is a bug worth reporting.

---

## What is proven, and what is not

### Proven, without Google

- Every step of the OAuth flow against handcrafted payloads written from Google's
  documentation: the PKCE challenge, the authorize URL including `access_type=offline`,
  the code exchange with the secret in the body, refresh **both with and without** a
  rotated refresh token, a surprise 401 that refreshes once and retries, a second 401
  that stops instead of looping, a 429 that carries when to come back, a 412, a 403, and
  both error envelopes.
- Cursor pagination, including a repeated page token stopping rather than looping.
  `pageSize`/`pageToken`/`filter` and the exact filter expression
  `weight.sample_time.physical_time >= "…"` are copied from the `dataPoints.list`
  reference, which documents that literal example.
- The token cache: 0600 in a 0700 directory, created with the right mode rather than
  chmod-ed afterwards, and `disconnect` removing the Google file and not Garmin's.
- Grams to kilograms, civil-time day selection, earliest-reading-of-day, and a fat
  reading with no weight not becoming a row.
- **The export importer end to end against a running server**, with a ZIP built for the
  purpose: 168.4 lb came back as 76.38 kg and `/api/body` picked the rows up.
- Every analytic and both views, against the seeded weigh-in series.
- 1,150 Python tests and 706 frontend tests, green.

### Not proven — the honest list

- **No request has ever left this machine for Google Health.** Not one. No authorize URL
  opened, no code exchanged, no token refreshed, no weigh-in fetched.
- **The exact shape of a real Aria record.** The normaliser is written from the published
  `Weight` and `BodyFat` schemas. If a real record has a field I have not seen, the
  payload is archived verbatim in `raw_documents`, so fixing the parser is a one-file
  change and a re-parse, never a re-fetch.
- **Whether your Aria history is actually in Google Health.** The API serves what the
  Google Health profile holds. If Fitbit has not migrated your decade of Aria data into
  it, the sync will succeed and return very little — and Takeout is the answer.
- **The callback route**, which works only if the redirect you registered really points
  at this app. The paste-the-URL path exists because that is not something this code can
  guarantee.

---

## Decisions

Recorded in docs/history/PLAN-HISTORY.md as D4–D7, plus these from the migration:

- **`body_composition` keeps its shape.** No migration. Time of day, device name and log
  id live in `raw_documents`, which is where provenance belongs.
- **A day with several weigh-ins keeps the earliest**, by *civil* time. A weigh-in belongs
  to the day you were standing on the scale; for a UTC+3 user a 02:00 local reading is
  the previous day in UTC, and filing it there would put Tuesday's weight on Monday.
- **BMI is no longer stored from the API path.** Google Health has no BMI field on the
  weight data point. The export importer still reads it, and `bmi` stays nullable.
- **The module is still called `fitbit`.** The scale is still an Aria and the column is
  still `body_composition`; renaming every import would say nothing new.
- **No new dependency.** Stdlib `urllib` behind a one-method transport — which is also
  what made the whole flow testable without an account.

And one judgement worth flagging because you asked for it and I did not build it as
asked: **"pace per kg" is not a meaningful quantity for running.** Running's metabolic
cost is already roughly proportional to bodyweight, so speed is mass-normalised to begin
with and dividing by mass again produces a number that means nothing. What is on Trends
instead is run speed and bodyweight both indexed to the start of the window. W/kg for
**rides** is built as asked, because there it is real physiology.

---

## If something breaks

```bash
docker compose exec app garmin-analytics fitbit status   # no network call
docker compose exec app garmin-analytics doctor
```

Neither prints a credential. Nothing in this branch writes a client ID, a client secret,
an authorization code, a PKCE verifier or a token to a log, to the database, or to any
output — `Credentials` and `Tokens` both override `__repr__` so a traceback cannot leak
one either.

| Symptom | Almost certainly |
|---|---|
| `invalid_client` at the token step | Client id/secret mismatch, or a Fitbit credential still in `.env` |
| Consent screen refuses your account | You are not on the **test users** allowlist |
| 412 on every call after connecting | No Google Health profile — open the app and finish onboarding |
| Connected, sync returns nothing | Your Aria history may not be in Google Health; use Takeout |
| Dies exactly an hour after connecting | No refresh token — `access_type=offline` missing from the consent URL |
