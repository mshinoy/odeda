// The Trends filter bar, and how it lives in the URL, so Back, a reload and a shared
// link all show the same numbers.
//
//   /trends?type=running&start=2026-01-01&gear=3
//
// Defaults are left out of the URL, as the map's filters are. The default is everything
// ever recorded: Trends is about the whole history, not about this month.

import type { AggregateParams } from "@/api/queryClient";
import type { components } from "@/api/schema";

type FilterGear = components["schemas"]["FilterGear"];

export interface TrendsFilters {
  /** A Garmin activity type, e.g. `running`; null for every type. */
  type: string | null;
  /** YYYY-MM-DD, inclusive; null for no bound. */
  start: string | null;
  end: string | null;
  /** A gear id; null for any gear. */
  gearId: number | null;
}

export const NO_FILTERS: TrendsFilters = { type: null, start: null, end: null, gearId: null };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseBound(value: string | null): string | null {
  return value !== null && ISO_DAY.test(value) ? value : null;
}

function parseGear(value: string | null): number | null {
  const id = Number(value);
  return value !== null && Number.isInteger(id) && id > 0 ? id : null;
}

/** The filters a URL describes. Anything unreadable falls back to no filter. */
export function parseTrendsFilters(params: URLSearchParams): TrendsFilters {
  return {
    type: params.get("type") || null,
    start: parseBound(params.get("start")),
    end: parseBound(params.get("end")),
    gearId: parseGear(params.get("gear")),
  };
}

/** The URL for a set of filters, with every default left out. */
export function serializeTrendsFilters(filters: TrendsFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  if (filters.gearId !== null) params.set("gear", String(filters.gearId));
  return params;
}

/** The `/api/aggregate` query. An absent filter is left out entirely, not sent as null. */
export function toAggregateParams(filters: TrendsFilters): AggregateParams {
  const params: AggregateParams = {};
  if (filters.type) params.type = filters.type;
  if (filters.start) params.start = filters.start;
  if (filters.end) params.end = filters.end;
  if (filters.gearId !== null) params.gear_id = filters.gearId;
  return params;
}

export function hasFilters(filters: TrendsFilters): boolean {
  return (
    filters.type !== null ||
    filters.start !== null ||
    filters.end !== null ||
    filters.gearId !== null
  );
}

/** The nickname if it has one, else brand and model, else the id it is known by. */
export function gearName(item: FilterGear): string {
  const named = item.nickname || [item.brand, item.model].filter(Boolean).join(" ");
  return named || `Gear ${item.gear_id}`;
}
