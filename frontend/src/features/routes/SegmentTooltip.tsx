import type { RouteSegment } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import { formatDistance, formatHeartRate, formatRelative, formatSportSpeed } from "@/lib/format";

interface SegmentTooltipProps {
  segment: RouteSegment;
  /** Picks the unit for the pace: /km on foot, km/h on a bike. */
  kind: ActivityKind;
}

/** What the hovered stretch of the route usually does. Four numbers, no prose. */
export function SegmentTooltip({ segment, kind }: SegmentTooltipProps) {
  return (
    <dl className="bg-background/90 grid grid-cols-[auto_auto] gap-x-4 gap-y-1 rounded-lg px-3 py-2 text-xs tabular-nums shadow-sm backdrop-blur">
      <Row label="From" value={formatDistance(segment.startM)} />
      <Row label="Pace" value={formatSportSpeed(segment.medianSpeedMps, kind)} />
      <Row label="Against average" value={formatRelative(segment.relativeSpeed)} />
      <Row label="Avg HR" value={formatHeartRate(segment.medianHr)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </>
  );
}
