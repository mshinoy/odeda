import { useConfig } from "@/api/queries/useSettings";
import type { GarminStatus, SyncStatus } from "@/api/queries/useStatus";
import { lastSyncedAt } from "@/api/queries/useStatus";
import type { components } from "@/api/schema";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { formatAgo, formatDate, formatPercent } from "@/lib/format";

type DayRange = components["schemas"]["DayRange"];

interface SyncStripProps {
  garmin: GarminStatus;
  sync: SyncStatus;
  dayRange: DayRange;
  onSync: () => void;
  syncStarting: boolean;
  syncError: string | null;
}

/** One quiet line: is Garmin connected, when did it last sync, what range is on file. */
export function SyncStrip({
  garmin,
  sync,
  dayRange,
  onSync,
  syncStarting,
  syncError,
}: SyncStripProps) {
  const { data: config } = useConfig();
  const running = sync.state === "running";
  const failed = sync.state === "error";

  // A read-only demo is not connected to anything and cannot sync, so say what the data
  // covers and nothing else, rather than a red "not connected" and a button that fails.
  if (config?.demo) {
    return (
      <footer className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-sm">
        <span>Synthetic demo data</span>
        <span>
          {formatDate(dayRange.from)} → {formatDate(dayRange.to)}
        </span>
      </footer>
    );
  }

  return (
    <footer className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-sm">
      <StatusDot
        tone={garmin.connected ? "good" : "critical"}
        label={garmin.connected ? "Garmin connected" : "Garmin not connected"}
      />
      <span>Synced {formatAgo(lastSyncedAt(sync))}</span>
      <span>
        {formatDate(dayRange.from)} → {formatDate(dayRange.to)}
      </span>
      {failed && sync.last_error && <span className="text-delta-bad">{sync.last_error}</span>}
      {syncError && <span className="text-delta-bad">{syncError}</span>}

      <span className="ml-auto">
        {running ? (
          <span>
            Syncing {sync.phase} · {formatPercent(sync.pct)}
          </span>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={onSync}
            disabled={!garmin.connected || syncStarting}
          >
            Sync now
          </Button>
        )}
      </span>
    </footer>
  );
}
