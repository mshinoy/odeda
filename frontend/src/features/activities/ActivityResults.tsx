import { EmptyState } from "@/components/EmptyState";
import { ActivityCard } from "@/features/activities/ActivityCard";
import { ActivityCards } from "@/features/activities/ActivityCards";
import { ActivityCardSkeleton } from "@/features/activities/ActivityCardSkeleton";
import { ActivityRow } from "@/features/activities/ActivityRow";
import { ActivityRowSkeleton } from "@/features/activities/ActivityRowSkeleton";
import { ActivityTable } from "@/features/activities/ActivityTable";
import { ListEmptyState } from "@/features/activities/ListEmptyState";
import type { ActivityCardView } from "@/features/activities/cardView";
import type { ListView, SortColumn, SortOrder } from "@/features/activities/listState";
import { Pager } from "@/features/activities/Pager";
import type { ActivityRowView } from "@/features/activities/rowView";
import { mapProvider } from "@/map/basemap";

const SKELETON_ROWS = 12;
const skeletonKeys = Array.from({ length: SKELETON_ROWS }, (_, i) => i);

export interface ResultsPage {
  rows: ActivityRowView[];
  cards: ActivityCardView[];
  total: number;
  /** "1–50 of 488". */
  rangeLabel: string;
  page: number;
  pages: number;
}

interface ActivityResultsProps {
  /** Undefined until the first page arrives. */
  results: ResultsPage | undefined;
  view: ListView;
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

/** The cards or the table, and the pager; skeletons while loading, or the empty state. */
export function ActivityResults({
  results,
  view,
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
      {view === "cards" ? (
        <ActivityCards stale={stale}>
          {results
            ? results.cards.map((card) => (
                <ActivityCard
                  key={card.id}
                  card={card}
                  selected={selected.has(card.id)}
                  onSelect={onSelect}
                />
              ))
            : skeletonKeys.map((key) => <ActivityCardSkeleton key={key} />)}
        </ActivityCards>
      ) : (
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
      )}
      {results && (
        <Pager
          label={results.rangeLabel}
          page={results.page}
          pages={results.pages}
          onPage={onPage}
        />
      )}
      {view === "cards" && mapProvider === "mapbox" && <MapAttribution />}
    </div>
  );
}

/** Mapbox's logo and credit are off the small card maps, so they are given once here. */
function MapAttribution() {
  return (
    <p className="text-muted-foreground text-right text-xs">
      <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer">
        © Mapbox
      </a>{" "}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap
      </a>
    </p>
  );
}
