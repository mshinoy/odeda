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
cd ~/garmin-analytics
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

### Password login is dead — use the browser sign-in

**The email-and-password form above no longer works, for anyone.** Garmin retired the
mobile login endpoint garth posts to; `sso.garmin.com/mobile/api/login` now answers
**429** to every caller. Their web sign-in sets cookies from JavaScript that no plain
HTTP client reproduces, which is why garth was deprecated on 2026-09-22
([matin/garth#222](https://github.com/matin/garth/discussions/222)).

> An earlier version of this file blamed datacenter IP reputation. That was wrong. The
> giveaway looked conclusive — an invented account got the same 429 — but that evidence
> fits "this endpoint refuses everyone" just as well, and that is what it turned out to
> be. The distinguishing test is whether the *other* Garmin endpoints answer normally
> from the same host. They do.

Only the handshake needs a browser. The service ticket it hands back exchanges for OAuth
tokens over an ordinary API call, which works fine from a server — verified 2026-09-23:
an invalid ticket is answered `401`, not `429`.

**Three steps, about a minute:**

1. Get the sign-in URL and open it in any browser:

   ```bash
   docker compose exec app garmin-analytics login --signin-url
   ```

2. Sign in normally, including MFA. The page goes blank — that is expected. The address
   bar now ends with `?ticket=ST-…`.

3. Paste that URL back:

   ```bash
   docker compose exec -it app garmin-analytics login --ticket
   ```

Tickets are single-use and expire in minutes, so do step 3 promptly. If it fails, sign
in again for a fresh one — a rejected ticket is almost never a configuration problem.

The resulting OAuth1 token lasts about a year and silently refreshes the short-lived
OAuth2 token, so this is a once-a-year chore.

The same flow over HTTP: `GET /api/garmin/signin-url`, then `POST /api/garmin/ticket`
with `{"ticket": "…"}`.

If you already hold a garth token cache from elsewhere, `scripts/install-tokens.sh
<dir>` drops it into the volume with the right ownership and modes.

**Needing no login at all:** Garmin's official data export. Request it in your Garmin
account settings and `garmin-analytics import-zip` the archive when the email arrives.
That gets history, but not ongoing sync.

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

---

## 10. Added after a review pass — read this before step 1

A second session went over the finished build looking for defects. It found and fixed
five, and wrote up everything in **[`REVIEW.md`](REVIEW.md)**. Three of them change
what you should do this morning:

**Set `TZ=Asia/Qatar` in `.env`.** This is new; `.env.example` documents it. The
container's clock is UTC, and the race countdown, the current streak and the 28-day
rolling volume are all computed for "today" in local time — without it they read the
previous day for the three hours after Doha midnight. One line, then
`docker compose up -d`.

**The password is no longer written in this file.** It was, which was a mistake in a
file heading for GitHub. It is unchanged and still in `.env`:
`grep APP_PASSWORD .env`. Change it in step 1 as before.

**The race panel was lying, and now is not.** Personal bests were being taken from
*any* activity with a distance stream, including bike rides, so every "PB" on the
Performance tab was a ride and the Riegel projection promised a **46:48 half
marathon**. It now reads foot sports only. On the demo data the projection went from
46:48 to about **2:09**. If you looked at the race tab last night, that is why the
number has moved — the new one is the real one. Filter the Aggregates tab to cycling
if you want your cycling records; they are still there.

Two smaller things worth knowing: `exclude-from-stats` now genuinely removes an
activity from *everything* (it used to reach the Aggregates tab and gear mileage
only, so an excluded junk activity still distorted CTL for six weeks), and the same
applies to fixing an activity's type. Both are the features you will use most in
step 5.

Nothing in the ingestion path changed, and nothing about steps 1–5 below is
different. The container is rebuilt, running and healthy on the same volume, so your
demo data is where you left it.

`REVIEW.md` also lists seven things found and deliberately **not** fixed, including
one — the login endpoint has no brute-force lockout — that matters if you ever move
this off localhost.

---

## 11. Two more fixes after the review, and one machine note

I re-verified the review's own work rather than taking its word for it: the git
history is clean (`.env` never committed, the password no longer anywhere in the
tree), the container is healthy on the rebuilt image, and the race projection now
reads **2:09:23 from a 15 k in 1:30:07** — a running activity, at 6:08/km. That one
is confirmed, not just claimed.

Two things that verification turned up on its own:

**`report` crashed on a fresh install.** `KeyError: 'band'` — the exact state you
would be in after `docker compose up` on a clean machine, before the first sync. The
no-data branch of the readiness calculation returned a dict missing keys its callers
index. The analytics handled the empty database fine; the shape contract between it
and the CLI did not. Fixed at the source, so every consumer benefits, and the empty
report now tells you what to run next instead of printing `None readiness None
(None)`. `tests/test_fresh_install.py` pins it — four of those tests fail without the
fix. This only ever affected a database with no rows in it, so your seeded demo was
never touched.

**One test was flaky.** The headless dashboard test passed alone and failed in a full
run: its virtual-time budget was fixed at 9 s, but the fetches the page waits on are
real, and a loaded machine outran it. It now retries against a growing budget and
settles on content. Three consecutive full runs, then a fourth after the fixes above:
**676 passed**, no flakes.

**Machine note, not a code problem.** This box has 3 GB of RAM and about 2 GB free.
One full-suite run was killed by the OOM killer (exit 137) while Chromium and the
container were both up; the next run passed cleanly. If you see a 137 during a test
run, that is memory pressure, not a regression — close the container or run
`pytest --deselect tests/test_dashboard.py` and it goes away.
