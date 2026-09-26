import { useMemo } from "react";
import type { DailyRow } from "@/api/queries/useHealth";
import { buildSleepStagesOption } from "@/charts/health/buildSleepStagesOption";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { SleepStageLegend } from "@/features/health/SleepStageLegend";
import { hasSleepStages, sleepNights } from "@/features/health/sleepStages";

const SLEEP_CHART_HEIGHT = 220;

/** The page's hero: what each night was made of, one stacked bar a night. */
export function SleepStagesChart({ rows }: { rows: readonly DailyRow[] }) {
  const tokens = useTokens();
  const nights = useMemo(() => sleepNights(rows), [rows]);
  const option = useMemo(() => buildSleepStagesOption({ nights, tokens }), [nights, tokens]);

  if (!hasSleepStages(nights)) return null;

  return (
    <HealthChart
      label="Sleep stages"
      option={option}
      height={SLEEP_CHART_HEIGHT}
      legend={<SleepStageLegend />}
    />
  );
}
