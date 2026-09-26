# Review 2 — cleanup and publication hygiene

A review-and-simplify pass over `master` at `a7910fd`, plus the two publication fixes.
Scope: the Python backend, the React frontend, and the project's own stated rules in
`CONTRIBUTING.md` and `PLAN.md` § Rules.

Headline: the tree is in better shape than a cleanup pass usually finds. Two commits
came out of it. Most of this document is what I looked at and deliberately did not
change, which is the more useful half.

## Verification

Baseline and final are identical:

| | Baseline | After |
|---|---|---|
| `tsc -b --noEmit` | exit 0 | exit 0 |
| `npm run lint` | exit 0 | exit 0 |
| `npm test` | 645 tests, 55 files | 645 tests, 55 files |
| `npm run build` | ok | ok (6.17 s) |
| `pytest` | 965 passed, 1 skipped | 965 passed, 1 skipped |

`ui-dev` still on `127.0.0.1:5173`, `api-dev` still internal-only. No Docker images or
volumes touched.

## Changed

### 1. `34f41f8` — Scrub the owner's path and name

- `PLAN.md:459,478` — `/home/shinzy/garmin-analytics` → `<main-worktree>` in the
  parallel-mode worktree instructions.
- `tests/test_login_transport.py:56`, `tests/test_ticket_login.py:76,97` —
  `display_name="shinoy"` → `"test-athlete"`, assertion updated to match.

I also swept the rest of the tree for both strings. The only other hit is
`.claude/settings.local.json`, which is untracked — excluded via `.git/info/exclude`,
not `.gitignore`. It will not be published. Worth knowing it is excluded by a mechanism
that does not travel with the repo, so a fresh clone that recreates that file will not
inherit the exclusion.

### 2. `bfdb31c` — Chart grid padding comes from `chrome.ts`

Four builders spelled the plot area out inline:

```
buildHistogramOption       { left: 40, right: 16, top: 12, bottom: 24 }
buildMonthlyDistanceOption { left: 48, right: 16, top: 12, bottom: 24 }
buildWeeklyLoadOption      { left: 40, right: 12, top: 12, bottom: 24 }
buildVo2maxOption          { left: 44, right: 16, top: 12, bottom: 24 }
```

while the health and stream families used named constants. `top`/`bottom` were repeated
verbatim in all four. That is the D1 rule ("every size comes from `design/` or
`charts/chrome.ts`; a design tweak should be a one-file change") not being followed in
exactly the places it was written for.

Added `chartGrid({ left, right })` to `chrome.ts`, holding the shared `top: 12,
bottom: 24` and taking only the side gutters — which genuinely differ per chart,
because they depend on how wide that chart's y-axis labels run. Applied to the four
above and to `HEALTH_CHART_GRID`. Every pixel value is unchanged.

`STREAM_CHART_GRID` is left as its own constant: its `top: 10` is deliberate (stacked
stream charts must line up exactly), so folding it in would have meant either changing
a pixel or adding an override parameter that defeats the point. I noted the health
chart's unusually wide right gutter while I was there — it is there for the baseline
series' `endLabel`, which I confirmed in `buildMetricTrendOption.ts:129` before writing
the comment.

## Left alone, ranked

### 1. `create_app` is 956 lines (`api/server.py:198`)

By far the largest function in either language — the next is 259. It is the FastAPI
app-factory pattern: ~60 route handlers as closures over `settings` and `store`.
Splitting it into `APIRouter`s with a dependency for the store is the obvious move and
would make the file navigable.

Not done. It is a pure reorganisation touching every endpoint, the brief rules that
out, and the risk is asymmetric — the closures capture `store`, the auth middleware is
registered on `app` in the same scope, and mount order matters for the SPA fallback at
`_mount_ui`. Worth doing deliberately with its own test run, not as a rider on a
cleanup pass.

### 2. "A run" is defined two different ways in `analytics/`

Verified, and I think it is worth the owner's attention as a correctness question
rather than a style one.

`ingest/normalize.py:26,32-34` collapses `trail_running` into `running`, but keeps
`treadmill_running` as its own type (with `indoor_running` and `virtual_run` folded
into it). So in stored data, the run family is exactly `running` + `treadmill_running`.

Given that:

- `performance.py:34` — `BEST_EFFORT_TYPES = ("running", "treadmill_running", "walking")`,
  with a comment explaining the reasoning. Records and Riegel **include** treadmill runs.
- `readiness.py:254,287` (`weekly_distance`), `performance.py:305` (long-run
  decoupling / efficiency factor), `reports.py:106,168,248` — all bare
  `activity_type = 'running'`. These **exclude** treadmill runs.

So a treadmill run counts toward your 5 k PB but not toward your weekly running
distance, and never gets a decoupling figure. That may well be intended for decoupling
(a treadmill's speed is not measured the same way), but weekly running mileage silently
dropping treadmill miles looks more like drift than a decision — especially as
`seed/synthetic.py:966` comments "treadmill miles wear shoes too" when computing gear
totals, i.e. the seeder takes the opposite view.

Untouched: the brief and the project rules both forbid changing `analytics/` behaviour,
and every option here changes a number somewhere. Flagging it as a question, not a
defect I am confident about.

### 3. Six endpoints have no `response_model`

`/api/auth/status`, `/api/auth/login`, `/api/auth/logout`, `/api/doctor`,
`/api/overrides/bulk`, `/api/raw/{endpoint}/{ref_key}`.

This is **not** the "never hand-write API types" violation it first looks like — I
checked, and the frontend consumes all of them through the generated client; they come
through as `unknown`, which `PLAN.md` explicitly anticipates ("Everything else still
returns `unknown` and has to be typed by the task that first uses it"). So it is a
documented gap, not drift.

Two of them are defensible permanently: `/api/raw` returns arbitrary Garmin JSON, and
`/api/doctor` is diagnostics. The auth trio and `/api/overrides/bulk` are ordinary app
endpoints and could be typed.

Not done, because `response_model` also *filters* — adding one can silently drop a
field a caller reads — and it changes `/openapi.json`, so `schema.ts` must be
regenerated, which per `CONTRIBUTING.md` needs a server running against a database with
no `APP_PASSWORD`. That is a change with a behaviour surface, not a cleanup.

Related and smaller: `auth_login` and `api_bulk_override` take
`payload: dict[str, Any] = Body(...)` and hand-validate, while every other write
endpoint takes a typed request model (`GarminLoginRequest`, `GearCreateRequest`, …).
`api_bulk_override:808-810` is the only place raising `HTTPException(400,
"activity_ids must be a list")` by hand — Pydantic would do that. Same reasoning for
leaving it.

### 4. `raise HTTPException(404, f"no activity {activity_id!r}")` ×4

`server.py:616, 676, 696, 742`. Only the message is shared — each site reaches the
check by a different route (`gym_mod.activity_row`, `ov_mod.activity_exists`,
`gym_mod.activity_exercises` twice). A helper would deduplicate a string and add a hop.
Taste; left.

### 5. Chart y-axis blocks look repetitive but are not

Six builders open their `yAxis` with the same three lines (`...quietAxis`,
`splitLine: gridLineStyle(tokens)`, `axisLabel: axisLabelStyle(tokens)`). Those three
are already named `chrome.ts` helpers — the factoring has happened. What remains
differs per chart in `splitNumber`, `minInterval`, `min`/`max`/`interval` and
`formatter`. A `valueAxis(tokens, opts)` taking five optional keys would be longer than
what it replaced. Left.

### 6. Explicit query invalidation in `api/queries/`

`useEditActivity`, `useExercises`, `useGear`, `useRoutes` each list their
`invalidateQueries` calls, overlapping on `activity(id)` and `activitiesAll`. The rule
is "Invalidate those keys explicitly after a mutation", each set is already a named
commented function, and the sets genuinely differ (editing an activity moves Trends;
relabelling an exercise does not). Collapsing would hide which mutation touches what.
Left as designed.

### 7. Near-identical small response models

`GearDeleted{deleted}`, `GearDefaultCleared{cleared}`, `ActivityGearRemoved{removed}`
are the same shape with different field names. The field name is the wire contract, so
merging them is an API change, not a cleanup. Left.

### 8. `export` on module-private symbols

~40 symbols are exported but referenced only by their own unit test — which is the
project's stated pattern for pure builders, so correct. A smaller set is exported and
used only inside its own file: `cssVariables` (`design/tokens.ts:146`), `parseHex` and
`toLab` (`design/cvd.ts`), `HEALTH_CHART_HEIGHT`, `RACE_DISTANCE_TOLERANCE`,
`SPEED_SMOOTHING_S`, `CURSOR_LAYER_ID`, `zoneName`. Dropping `export` is safe but
purely cosmetic and would churn eight files for no reader's benefit. Left.

## Checked and clean

Recording the negatives, because "I looked and found nothing" is worth as much here as
the findings:

- **Dead code from the vanilla-JS dashboard removal.** `garmin_analytics/web/` is gone;
  no orphaned `StaticFiles` mounts, templates or asset references. The only `app.js`
  mention is the `git show` pointer in `PLAN.md`'s reference table, which is
  intentional.
- **garth → garminconnect leftovers.** Every surviving `garth` mention is deliberate:
  `DECISIONS.md` D3 explaining the switch, `connect.py:15-17` explaining it at the call
  site, and three tests (`test_login_transport.py:74-87`, `test_cli.py:229`) that
  actively assert garth is neither imported nor installed. Nothing vestigial.
- **Unused exports.** Swept every non-test `.ts`/`.tsx`; no symbol is unreferenced
  everywhere. Nothing to delete.
- **No hex colours outside `design/`.** One grep hit, `PerformancePanel.tsx:104`, is the
  HTML entity `&#8322;` (the subscript 2 in "VO₂max") — a false positive.
- **No `any`, no non-null `!`.** Lint enforces both and passes; the two `!` grep hits
  are ordinary negations.
- **No inline number formatting.** One hit outside `lib/format.ts`, `map/legend.ts:15`,
  which carries a comment explaining that CSS lengths are not display text. Correct
  exception, correctly documented.
- **No chart has two y-axes.** No `yAxis: [` anywhere in `src/charts`.
- **Adapters are already well factored.** `toGearRecord` spreads `toGearItem`,
  `toRouteListItem` spreads `toRouteOption`, `_columnar_route_detail` and
  `_columnar_segments` share `_polyline`. Nothing left to collapse that would not be
  making things worse.
- **No leftover markers.** Zero `TODO`, `FIXME`, `XXX`, `HACK`, `@ts-ignore`,
  `@ts-expect-error` or `eslint-disable` in `garmin_analytics/`, `frontend/src/` or
  `tests/`. No `console.log`, no stray `print()` outside `cli.py` and `diagnostics.py`.

## Coverage

I got through everything I set out to: both hygiene fixes, the chart builders, the
adapters, the API response models, both migration paths, the stated rules checked
mechanically rather than by eye, and a size/complexity pass over both languages.

Where I went shallower: I read `analytics/routes.py` (1030 lines) and
`seed/synthetic.py` (1085) only at the level of function length and the run-type
question above — I did not review the clustering heuristic or the seeder's maths, since
the brief puts `analytics/` behaviour out of bounds and the seeder is test-only. I also
did not look at the UI in a browser; both commits are behaviour-preserving by
construction and the chart change is covered by the 124 tests in `src/charts`, but no
one has looked at a screenshot since `a7910fd`.
