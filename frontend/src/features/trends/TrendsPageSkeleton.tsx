import { Skeleton } from "@/components/ui/skeleton";

export function TrendsPageSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
      <Skeleton className="h-52 rounded-xl" />
    </div>
  );
}
