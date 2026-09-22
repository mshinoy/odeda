# Handover

What to run in the morning, what will happen, and what could not be tested without
your credentials.

---

## 0. It is already running

I left the container up so you can look at it straight away:

**<http://127.0.0.1:8000>** — the password is the `APP_PASSWORD` line in your local
`.env` (`grep APP_PASSWORD .env`). It is a throwaway placeholder from the build, and
`.env` is gitignored, which is why the value is not written here: this file is going
to GitHub, and a password in a public repo is a default password for every
deployment whose owner did not change it.

It is showing **synthetic demo data** (orange banner at the top). Change that
password, and read step 3 before you connect your real account.

---

## 1. Make it yours (2 minutes)

A `.env` already exists — I created it to run the verification, with a placeholder
password and `GA_SEED_DEMO=1`. Edit it:

```bash
cd ~/.openclaw/workspace/projects/garmin-analytics
$EDITOR .env                 # set APP_PASSWORD to something real
docker compose up -d         # picks up the change
```

Changing `APP_PASSWORD` rotates it and signs out every existing session, by design.
If you would rather start clean: `cp .env.example .env`.

A cold first start takes about a minute — it builds nothing (the image is already
built) but does generate ~3.3 years of demo data. Watch it with
`docker compose logs -f`.

Open **<http://127.0.0.1:8000>** and sign in with your `APP_PASSWORD`.

The orange banner at the top says the data is synthetic. It disappears once real data
replaces it.

---

## 2. Connect your Garmin account

**Settings → Garmin account.** Enter your Garmin email and password and press
**Connect**.

* If your account has multi-factor authentication, the form will say so and show a
  code box. Enter the code from your authenticator (or the email Garmin sends) and
  press Connect again. The challenge expires after 10 minutes; if you miss it, just
  start over.
* Your password is used for exactly one call — the token exchange — and is then
  discarded. What gets stored is garth's OAuth token cache, on the Docker volume at
  `/data/tokens`, mode 0600. It is never written into the image and never logged.
* If it fails, the error from Garmin is shown verbatim. The most likely causes are a
  wrong password, an unrecognised-device email you need to approve first, or Garmin
  having changed their SSO flow (see "What could not be tested" below).

You can also do this from the terminal if you prefer:

```bash
docker compose exec app garmin-analytics login
```

---

## 3. Wipe the demo data before the real backfill

Important: do this, or your real history will sit alongside 1 147 fabricated
activities. Set `GA_SEED_DEMO=0` in `.env` first, then:

```bash
docker compose down
docker volume rm garmin-analytics-data
docker compose up -d
```

That starts from an empty database. You will need to sign in again — the volume held
the session — and connect Garmin again if you had already done so.

**So do this step before step 2 and you only do it once.** The order that saves you
repeating yourself is: look around with the demo data → wipe → connect Garmin →
backfill.

---

## 4. The backfill

**Settings → Sync.** Press **Start full backfill**. Before you do, the page tells you:

* how many days of history it will walk,
* how many activity streams it still needs to fetch,
* an estimated request count and a time range.

For a multi-year account expect **thousands of requests**. On the synthetic 3.3-year
data the estimate was 7 486 requests and **1 h 15 m – 3 h 07 m**. Your account will
differ; the estimate is derived from the configured per-request delay and Garmin's
real throttling is undocumented, so treat the upper bound as optimistic-ish.

You do not have to babysit it:

* Progress, rate and ETA update on the page every two seconds.
* It **checkpoints after every single activity**. Close the laptop, restart the
  container, kill it outright — re-running resumes where it stopped rather than
  starting over. The work queue comes from the database, not from memory.
* Press **Stop** to pause. Press Start again later.
* If it 429s, it backs off exponentially on its own.

Terminal equivalents:

```bash
docker compose exec app garmin-analytics backfill --estimate
docker compose exec app garmin-analytics backfill
docker compose exec app garmin-analytics backfill --detail-limit 50   # a trial run
```

`--detail-limit 50` is worth doing first: it fetches fifty activity streams and
stops, which tells you within a couple of minutes whether ingestion works at all
before you commit to three hours.

---

## 5. After the backfill

**Routes will be auto-clustered.** Go to **Routes & Maps**. Expect the clustering to
be mostly right and occasionally wrong — it is a heuristic. Fix it:

* **Rename** a route to whatever you call it.
* **Merge into…** if the same loop got split in two.
* Open an activity and use **Move to route** if one attempt landed in the wrong place.

Anything you touch is *pinned* and will not be re-filed by a later `Re-cluster`.

**Add your gear.** Gear tab → **Add gear**. Then use **Bulk reassign** to apply each
pair of shoes across the date range you wore them — that is the only tolerable way to
add gear to years of history that has none. Press **Preview** first; it tells you how
many activities it would touch.

Set **default gear** for running and cycling so new activities get it automatically.
Defaults apply to *new* activities only, never retrospectively.

---

## 6. What is stubbed, unfinished or unverified

Be sceptical of anything in this section.

**Never touched a real Garmin account.** There were no credentials on this machine
overnight. Everything in the ingestion path is exercised only against handcrafted
payloads through an injected fetcher. Specifically:

| Thing | Status |
|---|---|
| `login` / MFA exchange | Code complete, **never run against Garmin** |
| Activity list paging | Tested against a fake fetcher only |
| Per-activity details parser | Column names from documented keys; **never seen a real response** |
| Wellness endpoints | v1 code, also never run live |
| 429 back-off | Logic tested, real thresholds unknown |
| Gear import from Garmin | Written, never run — Garmin only exposes gear for some accounts |
| Export-ZIP importer | Tested against a ZIP built in the test suite, not a real export |

If the parser is wrong, **nothing is lost**: raw payloads are archived verbatim
before normalising, so `garmin-analytics renormalize` rebuilds every table offline
once the parser is fixed. That is the whole point of raw-first ingestion.

**The dashboard was genuinely rendered and looked at**, in headless Chromium, with
screenshots I inspected — maps with real OpenStreetMap tiles, coloured polylines,
charts, gear cards, the edit form. That is not an assertion, it is an observation,
and it caught three real bugs. See `VERIFICATION.md`.

**Not tested:** long-running stability, concurrent browsers, ARM builds, or a
database larger than a few hundred megabytes.

---

## 7. If something breaks

```bash
docker compose exec app garmin-analytics doctor     # no credentials printed
docker compose logs --tail=100
```

`doctor` reports versions, paths, row counts and endpoint health. It is the right
thing to paste into an issue.

**Most likely failure:** Garmin changed something and `garth` can no longer log in.
`garth` is an unofficial client and upstream has announced it is no longer
maintained. If that happens, the fallback with no credentials at all is Garmin's
official data export:

1. Request it at <https://www.garmin.com/en-US/account/datamanagement/exportdata/>
2. `docker compose cp export.zip app:/data/export.zip`
3. `docker compose exec app garmin-analytics import-zip /data/export.zip`

That path gives you activities and most wellness data without any login.

---

## 8. Useful commands

```bash
docker compose exec app garmin-analytics doctor
docker compose exec app garmin-analytics report        # today's readiness in the terminal
docker compose exec app garmin-analytics cluster       # re-run route clustering
docker compose exec app garmin-analytics renormalize   # re-parse the archive, no network
docker compose logs -f
docker compose restart                                 # data survives; sessions survive
docker compose down                                    # stops; the volume is kept
```

To back up everything — database, raw archive and token cache:

```bash
docker run --rm -v garmin-analytics-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/garmin-backup.tar.gz -C /data .
```

---

## 9. One thing worth knowing about the design

Your edits live in a separate table from Garmin's values. The read path is
`COALESCE(your_value, garmin_value)`. Sync writes one table; you write the other.

This means you can rename an activity, fix its type, add an RPE and assign shoes, and
**a re-sync will not undo any of it** — not because the sync is careful, but because
there is no code path where it would even look. It is proven end to end in
`VERIFICATION.md` Part B, section 7, by re-ingesting all 1 147 activities and
checking the edits are still there.
