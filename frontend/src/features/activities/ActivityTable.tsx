import type { ReactNode } from "react";
import { columns } from "@/features/activities/columns";
import type { SortColumn, SortOrder } from "@/features/activities/listState";
import { SortHeader } from "@/features/activities/SortHeader";
import { cn } from "@/lib/utils";

interface ActivityTableProps {
  sort: SortColumn;
  order: SortOrder;
  onSort: (column: SortColumn) => void;
  /** True while the next page or sort loads: the current rows stay, dimmed. */
  stale: boolean;
  /** The body rows: `ActivityRow`s, or `ActivityRowSkeleton`s while loading. */
  children: ReactNode;
}

export function ActivityTable({ sort, order, onSort, stale, children }: ActivityTableProps) {
  return (
    <table
      className={cn("w-full text-sm transition-opacity", stale && "opacity-60")}
      aria-busy={stale}
    >
      <thead className="border-b">
        <tr>
          {columns.map((column) => (
            <SortHeader
              key={column.id}
              column={column}
              activeOrder={column.sort === sort ? order : null}
              onSort={onSort}
            />
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
