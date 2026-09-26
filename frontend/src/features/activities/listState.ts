// The activity list's sort, filters and page, and how they live in the URL. The URL is
// the only copy, so Back, reload and a shared link all show the same list.
//
//   /activities?type=running&start=2026-01-01&end=&q=tempo&sort=pace&page=2
//
// A missing `start`/`end` means the store's time range; an empty one means no bound
// (so "all time" is `start=&end=`). Defaults are left out of the URL.
import type { ActivityListParams } from "@/api/queryClient";
import type { DateRange } from "@/lib/time";

export const PAGE_SIZE = 50;

export type SortColumn = "date" | "type" | "distance" | "pace" | "time" | "hr";
export type SortOrder = "asc" | "desc";

export interface ListState {
  /** A Garmin activity type, e.g. `running`; null for every type. */
  type: string | null;
  /** YYYY-MM-DD, inclusive; null for no bound. */
  start: string | null;
  end: string | null;
  /** Name search, already trimmed; "" for none. */
  q: string;
  /** Races only. Off means every activity, not "not a race". */
  race: boolean;
  /** Activities you have corrected. Off means every activity, not "untouched". */
  edited: boolean;
  sort: SortColumn;
  order: SortOrder;
  /** 1-based. */
  page: number;
}

interface SortDefinition {
  /** The `sort` field the API orders by. */
  field: string;
  /** The order a first click gives: newest, longest, fastest, A to Z. */
  firstOrder: SortOrder;
  /**
   * Pace sorts on speed, where a faster pace is a larger number, so the API order is
   * flipped: pace ascending (fastest first) is speed descending.
   */
  inverted: boolean;
}

const SORTS: Record<SortColumn, SortDefinition> = {
  date: { field: "day", firstOrder: "desc", inverted: false },
  type: { field: "activity_type", firstOrder: "asc", inverted: false },
  distance: { field: "distance_m", firstOrder: "desc", inverted: false },
  pace: { field: "avg_speed_mps", firstOrder: "asc", inverted: true },
  time: { field: "moving_time_s", firstOrder: "desc", inverted: false },
  hr: { field: "avg_hr", firstOrder: "desc", inverted: false },
};

const DEFAULT_SORT: SortColumn = "date";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function isSortColumn(value: string | null): value is SortColumn {
  return value !== null && Object.hasOwn(SORTS, value);
}

function isSortOrder(value: string | null): value is SortOrder {
  return value === "asc" || value === "desc";
}

function parseBound(value: string | null, fallback: string): string | null {
  if (value === null) return fallback;
  if (value === "") return null;
  return ISO_DAY.test(value) ? value : fallback;
}

function parsePage(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** The list state a URL describes. Anything unreadable falls back to its default. */
export function parseListState(params: URLSearchParams, defaultRange: DateRange): ListState {
  const sortParam = params.get("sort");
  const sort = isSortColumn(sortParam) ? sortParam : DEFAULT_SORT;
  const orderParam = params.get("order");

  return {
    type: params.get("type") || null,
    start: parseBound(params.get("start"), defaultRange.start),
    end: parseBound(params.get("end"), defaultRange.end),
    q: (params.get("q") ?? "").trim(),
    race: params.get("race") === "1",
    edited: params.get("edited") === "1",
    sort,
    order: isSortOrder(orderParam) ? orderParam : SORTS[sort].firstOrder,
    page: parsePage(params.get("page")),
  };
}

/** The URL for a list state, with every default left out. */
export function serializeListState(state: ListState, defaultRange: DateRange): URLSearchParams {
  const params = new URLSearchParams();
  if (state.type) params.set("type", state.type);
  if (state.start !== defaultRange.start) params.set("start", state.start ?? "");
  if (state.end !== defaultRange.end) params.set("end", state.end ?? "");
  if (state.q) params.set("q", state.q);
  if (state.race) params.set("race", "1");
  if (state.edited) params.set("edited", "1");
  if (state.sort !== DEFAULT_SORT) params.set("sort", state.sort);
  if (state.order !== SORTS[state.sort].firstOrder) params.set("order", state.order);
  if (state.page > 1) params.set("page", String(state.page));
  return params;
}

/** The `/api/activities` query for a list state. Absent filters are left out entirely. */
export function toApiParams(state: ListState): ActivityListParams {
  const sort = SORTS[state.sort];
  const params: ActivityListParams = {
    limit: PAGE_SIZE,
    offset: (state.page - 1) * PAGE_SIZE,
    sort: sort.field,
    order: sort.inverted ? flip(state.order) : state.order,
  };
  if (state.type) params.type = state.type;
  if (state.start) params.start = state.start;
  if (state.end) params.end = state.end;
  if (state.q) params.q = state.q;
  if (state.race) params.race = true;
  if (state.edited) params.edited = true;
  return params;
}

function flip(order: SortOrder): SortOrder {
  return order === "asc" ? "desc" : "asc";
}

/** Clicking a column header: the same column flips its order, a new one starts at its first order. */
export function toggleSort(state: ListState, column: SortColumn): ListState {
  const order = state.sort === column ? flip(state.order) : SORTS[column].firstOrder;
  return { ...state, sort: column, order, page: 1 };
}

export type FilterPatch = Partial<
  Pick<ListState, "type" | "start" | "end" | "q" | "race" | "edited">
>;

/**
 * A filter change; it always goes back to the first page.
 *
 * Switching Races or Edited on also drops the date bounds, for the same reason: both
 * are rare and scattered across the whole history, so "in the default last 30 days"
 * is almost always empty, which reads as a broken filter rather than as a true answer.
 */
export function withFilters(state: ListState, patch: FilterPatch): ListState {
  const next: ListState = { ...state, ...patch, page: 1 };
  const widened = patch.race === true || patch.edited === true;
  return widened ? { ...next, start: null, end: null } : next;
}

/** Every activity, of every type, with no search; the sort is kept. */
export function clearFilters(state: ListState): ListState {
  return withFilters(state, {
    type: null,
    start: null,
    end: null,
    q: "",
    race: false,
    edited: false,
  });
}

export function hasFilters(state: ListState): boolean {
  return (
    state.type !== null ||
    state.start !== null ||
    state.end !== null ||
    state.q !== "" ||
    state.race ||
    state.edited
  );
}

/**
 * The link another view uses to open the edited activities.
 *
 * The empty bounds are load-bearing: a missing `start`/`end` means the store's
 * default range, so `?edited=1` alone would land on "edited in the last 30 days"
 * and usually show nothing. Clicking the toggle in the list drops the bounds for
 * the same reason (`withFilters`); a link has to say so itself.
 */
export const EDITED_ACTIVITIES_QUERY = "?edited=1&start=&end=";

/** The number of pages `total` rows fill; at least 1. */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
