# Contributing

Thanks for looking. This is a small, self-hosted, single-tenant app and it intends to
stay that way — the fastest way to get a change merged is for it to fit that shape.


Frontend work is planned and tracked in [`PLAN.md`](PLAN.md): pick a task there, and
update its status in the same commit as the work.

## Ground rules

1. **No credentials, tokens or personal data in the repository.** Not in tests, not in
   fixtures, not in a screenshot, not in a commit message. The `.gitignore` covers the
   obvious cases; please check `git diff --staged` before pushing anyway.
2. **One runtime call off the machine.** The app is served from the container; the
   basemap style and tiles (CARTO by default, Mapbox with a token) are the single
   documented exception. Adding a second one needs a good argument in the PR
   description. npm dependencies are fine — they are bundled at build time.
3. **Raw-first ingestion.** Anything fetched is archived verbatim in `raw_documents`
   before it is normalised. Re-parsing must never require re-fetching.
4. **User edits win.** Sync writes `activities`; users write `overrides`. If you add a
   code path where a sync can modify a value the user has set, that is a bug.
5. **Pin dependencies.** `requirements.txt` holds exact versions; `frontend/package-lock.json`
   is committed and the image installs from it with `npm ci`.

## Setting up

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install -e .

garmin-analytics seed --reset       # ~3 years of synthetic data, no account needed
garmin-analytics serve --port 8000  # the port the frontend dev proxy expects

cd frontend
npm ci
npm run dev                         # http://localhost:5173, /api proxied to the backend
```

The Vite dev server proxies `/api` to `VITE_API_URL` (default `http://127.0.0.1:8000`),
so the browser sees one origin and the `ga_session` cookie works without CORS. Copy
`frontend/.env.example` to `frontend/.env` to change it or to set the map variables.
`npm run build` writes the production bundle to `garmin_analytics/ui/`, which `serve`
then serves; it is gitignored.

You do not need a Garmin account to develop against this. The seeder produces
physiologically coupled data including repeated GPS routes, which is enough to exercise
clustering, segment analysis, gear mileage and every chart.

## Tests

```bash
pytest                    # the whole backend suite
pytest tests/test_routes.py -q

cd frontend
npm run typecheck         # tsc, strict
npm run lint              # ESLint: no `any`, no non-null `!`
npm run test              # vitest
npm run build             # what the Docker image runs
```

Run all four before sending a frontend change. There is no browser-level test of the UI
yet; if you say a view works, say that you looked at it.

If you change an API response model in `garmin_analytics/api/schemas.py`, regenerate the
TypeScript types and commit the result:

```bash
garmin-analytics serve --port 8000   # on a database with no APP_PASSWORD: /openapi.json is gated otherwise
cd frontend && npm run gen:api       # rewrites src/api/schema.ts
```

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
* Match the surrounding code. In `frontend/`: TypeScript strict, server state through
  TanStack Query, UI state in the Zustand store, and numbers turn into strings only in
  `src/lib/format.ts`. `npm run format` applies Prettier.
* Keep functions small enough to read in one screen.

## Reporting a problem

Garmin's API is unofficial and moves without notice. If ingestion breaks, the useful
report includes the output of:

```bash
garmin-analytics doctor
```

which reports versions, paths and endpoint health — and no credentials.
