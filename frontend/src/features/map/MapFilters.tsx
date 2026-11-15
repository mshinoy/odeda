import { DateRangeFields } from "@/features/activities/DateRangeFields";
import { TypeSelect } from "@/features/activities/TypeSelect";
import type { MapState } from "@/features/map/mapState";

interface MapFiltersProps {
  state: MapState;
  /** Every activity type in the database, for the select. */
  types: string[];
  onChange: (state: MapState) => void;
}

/** Type and date range, in one row above the map. */
export function MapFilters({ state, types, onChange }: MapFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 [&>div]:w-full">
      <TypeSelect
        types={types}
        value={state.type}
        onChange={(type) => onChange({ ...state, type })}
      />
      <DateRangeFields
        start={state.start}
        end={state.end}
        onChange={(range) => onChange({ ...state, ...range })}
      />
    </div>
  );
}
