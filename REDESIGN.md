# Redesign: bringing the remaining tabs to the Today/Activities look

Today and Activities are the reference. Everything below makes the other tabs match them.

## The look to match

- Cards: `bg-card shadow-card rounded-2xl border`, padding 7 (5 on short screens). The shadow
  (`--shadow-card`) is the "hovering above the page" lift; deeper in dark mode.
- Type: the same scale as Today: muted small labels (`text-xs`/`text-sm`), one large
  semibold title (`text-3xl`, tight tracking), secondary ink for sentences.
- Intent of the whole app: answers first, little information, easy to retrieve.
- Sources of truth: `features/today/TodayCard.tsx`, `design/tokens.ts`, `design/typography.ts`.

## 1. Map + Routes become one page (`/map`)

Today `/map` is a heat map and `/routes` is a list of cards, and the routes matter more.

Direction (from the owner): `/map` shows the routes, as a list on the right; clicking a
route changes the map. The heat map may go or stay as a secondary view. To be discussed.

Agreed (heat map kept when no route is chosen). Built:
- Map on the left (as tall as the window leaves it), route list on the right.
- Clicking a route draws it on the map and shows its answer (distance, times run, best,
  latest) in a card; the route's own page (`/routes/:id`) stays for the detail.
- The kind filter (loop / out-and-back / ...) sits above the list.
- Heat map: shown while no route is chosen, with its type and date filters; choosing a route replaces it.
- `/routes` redirects to `/map`; links to `/routes/:id` keep working.
- Narrow screens: list under the map.

## 2. Health (built)

Three cards: Recovery, Body, Activity level. Each chart lost its "Whole range" label and drag hint (the hint is in the info popover); the top row shows the last reading and its day when today's has not synced.

Move to cards with the shadow lift. Clean up what is shown: look at what the page already
displays (baseline cards, body panel, sleep stages, one chart per metric, Body Battery,
readiness) and present it as an answer first, then the charts behind it.

## 3. Trends (built)

Five cards: Volume, Patterns, Records, Running performance, Bodyweight and performance. Same card, same title/question header (`components/SectionCard.tsx`).

Same treatment. Today it is a long stack of panels (totals, distributions, records,
running performance, bodyweight and performance) with a filter bar. Cards, a clear
top answer, and fewer things on screen at once.

## Other tabs still on the old style (check after the three above)

Plan and Settings are done (Phase 26). Race, Compare and Gear are restyled (merged 2026-11-16).

## Working rules

- One branch per task, from main; one question to the owner at a time.
- Verify against the real data in Docker, not seeded data.
- Order: Map + Routes, then Health, then Trends (not agreed yet).

## Open questions

1. Trends is still long (Patterns and Running performance especially); decide with the owner what to fold away.
2. None: every tab is on the new style.
