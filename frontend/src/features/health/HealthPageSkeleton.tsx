import { Skeleton } from "@/components/ui/skeleton";

export function HealthPageSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <Skeleton className="h-8 w-72 rounded-lg" />
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((card) => (
          <Skeleton key={card} className="h-14 rounded-lg" />
        ))}
      </div>
      {/* Body composition: six cards and two charts. */}
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <Skeleton key={card} className="h-14 rounded-lg" />
        ))}
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
      <Skeleton className="h-56 rounded-xl" />
      <div className="grid gap-8 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
