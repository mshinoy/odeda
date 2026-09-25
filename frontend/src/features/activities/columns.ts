import type { SortColumn } from "@/features/activities/listState";

export interface Column {
  id: SortColumn | "name" | "select";
  label: string;
  /** Null for a column the API cannot sort by. */
  sort: SortColumn | null;
  numeric: boolean;
  /** Classes shared by the header and the cells, e.g. hiding a column on narrow screens. */
  className: string;
}

// Distance and pace sit side by side, so a gym row's sets · reps cell can span both.
export const columns: readonly Column[] = [
  // The compare picker. Its header is blank: a column heading over a checkbox would
  // be the only word in the row that is not a value.
  { id: "select", label: "", sort: null, numeric: false, className: "w-8" },
  { id: "date", label: "Date", sort: "date", numeric: false, className: "whitespace-nowrap" },
  { id: "name", label: "Name", sort: null, numeric: false, className: "w-full" },
  {
    id: "type",
    label: "Type",
    sort: "type",
    numeric: false,
    className: "hidden whitespace-nowrap sm:table-cell",
  },
  { id: "distance", label: "Distance", sort: "distance", numeric: true, className: "" },
  { id: "pace", label: "Pace", sort: "pace", numeric: true, className: "" },
  { id: "time", label: "Time", sort: "time", numeric: true, className: "hidden md:table-cell" },
  { id: "hr", label: "Avg HR", sort: "hr", numeric: true, className: "hidden md:table-cell" },
];

/** Static class names by column, so Tailwind sees them. */
export function cellClass(id: Column["id"]): string {
  return columns.find((c) => c.id === id)?.className ?? "";
}
