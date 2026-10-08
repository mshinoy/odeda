import { Skeleton } from "@/components/ui/skeleton";

/** A placeholder card the shape of `ActivityCard`, so nothing jumps on load. */
export function ActivityCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border sm:flex-row">
      <Skeleton className="aspect-[4/3] w-full shrink-0 rounded-none sm:aspect-auto sm:min-h-[180px] sm:w-[240px]" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-32" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-10" />
          ))}
        </div>
      </div>
    </div>
  );
}
