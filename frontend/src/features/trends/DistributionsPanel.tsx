import { useMemo } from "react";
import type { components } from "@/api/schema";
import { HrZonesChart } from "@/features/activity/HrZonesChart";
import { DayHourGrid } from "@/features/trends/DayHourGrid";
import {
  DISTANCE_HISTOGRAM,
  HR_HISTOGRAM,
  PACE_HISTOGRAM,
  zoneCoverageNote,
  zoneTimes,
} from "@/features/trends/distributions";
import { hasDayHourData } from "@/features/trends/dayHour";
import { HistogramChart } from "@/features/trends/HistogramChart";
import { formatInteger } from "@/lib/format";

type Distributions = components["schemas"]["Distributions"];
type Patterns = components["schemas"]["Patterns"];

interface DistributionsPanelProps {
  distributions: Distributions;
  patterns: Patterns;
  /** Moving time over everything, so the HR-zone bar can say how little it covers. */
  totalMovingTimeS: number;
}

/** The shape of the history: how the sessions spread out, and when they happen. */
export function DistributionsPanel({
  distributions,
  patterns,
  totalMovingTimeS,
}: DistributionsPanelProps) {
  const zones = useMemo(() => zoneTimes(distributions.hr_zones), [distributions.hr_zones]);
  const zoneSeconds = zones.reduce((sum, zone) => sum + zone.seconds, 0);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-2">
        <HistogramChart
          buckets={distributions.pace}
          spec={PACE_HISTOGRAM}
          sampleSize={distributions.sample_size}
        />
        <HistogramChart
          buckets={distributions.distance_km}
          spec={DISTANCE_HISTOGRAM}
          sampleSize={distributions.sample_size}
        />
        <HistogramChart
          buckets={distributions.avg_hr}
          spec={HR_HISTOGRAM}
          sampleSize={distributions.sample_size}
        />
      </div>

      {zones.length > 0 && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground flex items-baseline gap-2 text-xs">
            Time in HR zones
            <span className="tabular-nums">{zoneCoverageNote(zoneSeconds, totalMovingTimeS)}</span>
          </figcaption>
          <HrZonesChart zones={zones} />
        </figure>
      )}

      {hasDayHourData(patterns) && (
        <figure className="flex flex-col gap-3">
          <figcaption className="text-muted-foreground flex items-baseline gap-2 text-xs">
            Week
            <span className="tabular-nums">{formatInteger(patterns.total)} activities</span>
          </figcaption>
          <DayHourGrid patterns={patterns} />
        </figure>
      )}
    </div>
  );
}
