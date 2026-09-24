import { Skeleton } from "@/components/ui/skeleton";

export function ActivityPageSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
      <Skeleton className="h-[420px] rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
