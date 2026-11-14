import { hrZoneColor } from "@/design/scales";
import { useTokens } from "@/design/theme";
import {
  heartRateZone,
  readoutAt,
  readoutLabels,
  type ReadoutSeries,
} from "@/features/activity/readout";
import type { ActivityKind } from "@/lib/activityKind";

interface ReplayReadoutProps {
  series: ReadoutSeries;
  /** Where the replay is, in the activity's `elapsed_s`. */
  seconds: number;
  /** The replay's speed (50×, 100×, 200×), which sets how much of the activity is averaged. */
  replaySpeed: number;
  kind: ActivityKind;
  hrRest?: number | null;
  hrMax?: number | null;
}

/** How far, how fast and how hard, at the moment the replay is on. */
export function ReplayReadout({
  series,
  seconds,
  replaySpeed,
  kind,
  hrRest,
  hrMax,
}: ReplayReadoutProps) {
  const tokens = useTokens();
  const readout = readoutAt(series, seconds, replaySpeed);
  const labels = readoutLabels(kind, readout);
  const zone = heartRateZone(readout.hr, hrRest, hrMax);

  return (
    <div
      role="group"
      aria-label="Replay readout"
      className="bg-background/90 pointer-events-none flex items-start gap-6 rounded-lg px-3.5 py-2 shadow-sm backdrop-blur"
    >
      <Figure label="Distance" value={labels.distance} />
      <Figure label={labels.speed.label} value={labels.speed.value} />
      <Figure
        label="Heart rate"
        value={labels.heartRate}
        dot={zone === null ? undefined : hrZoneColor(tokens, zone)}
      />
    </div>
  );
}

function Figure({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return (
    <div className="flex min-w-[4.5rem] flex-col gap-0.5 whitespace-nowrap">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
        {dot && (
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: dot }}
          />
        )}
        {value}
      </span>
    </div>
  );
}
