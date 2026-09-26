# Connecting Fitbit

Everything on the `fitbit` branch is built and tested. **None of it has ever spoken to
Fitbit**, because the credential did not exist while it was written. This file is what
to do with the credential, and what is still unproven until you do it.

---

## What you do tomorrow

### 1. Register the app — 5 minutes

Go to **[dev.fitbit.com/apps](https://dev.fitbit.com/apps)** and register a new
application. Sign in with a **personal Gmail**; Google Workspace accounts are not
supported and the registration will fail on one.

| Field | What to put |
|---|---|
| OAuth 2.0 Application Type | **Personal** |
| Redirect URL | `http://localhost:8000/api/fitbit/callback` |
| Default Access Type | **Read Only** — this app never writes to Fitbit |

The other fields (website, organisation, policy URLs) are required by the form and are
not used by anything here; your own repository URL does for all of them.

The redirect URL is matched **byte for byte**. If yours has to differ — a different
port, a hostname, https — set `GA_FITBIT_REDIRECT_URI` to exactly the same string and
they will stay in step. Settings prints the one the app is currently using, so you can
copy it from there rather than typing it.

You get a **client ID** (six characters) and a **client secret** (a long hex string).

### 2. Put them in the environment — 2 lines

Two lines in the root `.env`:

```
FITBIT_CLIENT_ID=XXXXXX
FITBIT_CLIENT_SECRET=................................
```

That is the whole of it. **No compose change is needed**: both `app` and `api-dev`
already carry `env_file: .env`, so anything in that file reaches the container. I did
not edit `.env` myself — it is yours, it is gitignored, and it is not a file to write
to on somebody's behalf.

Restart to pick them up: `docker compose up -d app`, and
`docker compose --profile dev restart api-dev` if you are working on :5173.

### 3. Connect — on :8000, not :5173

**Do this on the real app at http://localhost:8000.** `api-dev` on :5173 keeps its
token cache in its own throwaway volume, so connecting there stores the tokens
somewhere that disappears on the next restart — and the registered redirect points at
:8000 anyway, so the callback would land on a process with no pending sign-in and
answer 410. Connect on :8000; :5173 will show the weigh-ins on its next restart, when
it takes its fresh copy of the database.

Open **Settings**. The Fitbit panel should now say "Not connected" rather than "No
Fitbit app registered". Press **Connect Fitbit**, approve the **weight** permission —
it asks for nothing else — and you land back on the app, connected.

If the redirect does not come back to the app (wrong port, different host, popup
blocked), copy the whole address bar you *did* land on and paste it into the box under
the button. Same result; the code in that URL is single-use and expires in ten minutes,
so do it promptly.

From a terminal instead:

```bash
docker compose exec -it app garmin-analytics fitbit connect
```

It prints the URL, you approve it, you paste the address back.

### 4. First backfill

```bash
docker compose exec app garmin-analytics fitbit sync
```

It walks from the day your Fitbit account was opened to today, 31 days a request, one
request a second. Three years is about **36 requests** against a budget of **150 an
hour**, so it finishes in under a minute and uses a quarter of one hour's allowance.

If the budget does run out it stops, says so, and keeps its place — run it again and it
resumes rather than restarts. `garmin-analytics fitbit status` shows how far it got.

The **Sync weigh-ins** button in Settings does the same thing.

### 5. Look at it

- **Health** — the body-composition section appears above the sleep chart. Trend line,
  raw weigh-ins faint behind it, fat against lean, six cards, and the race-day
  projection for the Doha half.
- **Trends**, at the bottom — weight through the block against CTL, run speed against
  weight, and W/kg if any ride has a power meter.

Until the first sync lands, both sections are simply absent. That is not a bug: you own
no weigh-ins today, so there is nothing to draw and drawing an empty axis would suggest
otherwise.

---

## The offline route, if any of that goes wrong

It needs no app, no client ID and no rate limit, and it is the fallback if Google
retires the Web API:

1. **[takeout.google.com](https://takeout.google.com)** → deselect everything → select
   **Fitbit** → export. It takes Google hours to days.
2. Put the ZIP where the container can read it, e.g. copy it into the `garmin-data`
   volume mounted at `/data`.
3. `docker compose exec app garmin-analytics import-fitbit /data/takeout-fitbit.zip`,
   or paste the path into "Import a Fitbit export instead" in Settings.

It is also the **fastest** way to load a decade of history, because it touches no API
at all. If you have years of Aria data, do this first and let the API keep it current
afterwards.

One thing it does that is worth knowing about: the export follows your account's
*original* unit setting and does not say which it used. The importer works it out from
each record's own weight and BMI — a weight in pounds implies a height of about 2.6 m,
which nobody is — and reports which unit it found. If it ever says `lb` and you know
the file is metric, that is a bug worth telling me about.

---

## What is proven, and what is not

### Proven, without Fitbit

- Every step of the OAuth flow against handcrafted payloads written from Fitbit's own
  documentation: the PKCE challenge, the authorize URL, the code exchange, refresh
  rotation, a surprise 401 that refreshes once and retries, a second 401 that stops
  instead of looping, a 429 that carries when to come back, and both error envelopes —
  Fitbit's classic `{"errors": [...]}` and Google's `UNAUTHENTICATED`.
- The token cache: 0600 in a 0700 directory, created with the right mode rather than
  chmod-ed afterwards, and `disconnect` removes the Fitbit file and not Garmin's beside
  it.
- The whole ingest path: window splitting, the raw archive, the upserts, the watermark,
  resume, and the rate-limit stop.
- **The export importer end to end against a running server**, with a ZIP built for the
  purpose: 168.4 lb came back as 76.38 kg and `/api/body` picked the rows up.
- Every analytic, and both views, against the seeded weigh-in series.

### Not proven — this is the honest list

- **No request has ever left this machine for Fitbit's servers.** Not one. The
  authorize URL has never been opened, no code has been exchanged, no token has been
  refreshed, and no weigh-in has been fetched.
- **The auth layer is Google's now.** The URLs are still Fitbit's and the data
  endpoints are unchanged, but a 401 comes back in Google's error format pointing at
  developers.google.com. Both shapes are parsed. Which one actually arrives, and
  whether registration at dev.fitbit.com still issues a working client secret at all,
  are the things I could not check.
- **The 31-day date-range form of the weight log.** Fitbit's current documentation page
  shows only the single-date form; the range form is long-standing and widely used, and
  probing it without a token returns 401 before routing, so a live 401 proves nothing
  about whether the path exists. If it has been withdrawn, the sync will fail with a
  clear 400 from Fitbit and the fix is a one-line change of `WINDOW_DAYS` and the path
  in `ingest/fitbit_sync.py` — but a day-by-day walk is 1,096 requests for three years
  against 150 an hour, so in that case use the Takeout import for history.
- **The callback route.** It works only if the redirect you registered really points at
  this app. The paste-the-URL path exists because that is not something this code can
  guarantee.
- **The exact shape of a real Aria record.** The normaliser is written from Fitbit's
  documented fields and handles the awkward cases I know of — several readings in a
  day, the `23:59:59` sentinel for an entry logged without a time, a weight with no fat
  measurement. If a real record has a field I have not seen, the payload is archived
  verbatim in `raw_documents`, so fixing the parser is a one-file change and a
  re-parse, never a re-fetch.

---

## Decisions I took while you were asleep

Recorded in PLAN.md as D4–D7, in short:

- **`body_composition` keeps its shape.** Every Fitbit field has a home in it. Time of
  day, the device name and the log id do not, and they live in `raw_documents`, which is
  where provenance belongs. No migration.
- **A day with several weigh-ins keeps the earliest.** The table is keyed by day and a
  morning reading before food and water is the comparable one; keeping the last would
  mix a 07:00 reading with a 21:00 one and call dinner a trend.
- **No new nav item.** The trend, the fat/lean split, consistency and the race
  projection went on Health; weight against load and per-kg performance went on Trends.
- **No new dependency.** The Fitbit client is stdlib `urllib` behind a one-method
  transport — which is also what made the whole flow testable without an account.

And one judgement worth flagging because you asked for it and I did not build it as
asked: **"pace per kg" is not a meaningful quantity for running.** Running's metabolic
cost is already roughly proportional to bodyweight, so speed is mass-normalised to
begin with and dividing by mass again produces a number that means nothing. What is on
Trends instead is run speed and bodyweight both indexed to the start of the window, so
you can see whether speed improved faster than weight fell without the code inventing a
conversion. W/kg for **rides** is built as asked, because there it is real physiology.

The pace benefit per kilogram on the race projection *is* a heuristic — roughly 2
seconds a mile per pound — and it says so in the field name, the model, and the sentence
under the chart.

---

## If something breaks

```bash
docker compose exec app garmin-analytics fitbit status   # no network call
docker compose exec app garmin-analytics doctor
```

Neither prints a credential. Nothing in this branch writes a client ID, a client
secret, an authorization code, a PKCE verifier or a token to a log, to the database, or
to any output — `Credentials` and `Tokens` both override `__repr__` so a traceback
cannot leak one either.
