# The frontend

A React SPA over the app's own JSON API. `npm run build` writes it to
`../garmin_analytics/ui/`, which `garmin-analytics serve` serves; the Docker image
builds it in a Node stage and ships it inside the wheel. Nothing is fetched at runtime
except the basemap.

React 19 · TypeScript strict (`noUncheckedIndexedAccess`; ESLint forbids `any` and
non-null `!`) · Vite · Tailwind v4 · shadcn/ui · TanStack Query for server state ·
Zustand for UI state · ECharts · MapLibre / Mapbox with deck.gl.

The design rules, the task history and every decision behind what is here are in
[`../PLAN.md`](../PLAN.md) and [`../DECISIONS.md`](../DECISIONS.md). Read the Rules
section of `PLAN.md` before changing anything: it is the brief, not a summary of it.

## Running it

```bash
npm ci
npm run dev            # http://localhost:5173, /api proxied to VITE_API_URL
```

`VITE_API_URL` defaults to `http://127.0.0.1:8000`. Copy `.env.example` to `.env` to
point it somewhere else or to set the map variables. Use `localhost`, not
`127.0.0.1`, in a browser or a script: the Vite server listens on IPv6 only.

Three ways to get a backend to point at:

```bash
# 1. Synthetic data, no account needed. Fine for tests, not for judging a view.
garmin-analytics seed --reset && garmin-analytics serve --port 8000

# 2. A copy of the real database, taken from the running container.
../scripts/dev-real-data.sh 8818
VITE_API_URL=http://127.0.0.1:8818 npm run dev

# 3. Both in Docker, reloading on every edit to this checkout.
docker compose --profile dev up -d --no-deps api-dev ui-dev   # :5173
```

The production build, as the container serves it:

```bash
npm run build          # writes ../garmin_analytics/ui/
garmin-analytics serve --port 8000
```

## Before you push

```bash
npx prettier --write src && npm run typecheck && npm run lint && npm test && npm run build
```

All five. There is no browser-level test suite, so if you say a view works, look at
it and say that you did:

```bash
node scripts/screenshot.mjs http://localhost:5173 /status ~/shot.png [--dark]
      [--click='<css selector>'] [--wait=9000]
node scripts/measure.mjs    http://localhost:5173 /trends [--hover='<css selector>']
```

`screenshot.mjs` prints the page's text and any console error — an error from the app
is a failure. "Failed to initialize WebGL" is the screenshot browser having no GPU,
not a bug. `measure.mjs` reports first paint, bytes downloaded and the cost of a
hover; on a box without a GPU its map numbers measure SwiftShader, not the app.

## Where things are

| What | Where |
|---|---|
| Routes | `src/routes.tsx` |
| One folder per view | `src/features/<view>/`, with `<View>Page.tsx` as the container |
| Shared components | `src/components/` (`StatCard`, `EmptyState`, `KindBadge`, `StatusDot`, `NativeSelect`, `ui/` from shadcn) |
| Charts | `src/charts/` — `EChart.tsx`, the registry in `echarts.ts`, shared styling in `chrome.ts`, one folder per chart |
| Map | `src/map/` — `BaseMap`, the provider switch in `basemap.ts`, layers in `layers/` |
| API client and types | `src/api/` — `client.ts`, generated `schema.ts`, `adapters.ts`, query hooks in `queries/` |
| Query keys | `src/api/queryClient.ts` |
| Cross-view UI state | `src/store/ui.ts` (selection, hover, time range) |
| Tokens, scales, typography | `src/design/` |
| Formatting and per-sample metrics | `src/lib/format.ts`, `src/lib/metrics.ts` |

Four rules hold this together, and breaking any of them is how the code stops being
easy to change:

- **Never hand-write an API type.** Add a Pydantic model in
  `garmin_analytics/api/schemas.py`, run `npm run gen:api`, and commit the regenerated
  `src/api/schema.ts`. It builds the schema from this checkout's code and needs no
  server; pointing it at one is `GA_OPENAPI_URL`, and reads whatever that process runs.
- **Backend shapes become app shapes in one place**, `src/api/adapters.ts`. A view
  never reads a snake_case field.
- **Numbers become strings only in `src/lib/format.ts`.** No inline `toFixed`.
- **Colours, sizes and spacing come from `src/design/`.** No hex in a component. A
  palette change must still pass `src/design/palette.test.ts`, which simulates
  protanopia, deuteranopia and tritanopia and measures the distance between colours.

## How to add a chart

A chart is a pure `build<Name>Option(...)` that returns an ECharts option, plus a thin
component that calls it. The builder is where the thinking goes and it is unit-tested
without a DOM; the component only supplies the tokens and the height.

1. **Register what you need** in `src/charts/echarts.ts`. ECharts is imported
   piecewise, so a series type nobody registered renders nothing, silently.

2. **Write the builder** in `src/charts/<name>/build<Name>Option.ts`. It takes data
   and `ColorTokens` and returns a `ChartOption`. Take the axis, gridline and tooltip
   styling from `src/charts/chrome.ts` so every chart looks like the others.

   ```ts
   import { axisLabelStyle, gridLineStyle, quietAxis, tooltipStyle } from "@/charts/chrome";
   import type { ChartOption } from "@/charts/echarts";
   import type { ColorTokens } from "@/design/tokens";
   import { formatDistance } from "@/lib/format";

   export function buildWeeklyDistanceOption(
     weeks: readonly { week: string; distanceM: number }[],
     tokens: ColorTokens,
   ): ChartOption {
     return {
       grid: { left: 48, right: 8, top: 8, bottom: 24 },
       xAxis: { type: "category", data: weeks.map((w) => w.week), ...quietAxis,
                axisLabel: axisLabelStyle(tokens) },
       yAxis: { type: "value", splitLine: gridLineStyle(tokens),
                axisLabel: { ...axisLabelStyle(tokens),
                             formatter: (m: number) => formatDistance(m) } },
       tooltip: { trigger: "axis", ...tooltipStyle(tokens),
                  valueFormatter: (m) => formatDistance(Number(m)) },
       series: [{ type: "bar", data: weeks.map((w) => w.distanceM),
                  itemStyle: { color: tokens.kind.run } }],
     };
   }
   ```

3. **Test the builder** next to it. Assert what the chart *says* — the values, the
   order, the colour that came from a token — not the shape of the option object.
   Pass a `ColorTokens` with recognisable strings (`"token-kind-run"`) so a colour
   assertion cannot pass by accident; `buildSplitsChartOption.test.ts` is the pattern.

4. **Wrap it** in a component that does nothing else:

   ```tsx
   export function WeeklyDistanceChart({ weeks }: { weeks: readonly Week[] }) {
     const tokens = useTokens();
     const option = useMemo(() => buildWeeklyDistanceOption(weeks, tokens), [weeks, tokens]);
     return <EChart option={option} height={200} />;
   }
   ```

   `useTokens()` re-renders on a theme change, which is how dark mode reaches a canvas.
   For a chart that shares the crosshair with the map, pass `xValues`, `hoverIndex` and
   `onHoverIndex`; `EChart` wires both directions and nothing else.

## How to add a map layer

Same shape: a pure `make<Name>Layer(...)` returning a deck.gl layer, with anything
worth asserting — the weighting, the colour, the bounds — exported beside it so the
test never has to construct deck.gl.

1. **Write the builder** in `src/map/layers/make<Name>Layer.ts`:

   ```ts
   import { ScatterplotLayer } from "@deck.gl/layers";
   import { hexToRgba, type Rgba } from "@/design/scales";
   import type { ColorTokens } from "@/design/tokens";

   export const STOPS_LAYER_ID = "stops";

   /** Exported so the test can assert the colour without building a layer. */
   export function stopColor(tokens: ColorTokens): Rgba {
     return hexToRgba(tokens.status.warning);
   }

   export function makeStopsLayer(stops: readonly Stop[], tokens: ColorTokens) {
     return new ScatterplotLayer<Stop>({
       id: STOPS_LAYER_ID,
       data: stops,
       getPosition: (s) => [s.lon, s.lat],
       getFillColor: stopColor(tokens),
       radiusMinPixels: 4,
       pickable: true,
     });
   }
   ```

   Two things deck.gl will punish you for. It compares `data` **by identity** to
   decide whether to re-upload, so build the array outside the builder and hoist it —
   `makeTripsLayer` takes `trips: readonly Trip[]`, an array of one, for exactly this
   reason. And picking straight on the pixel makes a thin path almost unhittable, so
   both base maps set the overlay's `pickingRadius` from `PICKING_RADIUS_PX` in
   `src/map/types.ts`; a layer only has to be `pickable`.

2. **Test it** by calling the exported helpers directly, and the builder only for its
   `id` and its props. `makeHeatmapLayer.test.ts` is the pattern.

3. **Render it** through `BaseMap`, which owns the provider switch, the theme's style
   URL and the no-WebGL fallback:

   ```tsx
   const tokens = useTokens();
   const layers = useMemo(() => [makeStopsLayer(stops, tokens)], [stops, tokens]);
   return <BaseMap layers={layers} initialBounds={bounds} />;
   ```

   Pass `fitBounds` as well if a filter can send the data to another city;
   `initialBounds` is read once.

## The API layer

A view never calls `fetch`. Each endpoint gets a hook in `src/api/queries/`:

```ts
export function useWeeklyDistance(weeks: number) {
  return useQuery({
    queryKey: queryKeys.weeklyDistance(weeks),
    queryFn: async () => toWeeklyDistance(unwrap(await api.GET("/api/weekly", {
      params: { query: { weeks } },
    }))),
  });
}
```

`unwrap` turns a non-2xx into an `ApiError` carrying FastAPI's `detail`. Add the key
to `queryKeys` in `src/api/queryClient.ts` — that file is the whole list, so
invalidating after a mutation is something you can check rather than guess. A
mutation must name every key its write can move: an activity edit invalidates the
activity, the list, Status, the load curve, the heatmap, the aggregates, performance
and the override count, because all of them can show a value it changed.
