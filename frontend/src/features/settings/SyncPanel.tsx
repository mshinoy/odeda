import { useGarminStatus } from "@/api/queries/useGarmin";
import { useSyncEstimate, useStopSync } from "@/api/queries/useSettings";
import { lastSyncedAt, useStartSync, useSyncStatus } from "@/api/queries/useStatus";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/StatusDot";
import { WatermarkTable } from "@/features/settings/WatermarkTable";
import { estimateFacts, formatEstimateRange } from "@/features/settings/syncEstimate";
import { formatAgo, formatPercent } from "@/lib/format";

/** Start or stop a backfill, see what it would cost, and how far each endpoint got. */
export function SyncPanel() {
  const garmin = useGarminStatus();
  const sync = useSyncStatus();
  const estimate = useSyncEstimate();
  const start = useStartSync();
  const stop = useStopSync();

  const running = sync.data?.state === "running";
  const connected = garmin.data?.connected === true;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-muted-foreground text-xs">Sync</h2>

      {sync.isPending && <Skeleton className="h-24 w-full max-w-lg" />}
      {sync.error && <p className="text-delta-bad text-sm">{sync.error.message}</p>}

      {sync.data && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {running ? (
              <StatusDot
                tone="warning"
                label={`Syncing ${sync.data.phase ?? ""} · ${formatPercent(sync.data.pct)}`}
              />
            ) : (
              <StatusDot
                tone={sync.data.state === "error" ? "critical" : "neutral"}
                label={`Last synced ${formatAgo(lastSyncedAt(sync.data))}`}
              />
            )}

            {running ? (
              <Button
                variant="outline"
                size="sm"
                disabled={stop.isPending}
                onClick={() => stop.mutate()}
              >
                Stop
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={!connected || start.isPending}
                onClick={() => start.mutate()}
              >
                Sync now
              </Button>
            )}
          </div>

          {!connected && (
            <p className="text-muted-foreground text-sm">Connect a Garmin account above to sync.</p>
          )}
          {sync.data.state === "error" && sync.data.last_error && (
            <p className="text-delta-bad text-sm">{sync.data.last_error}</p>
          )}
          {start.error && <p className="text-delta-bad text-sm">{start.error.message}</p>}
          {stop.error && <p className="text-delta-bad text-sm">{stop.error.message}</p>}

          {estimate.data && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                A full backfill is about {formatEstimateRange(estimate.data)}.
              </p>
              <dl className="text-muted-foreground flex flex-wrap gap-x-8 gap-y-1 text-xs">
                {estimateFacts(estimate.data).map((fact) => (
                  <div key={fact.label} className="flex gap-2">
                    <dt>{fact.label}</dt>
                    <dd className="text-foreground">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          <WatermarkTable watermarks={sync.data.watermarks} />
        </div>
      )}
    </section>
  );
}
