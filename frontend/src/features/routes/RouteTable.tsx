import { Link } from "react-router-dom";
import { KindBadge } from "@/components/KindBadge";
import { Skeleton } from "@/components/ui/skeleton";
import type { RouteRowView } from "@/features/routes/routeRowView";
import { cn } from "@/lib/utils";

const SKELETON_ROWS = 10;
const skeletonKeys = Array.from({ length: SKELETON_ROWS }, (_, i) => i);

const cell = "px-3 py-2.5";
const numericCell = cn(cell, "text-right whitespace-nowrap");
const headCell = "px-3 py-2 text-left font-normal text-muted-foreground";
const numericHead = cn(headCell, "text-right");
// Type and shape say the same thing twice on a narrow screen; the shape goes first.
const wideOnly = "hidden md:table-cell";
// "Out and back" is three words and would otherwise set the row's height on its own.
const shapeCell = cn(cell, "text-muted-foreground whitespace-nowrap", wideOnly);

/** Every route, busiest first, or skeleton rows until the first fetch lands. */
export function RouteTable({ rows }: { rows: RouteRowView[] | undefined }) {
  return (
    <table className="w-full text-sm">
      <thead className="border-b">
        <tr>
          <th className={cn(headCell, "w-full")}>Route</th>
          <th className={cn(headCell, "whitespace-nowrap")}>Type</th>
          <th className={cn(headCell, "whitespace-nowrap", wideOnly)}>Shape</th>
          <th className={numericHead}>Attempts</th>
          <th className={numericHead}>Distance</th>
          <th className={numericHead}>Best</th>
          <th className={numericHead}>Median</th>
          <th className={cn(numericHead, wideOnly)}>Last</th>
        </tr>
      </thead>
      <tbody>
        {rows
          ? rows.map((row) => <RouteRow key={row.id} row={row} />)
          : skeletonKeys.map((key) => <RouteRowSkeleton key={key} />)}
      </tbody>
    </table>
  );
}

function RouteRow({ row }: { row: RouteRowView }) {
  return (
    <tr className="hover:bg-muted/60 relative border-b transition-colors">
      <td className={cn(cell, "font-medium")}>
        <Link
          to={row.href}
          className="focus-visible:after:ring-ring after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
        >
          {row.name}
        </Link>
      </td>
      <td className={cell}>
        <KindBadge kind={row.kind} label={row.typeLabel} />
      </td>
      <td className={shapeCell}>{row.shape}</td>
      <td className={numericCell}>{row.attempts}</td>
      <td className={numericCell}>{row.distance}</td>
      <td className={numericCell}>{row.best}</td>
      <td className={numericCell}>{row.median}</td>
      <td className={cn(numericCell, "text-muted-foreground", wideOnly)}>{row.last}</td>
    </tr>
  );
}

function RouteRowSkeleton() {
  return (
    <tr className="border-b">
      <td className={cell} colSpan={8}>
        <Skeleton className="h-5 w-full" />
      </td>
    </tr>
  );
}
