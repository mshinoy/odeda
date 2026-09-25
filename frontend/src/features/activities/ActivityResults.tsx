import { EmptyState } from "@/components/EmptyState";
import { ActivityRow } from "@/features/activities/ActivityRow";
import { ActivityRowSkeleton } from "@/features/activities/ActivityRowSkeleton";
import { ActivityTable } from "@/features/activities/ActivityTable";
import { ListEmptyState } from "@/features/activities/ListEmptyState";
import type { SortColumn, SortOrder } from "@/features/activities/listState";
import { Pager } from "@/features/activities/Pager";
import type { ActivityRowView } from "@/features/activities/rowView";

const SKELETON_ROWS = 12;
const skeletonKeys = Array.from({ length: SKELETON_ROWS }, (_, i) => i);

export interface ResultsPage {
  rows: ActivityRowView[];
  total: number;
  /** "1–50 of 488". */
  rangeLabel: string;
  page: number;
  pages: number;
}

interface ActivityResultsProps {
  /** Undefined until the first page arrives. */
  results: ResultsPage | undefined;
  /** The ticked activities, for the compare picker. */
  selected: ReadonlySet<string>;
  onSelect: (id: string) => void;
  error: Error | null;
  stale: boolean;
  sort: SortColumn;
  order: SortOrder;
  filtered: boolean;
  onSort: (column: SortColumn) => void;
  onPage: (page: number) => void;
  onClearFilters: () => void;
}

/** The table and pager, or skeleton rows while loading, or the empty state. */
export function ActivityResults({
  results,
  selected,
  onSelect,
  error,
  stale,
  sort,
  order,
  filtered,
  onSort,
  onPage,
  onClearFilters,
}: ActivityResultsProps) {
  if (error) return <EmptyState message={error.message} />;
  if (results?.total === 0) return <ListEmptyState filtered={filtered} onClear={onClearFilters} />;

  return (
    <div className="flex flex-col gap-4">
      <ActivityTable sort={sort} order={order} onSort={onSort} stale={stale}>
        {results
          ? results.rows.map((row) => (
              <ActivityRow
                key={row.id}
                row={row}
                selected={selected.has(row.id)}
                onSelect={onSelect}
              />
            ))
          : skeletonKeys.map((key) => <ActivityRowSkeleton key={key} />)}
      </ActivityTable>
      {results && (
        <Pager
          label={results.rangeLabel}
          page={results.page}
          pages={results.pages}
          onPage={onPage}
        />
      )}
    </div>
  );
}
