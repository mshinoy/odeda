import { Skeleton } from "@/components/ui/skeleton";
import { cellClass, columns } from "@/features/activities/columns";
import { cn } from "@/lib/utils";

/** A placeholder row with the same cells as `ActivityRow`, so nothing jumps on load. */
export function ActivityRowSkeleton() {
  return (
    <tr className="border-b">
      {columns.map((column) => (
        <td key={column.id} className={cn("px-3 py-2.5", cellClass(column.id))}>
          <Skeleton className={cn("h-5", column.numeric ? "ml-auto w-14" : "w-24")} />
        </td>
      ))}
    </tr>
  );
}
