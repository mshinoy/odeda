import { Skeleton } from "@/components/ui/skeleton";

export function TrendsPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-80 rounded-lg" />
      <Skeleton className="h-[460px] rounded-2xl" />
      <Skeleton className="h-[360px] rounded-2xl" />
      <Skeleton className="h-[260px] rounded-2xl" />
    </div>
  );
}
