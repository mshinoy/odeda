import { Link } from "react-router-dom";
import { useOverridesSummary } from "@/api/queries/useSettings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/StatCard";
import { EDITED_ACTIVITIES_QUERY } from "@/features/activities/listState";
import { toEditCounts } from "@/features/settings/editSummary";
import { formatInteger } from "@/lib/format";

/** What the user has corrected, and how to find it. */
export function EditsPanel() {
  const summary = useOverridesSummary();

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-muted-foreground text-xs">Your edits</h2>

      {summary.isPending && <Skeleton className="h-20 w-full max-w-lg" />}
      {summary.error && <p className="text-delta-bad text-sm">{summary.error.message}</p>}

      {summary.data &&
        (summary.data.total === 0 ? (
          // Not the centred `EmptyState`: this is one panel among five left-aligned
          // ones, and a centred block in the middle of them reads as a broken page.
          <div className="flex flex-col items-start gap-3">
            <p className="text-muted-foreground text-sm">You have not corrected anything yet.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/activities">Open an activity</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="grid max-w-lg grid-cols-2 gap-6">
              <StatCard label="Edits" value={formatInteger(summary.data.total)} />
              <StatCard
                label="Activities edited"
                value={formatInteger(summary.data.activities_edited)}
              />
            </div>

            <ul className="text-muted-foreground flex max-w-lg flex-col gap-1 text-sm">
              {toEditCounts(summary.data).map((row) => (
                <li key={row.key} className="flex justify-between border-b py-1.5">
                  <span>{row.label}</span>
                  <span className="text-foreground tabular-nums">{formatInteger(row.n)}</span>
                </li>
              ))}
            </ul>

            <div>
              <Button asChild variant="outline" size="sm">
                <Link to={`/activities${EDITED_ACTIVITIES_QUERY}`}>See the edited activities</Link>
              </Button>
            </div>
          </div>
        ))}
    </section>
  );
}
