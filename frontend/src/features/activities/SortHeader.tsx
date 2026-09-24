import { ArrowDown, ArrowUp } from "lucide-react";
import type { Column } from "@/features/activities/columns";
import type { SortColumn, SortOrder } from "@/features/activities/listState";
import { cn } from "@/lib/utils";

interface SortHeaderProps {
  column: Column;
  /** The order this column is sorted in, or null when the list is sorted by another. */
  activeOrder: SortOrder | null;
  onSort: (column: SortColumn) => void;
}

const ariaSort = { asc: "ascending", desc: "descending" } as const;

export function SortHeader({ column, activeOrder, onSort }: SortHeaderProps) {
  const sort = column.sort;
  const Arrow = activeOrder === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      scope="col"
      aria-sort={activeOrder ? ariaSort[activeOrder] : undefined}
      className={cn(
        "text-muted-foreground px-3 py-2 text-xs font-medium",
        column.numeric ? "text-right" : "text-left",
        column.className,
      )}
    >
      {sort ? (
        <button
          type="button"
          onClick={() => onSort(sort)}
          className={cn(
            "hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap transition-colors",
            activeOrder && "text-foreground",
          )}
        >
          {column.label}
          {activeOrder && <Arrow className="size-3" aria-hidden />}
        </button>
      ) : (
        column.label
      )}
    </th>
  );
}
