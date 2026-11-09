import { Skeleton } from "@/components/ui/skeleton";

export function TodayPageSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
      <Skeleton className="h-96 rounded-2xl" />
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}
