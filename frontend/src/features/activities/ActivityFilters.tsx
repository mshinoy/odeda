import { Toggle } from "@/components/ui/toggle";
import { DateRangeFields } from "@/features/activities/DateRangeFields";
import type { FilterPatch, ListState } from "@/features/activities/listState";
import { SearchInput } from "@/features/activities/SearchInput";
import { TypeSelect } from "@/features/activities/TypeSelect";

interface ActivityFiltersProps {
  state: ListState;
  types: string[];
  onChange: (patch: FilterPatch) => void;
  /** The search commits separately: it replaces the history entry instead of adding one. */
  onSearch: (q: string) => void;
}

/** Type, date range, races-only and name search, in one row above the list. */
export function ActivityFilters({ state, types, onChange, onSearch }: ActivityFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <TypeSelect types={types} value={state.type} onChange={(type) => onChange({ type })} />
      <DateRangeFields start={state.start} end={state.end} onChange={onChange} />
      <Toggle
        variant="outline"
        pressed={state.race}
        onPressedChange={(race) => onChange({ race })}
        aria-label="Races only"
      >
        Races
      </Toggle>
      <div className="ml-auto">
        <SearchInput value={state.q} onCommit={onSearch} />
      </div>
    </div>
  );
}
