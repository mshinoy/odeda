import { useMemo } from "react";
import type { DailyRow } from "@/api/queries/useHealth";
import { buildSleepStagesOption } from "@/charts/health/buildSleepStagesOption";
import { resolutionFor, resolveRows } from "@/charts/health/resolution";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";
import { SleepStageLegend } from "@/features/health/SleepStageLegend";
import { hasSleepStages, sleepNights } from "@/features/health/sleepStages";

const SLEEP_CHART_HEIGHT = 260;

/** The page's hero: what each night was made of, one stacked bar a night (a week's average past a quarter). */
export function SleepStagesChart({ rows }: { rows: readonly DailyRow[] }) {
  const tokens = useTokens();
  const resolution = resolutionFor(rows.length);
  const nights = useMemo(() => sleepNights(resolveRows(rows, resolution)), [rows, resolution]);
  const option = useMemo(
    () => buildSleepStagesOption({ nights, tokens, resolution }),
    [nights, tokens, resolution],
  );

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
