import { Skeleton } from "@/components/ui/skeleton";

export function HealthPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-72 rounded-lg" />
      <Skeleton className="h-[520px] rounded-2xl" />
      <Skeleton className="h-[360px] rounded-2xl" />
      <Skeleton className="h-[240px] rounded-2xl" />
    </div>
  );
}
