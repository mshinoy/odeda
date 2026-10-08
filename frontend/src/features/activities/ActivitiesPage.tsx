import { useMemo } from "react";
import type { ActivityPage } from "@/api/queries/useActivities";
import { useActivities } from "@/api/queries/useActivities";
import { useActivityPreviews } from "@/api/queries/useActivityPreviews";
import { ActivityFilters } from "@/features/activities/ActivityFilters";
import { ActivityResults, type ResultsPage } from "@/features/activities/ActivityResults";
import { toCardView } from "@/features/activities/cardView";
import {
  clearFilters,
  hasFilters,
  pageCount,
  PAGE_SIZE,
  toApiParams,
  toggleSort,
  withFilters,
  type ListState,
} from "@/features/activities/listState";
import { CompareBar } from "@/features/activities/CompareBar";
import { toRowView } from "@/features/activities/rowView";
import { SortSelect } from "@/features/activities/SortSelect";
import { useListState } from "@/features/activities/useListState";
import { ViewToggle } from "@/features/activities/ViewToggle";
import { formatCountRange } from "@/lib/format";
import { useUiStore } from "@/store/ui";

function toResultsPage(data: ActivityPage, state: ListState): ResultsPage {
  const first = (state.page - 1) * PAGE_SIZE + 1;
  const today = new Date();
  return {
    // Only the view on screen is built.
    rows: state.view === "table" ? data.rows.map((row) => toRowView(row, today)) : [],
    cards: state.view === "cards" ? data.rows.map((row) => toCardView(row, today)) : [],
    total: data.total,
    rangeLabel: formatCountRange(first, first + data.rows.length - 1, data.total),
    page: state.page,
    pages: pageCount(data.total),
  };
}

/** Every activity, filtered, sorted and paged, with all of that in the URL. */
export function ActivitiesPage() {
  const { state, update } = useListState();
  const query = useActivities(toApiParams(state));
  const { data } = query;
  const results = useMemo(() => (data ? toResultsPage(data, state) : undefined), [data, state]);
  // The routes come after the list, so the cards are on screen while they load. While
  // the next page loads, the dimmed page on screen keeps its own, already cached.
  const routeIds = useMemo(
    () =>
      state.view === "cards" && data
        ? data.rows.filter((row) => row.hasGps).map((row) => row.id)
        : [],
    [state.view, data],
  );
  const previews = useActivityPreviews(routeIds);
  // No routes to ask for, or asking failed: the map cards show their sport instead.
  const routes = routeIds.length === 0 || previews.isError ? {} : previews.data;

  // The selection is cross-view state: /compare reads the same ids.
  const selectedIds = useUiStore((s) => s.selectedActivityIds);
  const toggleSelected = useUiStore((s) => s.toggleSelected);
  const clearSelected = useUiStore((s) => s.clearSelected);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <div className="flex flex-col gap-6">
      <ActivityFilters
        state={state}
        types={data?.types ?? []}
        onChange={(patch) => update(withFilters(state, patch))}
        onSearch={(q) => update(withFilters(state, { q }), { replace: true })}
      />
      <CompareBar selected={selectedIds} onClear={clearSelected} />
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm tabular-nums">{results?.rangeLabel}</span>
        <div className="ml-auto flex items-center gap-2">
          {state.view === "cards" && (
            <SortSelect
              sort={state.sort}
              order={state.order}
              onSort={(column) => update(toggleSort(state, column))}
            />
          )}
          <ViewToggle value={state.view} onChange={(view) => update({ ...state, view })} />
        </div>
      </div>
      <ActivityResults
        results={results}
        view={state.view}
        previews={routes}
        selected={selected}
        onSelect={toggleSelected}
        error={query.error}
        stale={query.isPlaceholderData}
        sort={state.sort}
        order={state.order}
        filtered={hasFilters(state)}
        onSort={(column) => update(toggleSort(state, column))}
        onPage={(page) => update({ ...state, page })}
        onClearFilters={() => update(clearFilters(state))}
      />
    </div>
  );
}
