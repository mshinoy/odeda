import { ArrowDown, ArrowUp } from "lucide-react";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { columns } from "@/features/activities/columns";
import type { SortColumn, SortOrder } from "@/features/activities/listState";

interface SortSelectProps {
  sort: SortColumn;
  order: SortOrder;
  /** The same as clicking a table header: a new column starts at its first order. */
  onSort: (column: SortColumn) => void;
}

const sortable = columns.flatMap((column) =>
  column.sort ? [{ ...column, sort: column.sort }] : [],
);

/** The cards' stand-in for the table's clickable headers: what to sort by, and which way. */
export function SortSelect({ sort, order, onSort }: SortSelectProps) {
  const Arrow = order === "asc" ? ArrowUp : ArrowDown;
  return (
    <div className="flex items-center gap-1">
      <NativeSelect
        aria-label="Sort by"
        value={sort}
        onChange={(event) => {
          const next = sortable.find((column) => column.sort === event.target.value);
          if (next) onSort(next.sort);
        }}
      >
        {sortable.map((column) => (
          <option key={column.sort} value={column.sort}>
            {column.label}
          </option>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        size="icon"
        aria-label={order === "asc" ? "Ascending, reverse" : "Descending, reverse"}
        onClick={() => onSort(sort)}
      >
        <Arrow aria-hidden />
      </Button>
    </div>
  );
}
