import { useMemo } from "react";
import type { ActivityPage } from "@/api/queries/useActivities";
import { useActivities } from "@/api/queries/useActivities";
import { ActivityFilters } from "@/features/activities/ActivityFilters";
import { ActivityResults, type ResultsPage } from "@/features/activities/ActivityResults";
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
import { useListState } from "@/features/activities/useListState";
import { formatCountRange } from "@/lib/format";
import { useUiStore } from "@/store/ui";

function toResultsPage(data: ActivityPage, state: ListState): ResultsPage {
  const first = (state.page - 1) * PAGE_SIZE + 1;
  const today = new Date();
  return {
    rows: data.rows.map((row) => toRowView(row, today)),
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
      <ActivityResults
        results={results}
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
