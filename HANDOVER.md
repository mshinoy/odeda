# Handover

Everything in this repo works right now against synthetic data. This file is the
short list of what you actually run to put *your* data in it, what to expect while
that happens, and what I could not test because you were asleep and there are no
credentials on this machine.

---

## The one command

```bash
cd ~/.openclaw/workspace/projects/garmin-analytics
.venv/bin/python -m garmin_analytics.cli login
```

It asks for your Garmin Connect email and password. The password is read with `getpass`
from the terminal — it is not an argument, not an environment variable, not echoed, and
not written anywhere. What *is* written is an OAuth token cache in `~/.garminconnect/`,
mode 0600, which is what every later run resumes from. `login` is a once-a-year thing.

If your account has MFA on, `garth` will prompt `MFA code:` in the same terminal. Type
the code from your authenticator or SMS and press enter. There is no way to pre-supply
it, so **run this interactively**, not from a script or a cron job.

Then:

```bash
.venv/bin/python -m garmin_analytics.cli sync --days 540
```

---

## What the first sync will do

It pulls, one calendar day at a time, with a ~0.6 s pause between requests:

| Endpoint | Requests for 540 days |
|---|---|
| sleep | 540 |
| daily wellness | 540 |
| HRV | 540 |
| training readiness | 540 |
| training status (incl. VO₂max) | 540 |
| weight | 540 |
| activities | ~6 list pages + one HR-zone call per activity |

**Expect 35–60 minutes.** That is the pacing, not slowness — Garmin rate-limits
aggressively and an account that hammers these endpoints gets throttled or blocked. On
a 429 the client backs off exponentially and keeps going.

It prints per-endpoint progress and a summary at the end. **Ctrl-C is safe**: each
endpoint commits its own transaction and advances its own watermark, so re-running picks
up from where it stopped (minus three days of deliberate overlap, because Garmin
backfills sleep and HRV for a day or two after the fact — re-ingesting an unchanged
payload is free thanks to content-hash deduplication).

Then:

```bash
.venv/bin/python -m garmin_analytics.cli doctor    # sanity-check what landed
.venv/bin/python -m garmin_analytics.cli serve     # http://127.0.0.1:8808/
```

The orange "synthetic data" banner disappears once real data replaces the seed. If you
want to be certain you are starting clean:

```bash
GA_DB=~/.local/share/garmin-analytics/real.db \
  .venv/bin/python -m garmin_analytics.cli sync --days 540
GA_DB=~/.local/share/garmin-analytics/real.db \
  .venv/bin/python -m garmin_analytics.cli serve
```

`GA_DB` points at any file you like; the schema is created on first use.

---

## Set your own heart-rate numbers

TRIMP and every HR zone depend on these, and the defaults are guesses:

```bash
export GA_HR_REST=52        # your true resting HR
export GA_HR_MAX=187        # your true max, not 220-age
export GA_SEX=male          # only changes the Banister exponent
```

Put them in your shell profile. After changing them, `sync` recomputes TRIMP on new
activities; to recompute historical ones, re-run `sync` over the range (it is an upsert)
or delete `activities` and `renormalize`.

Also worth a look before you trust the race panel — `garmin_analytics/config.py`:

```python
TARGET_PEAK_CTL     = 75.0    # what CTL you want to hit by race week
TARGET_PEAK_WEEKLY_KM = 55.0  # peak weekly running volume
```

Those are my guesses for a 1:40-ish half. Change them to your plan.

---

## If the login fails

Most likely causes, in order:

1. **MFA prompt missed.** Run `login` in a real terminal, not through a pipe.
2. **Garmin changed the SSO flow.** `garth` is deprecated upstream (see below). If it
   breaks, the fallback needs no credentials at all:
   Garmin Connect → Account settings → *Export Your Data* → wait for the email (a day or
   two) → `.venv/bin/python -m garmin_analytics.cli import-zip ~/Downloads/export.zip`
3. **Rate-limited from a previous attempt.** Wait an hour.

You can also drop raw `.fit` files in at any time:

```bash
.venv/bin/python -m garmin_analytics.cli import-fit ~/Downloads/activities/
```

That path gives per-second detail the Connect summaries don't have, which is what makes
best efforts and decoupling accurate.

---

## What is **not** tested

I am being specific here because "it's tested" is easy to say and this matters.

### Not exercised at all

- **`garmin-analytics login`.** The `garth` SSO flow has never run on this machine. No
  credentials existed. If anything is broken end-to-end, it is most likely here.
- **The MFA prompt.** Same reason. `garth`'s `prompt_mfa` callback is wired through but
  has never been triggered.
- **The live half of `sync`.** The HTTP call itself, the real endpoint paths, and the
  real response shapes are unverified against Garmin. Everything downstream of the call
  *is* tested — the sync loop runs against an injected fetcher in `tests/test_ingest.py`,
  covering archival, normalisation, watermarks, idempotency, the two-endpoint `fitness`
  merge and paging.
- **Real 429 / rate-limit behaviour.** The backoff code path is written, not observed.

### Tested only against handcrafted inputs

- **The normalisers.** `tests/fixtures.py` contains payloads written by hand to the
  documented and commonly-observed Connect shapes — nested `summaryDTO`, the per-device
  training-status map, grams for weight, the awkward key-spelling variants. If the real
  API differs in a field name, you will see that field come back `None` rather than a
  crash, and the fix is a one-line change in `normalize.py` followed by
  `garmin-analytics renormalize` — **no re-fetching**, because the raw payload is already
  archived. That is the main reason ingestion is raw-first.
- **The export-ZIP importer.** Tested against a ZIP built in the test suite using the
  layout Garmin documented as of 2026-09. It routes documents by *shape* rather than by
  path, so a renamed directory costs nothing, but it has never met a real export.

### Tested end-to-end for real

- **FIT parsing.** `tests/fitgen.py` writes a genuine FIT binary — header, definition and
  data messages, both CRCs — which the real `fitdecode` then parses. Scaling, units,
  session/record merging, downsampling, zone derivation and best-effort extraction are
  all checked against exact expected values.
- **Every analytics formula.** Expected values are derived on paper in the docstring
  beside each assertion.
- **Every API endpoint**, with curl against a live server — transcript in
  VERIFICATION.md.
- **The dashboard**, rendered headlessly in Chromium (already installed here; nothing was
  downloaded for it), asserting that the JS bootstraps and uPlot draws canvases on all
  six tabs.

---

## Known issue you should know about

**`garth` is deprecated upstream.** `garth==0.8.0` emits
`DeprecationWarning: Garth is deprecated and no longer maintained`
(matin/garth discussion #222). It is the library the spec named and it still works, but
it will not be fixed when Garmin next changes something.

Mitigations already in place:

- Every Connect call goes through `ingest/connect.py`, and the endpoint paths are
  literals in one dict (`ENDPOINTS`). Swapping the transport means rewriting one file.
- Every payload is archived verbatim before parsing, so a future breakage costs you new
  data, never historical data.
- The export-ZIP path needs no credentials and no unofficial API at all.

If it breaks and you want it back quickly, the export ZIP is the low-drama route.

---

## Where things live

| | |
|---|---|
| Database | `~/.local/share/garmin-analytics/garmin.db` (override with `GA_DB`) |
| Token cache | `~/.garminconnect/`, mode 0600 (override with `GA_TOKEN_DIR`) |
| Dashboard | `http://127.0.0.1:8808/` |
| Full command reference | README.md |
| Why anything is the way it is | DECISIONS.md |
| Proof of what was actually run | VERIFICATION.md |

Nothing in this repo sends anything anywhere. `.gitignore` covers the token directory,
`.env`, and every `*.db`.
