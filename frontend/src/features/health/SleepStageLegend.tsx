import { SLEEP_STAGES, sleepStageColors } from "@/charts/health/buildSleepStagesOption";
import { useTokens } from "@/design/theme";

/**
 * Three stacked stages are not obvious from the bar alone, so they get a legend. It
 * reads the same `sleepStageColors` the chart does, so the two cannot drift apart.
 */
export function SleepStageLegend() {
  const colors = sleepStageColors(useTokens());

  return (
    <span className="flex items-center gap-2">
      {SLEEP_STAGES.map((stage) => (
        <span key={stage.label} className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ backgroundColor: colors[stage.color] }} />
          {stage.label}
        </span>
      ))}
    </span>
  );
}
