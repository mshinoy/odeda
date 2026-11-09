import { Link } from "react-router-dom";
import type { ActivityListItem } from "@/api/adapters";
import type { TrainingLoad } from "@/api/queries/useStatus";
import { KindDot } from "@/features/today/KindDot";
import {
  formatDate,
  formatDecimal,
  formatDistance,
  formatDuration,
  formatSigned,
} from "@/lib/format";

type Current = NonNullable<TrainingLoad["current"]>;

interface StatTilesProps {
  load: Current | null;
  latest: ActivityListItem | undefined;
  /** Running km done over km planned, last 28 days; null with nothing planned. */
  kmDonePct: number | null;
}

function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
}) {
  return (
    <div className="bg-card flex min-w-0 flex-col gap-1 rounded-2xl border p-6">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-stat font-semibold tracking-tight">{value}</span>
      <span className="text-ink-secondary text-sm">{detail}</span>
    </div>
  );
}

/** Three small answers: how fit, what you last did, whether the plan is being followed. */
export function StatTiles({ load, latest, kmDonePct }: StatTilesProps) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {load && (
        <Tile
          label="Fitness"
          value={formatDecimal(load.ctl)}
          detail={`Fatigue ${formatDecimal(load.atl)} · Form ${formatSigned(load.tsb, 0)}, ${load.form}`}
        />
      )}
      {latest && (
        <Link
          to={`/activities/${latest.id}`}
          className="min-w-0 transition-opacity hover:opacity-80"
        >
          <Tile
            label={`Last activity, ${formatDate(latest.day)}`}
            value={formatDistance(latest.distanceM)}
            detail={
              <span className="flex items-center gap-2">
                <KindDot kind={latest.kind} />
                <span className="truncate">
                  {latest.name} · {formatDuration(latest.movingTimeS ?? latest.durationS)}
                </span>
              </span>
            }
          />
        </Link>
      )}
      {kmDonePct !== null && (
        <Tile
          label="Plan, last 4 weeks"
          value={`${Math.round(kmDonePct)}% of km`}
          detail="Running kilometres done against the plan"
        />
      )}
    </div>
  );
}
