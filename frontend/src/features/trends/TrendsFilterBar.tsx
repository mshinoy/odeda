import type { components } from "@/api/schema";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { DateRangeFields } from "@/features/activities/DateRangeFields";
import { TypeSelect } from "@/features/activities/TypeSelect";
import {
  gearName,
  hasFilters,
  NO_FILTERS,
  type TrendsFilters,
} from "@/features/trends/trendsFilters";

type FilterGear = components["schemas"]["FilterGear"];

interface TrendsFilterBarProps {
  filters: TrendsFilters;
  /** Every type recorded, most common first. */
  types: string[];
  /** Every piece of gear owned; empty for an account that has never named any. */
  gear: readonly FilterGear[];
  onChange: (filters: TrendsFilters) => void;
}

const ANY_GEAR = "";

/** Type, dates and gear, in one row. Everything below it answers to these. */
export function TrendsFilterBar({ filters, types, gear, onChange }: TrendsFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <TypeSelect
        types={types}
        value={filters.type}
        onChange={(type) => onChange({ ...filters, type })}
      />
      <DateRangeFields
        start={filters.start}
        end={filters.end}
        onChange={({ start, end }) => onChange({ ...filters, start, end })}
      />
      {/* No gear, no select: an empty dropdown is a control that does nothing. */}
      {gear.length > 0 && (
        <NativeSelect
          aria-label="Gear"
          value={filters.gearId === null ? ANY_GEAR : String(filters.gearId)}
          onChange={(event) => onChange({ ...filters, gearId: Number(event.target.value) || null })}
        >
          <option value={ANY_GEAR}>Any gear</option>
          {gear.map((item) => (
            <option key={item.gear_id} value={item.gear_id}>
              {gearName(item)}
            </option>
          ))}
        </NativeSelect>
      )}
      {hasFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
          Clear
        </Button>
      )}
    </div>
  );
}
