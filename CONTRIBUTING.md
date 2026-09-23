# Contributing

Thanks for looking. This is a small, self-hosted, single-tenant app and it intends to
stay that way — the fastest way to get a change merged is for it to fit that shape.

## Ground rules

1. **No credentials, tokens or personal data in the repository.** Not in tests, not in
   fixtures, not in a screenshot, not in a commit message. The `.gitignore` covers the
   obvious cases; please check `git diff --staged` before pushing anyway.
2. **No CDN.** Application assets are vendored. Map tiles are the single documented
   runtime call off the machine; adding a second external dependency needs a good
   argument in the PR description.
3. **Raw-first ingestion.** Anything fetched is archived verbatim in `raw_documents`
   before it is normalised. Re-parsing must never require re-fetching.
4. **User edits win.** Sync writes `activities`; users write `overrides`. If you add a
   code path where a sync can modify a value the user has set, that is a bug.
5. **Pin dependencies.** `requirements.txt` holds exact versions.

## Setting up

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install -e .

garmin-analytics seed --reset     # ~3 years of synthetic data, no account needed
garmin-analytics serve            # http://127.0.0.1:8000
```

You do not need a Garmin account to develop against this. The seeder produces
physiologically coupled data including repeated GPS routes, which is enough to exercise
clustering, segment analysis, gear mileage and every chart.

## Tests

```bash
pytest                    # the whole suite
pytest tests/test_routes.py -q
```

The suite includes a headless-Chromium render check that boots the real page against a
real uvicorn and asserts that charts and maps actually drew. It **skips** rather than
fails when no Chromium is installed, so a missing browser will not block you — but if
you have one, run it before touching `web/`.

Tests that assert on maths (TRIMP, CTL/ATL/TSB, Riegel, route clustering, gear totals,
override precedence) should assert against a hand-derived expected value with the
derivation in a comment, not against whatever the code currently returns.

## Adding an editable field

Two lines: an entry in `FIELDS` in `garmin_analytics/db/fields.py`, and the matching
attribute on `ActivityRow` in `garmin_analytics/api/schemas.py`:

```python
EditableField(
    name="shoes_felt_flat",
    type="bool",
    base_column=None,          # None = a field Garmin never supplies
    label="Shoes felt flat",
    editor="bool",
),
```

```python
shoes_felt_flat: int | None = None
```

The `v_activities` view, validation and the UI editor are all generated from the
registry. The response model is declared explicitly so the API only changes on purpose;
`test_activity_row_declares_every_view_column` fails with the missing name if you forget
it. Then run `npm run gen:api` in `frontend/` to pick it up in the TypeScript types. `PRAGMA user_version` carries a fingerprint of it, so the view
rebuilds itself on next start. If you find yourself editing the view DDL by hand,
something has gone wrong.

## Adding a route-clustering improvement

`analytics/routes.py` is a heuristic and known to be imperfect. If you change the
matching, please add a test with two hand-built tracks (see `tests/test_routes.py` for
the pattern) that pins down the behaviour you intended — especially a *negative* case,
because the failure mode that matters is two different routes being merged.

## Style

* Comments explain **why**, not what. If a line needs a comment to say what it does,
  rewrite the line.
* Match the surrounding code: no framework, no build step, plain ES2020 in `web/`.
* Keep functions small enough to read in one screen.

## Reporting a problem

Garmin's API is unofficial and moves without notice. If ingestion breaks, the useful
report includes the output of:

```bash
garmin-analytics doctor
```

which reports versions, paths and endpoint health — and no credentials.
