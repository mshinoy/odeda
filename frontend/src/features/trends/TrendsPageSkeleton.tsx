import { Skeleton } from "@/components/ui/skeleton";

export function TrendsPageSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((card) => (
          <Skeleton key={card} className="h-14 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
    </div>
  );
}
