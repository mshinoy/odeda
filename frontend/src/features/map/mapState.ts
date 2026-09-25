// The heatmap's filters, and how they live in the URL, so Back, reload and a shared
// link all show the same map.
//
//   /map?type=running&start=2025-01-01&end=2025-12-31
//
// Unlike the activity list, the default is every activity ever recorded: the point of
// the view is where you have been, not where you went this month. Defaults are left
// out of the URL.
import type { HeatmapParams } from "@/api/queryClient";

export interface MapState {
  /** A Garmin activity type, e.g. `running`; null for every type. */
  type: string | null;
  /** YYYY-MM-DD, inclusive; null for no bound. */
  start: string | null;
  end: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseBound(value: string | null): string | null {
  return value !== null && ISO_DAY.test(value) ? value : null;
}

/** The filters a URL describes. Anything unreadable falls back to no filter. */
export function parseMapState(params: URLSearchParams): MapState {
  return {
    type: params.get("type") || null,
    start: parseBound(params.get("start")),
    end: parseBound(params.get("end")),
  };
}

/** The URL for a set of filters, with every default left out. */
export function serializeMapState(state: MapState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.type) params.set("type", state.type);
  if (state.start) params.set("start", state.start);
  if (state.end) params.set("end", state.end);
  return params;
}

/** The `/api/heatmap` query for a set of filters. Absent filters are left out entirely. */
export function toHeatmapParams(state: MapState): HeatmapParams {
  const params: HeatmapParams = {};
  if (state.type) params.type = state.type;
  if (state.start) params.start = state.start;
  if (state.end) params.end = state.end;
  return params;
}

export function hasFilters(state: MapState): boolean {
  return state.type !== null || state.start !== null || state.end !== null;
}

export const NO_FILTERS: MapState = { type: null, start: null, end: null };
