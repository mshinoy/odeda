import { Skeleton } from "@/components/ui/skeleton";

export function StatusPageSkeleton() {
  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-12 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}
