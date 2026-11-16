import { lazy, Suspense, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCompare } from "@/api/queries/useCompare";
import { EmptyState } from "@/components/EmptyState";
import { SectionCard } from "@/components/SectionCard";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareCharts } from "@/features/compare/CompareCharts";
import { toCompareRows } from "@/features/compare/compareRows";
import { compareBlockedReason, parseCompareIds } from "@/features/compare/compareSelection";
import { CompareTable } from "@/features/compare/CompareTable";
import { useTokens } from "@/design/theme";
import { supportsWebGL } from "@/map/webgl";

const CompareMap = lazy(() =>
  import("@/features/compare/CompareMap").then((m) => ({ default: m.CompareMap })),
);

/** Two to five activities side by side: their tracks overlaid, then pace and HR. */
export function ComparePage() {
  const [params] = useSearchParams();
  const tokens = useTokens();
  // The URL is the only copy of what is being compared, so the view is shareable.
  const ids = useMemo(() => parseCompareIds(params.get("ids")), [params]);
  const blocked = compareBlockedReason(ids.length);
  const { data, isPending, error } = useCompare(blocked === null ? ids : []);

  const rows = useMemo(() => (data ? toCompareRows(data, tokens) : []), [data, tokens]);

  if (blocked !== null) {
    return (
      <EmptyState
        message="Pick two to five activities to compare."
        action={
          <Link to="/activities" className="text-foreground underline underline-offset-4">
            Activities
          </Link>
        }
      />
    );
  }
  if (error) return <EmptyState message={error.message} />;
  if (isPending || !data) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (data.length === 0) return <EmptyState message="None of those activities exists." />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Compare</h1>
        <span className="text-muted-foreground text-sm">{data.length} activities side by side</span>
      </div>

      {supportsWebGL() && (
        <section className="bg-card shadow-card relative h-[420px] overflow-hidden rounded-2xl border">
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            <CompareMap attempts={data} />
          </Suspense>
        </section>
      )}

      <SectionCard
        title="The activities"
        question="Which colour is which, and how did they compare?"
      >
        <CompareTable rows={rows} />
      </SectionCard>
      <SectionCard title="Pace and heart rate" question="Who was faster, and at what cost?">
        <CompareCharts attempts={data} />
      </SectionCard>
    </div>
  );
}
