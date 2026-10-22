// Sleep composition, one stacked bar per night: deep at the base, then REM, then light.
// The stages are ordinal, so they take three steps of the one magnitude ramp rather than
// three categorical colours — the deepest sleep is the strongest step.
import {
  axisLabelStyle,
  barHoverPointer,
  gridLineStyle,
  hoveredIndex,
  quietAxis,
  tooltipHtml,
  tooltipStyle,
  type TooltipCard,
} from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID } from "@/charts/health/dayAxis";
import { dayHeading, type Resolution } from "@/charts/health/resolution";
import { metricColor } from "@/design/scales";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { nightTotalH, type SleepNight } from "@/features/health/sleepStages";
import { formatDecimal, formatWithUnit, MISSING } from "@/lib/format";

export interface SleepStagesInput {
  /** Already at `resolution`: a week's average night per bar when that is "week". */
  nights: readonly SleepNight[];
  tokens: ColorTokens;
  today?: Date;
  resolution?: Resolution;
}

export interface SleepStageColors {
  deep: string;
  rem: string;
  light: string;
}

/** Deep at the strong end of the ramp, light at the pale end. The legend reads these too. */
export function sleepStageColors(tokens: ColorTokens): SleepStageColors {
  return {
    deep: metricColor(tokens, 1),
    rem: metricColor(tokens, 0.5),
    light: metricColor(tokens, 0),
  };
}

/** The order the bar is stacked in, base first, and the label each stage carries. */
export const SLEEP_STAGES = [
  { value: "deepH", color: "deep", label: "Deep" },
  { value: "remH", color: "rem", label: "REM" },
  { value: "lightH", color: "light", label: "Light" },
] as const satisfies readonly {
  value: keyof Omit<SleepNight, "day">;
  color: keyof SleepStageColors;
  label: string;
}[];

/** Hours between ticks, and the shortest axis a night is drawn against. */
const HOURS_PER_TICK = 4;
const MIN_AXIS_HOURS = 8;

/** The top of the axis: the longest night, rounded up to a whole tick. */
export function sleepAxisMaxH(nights: readonly SleepNight[]): number {
  const longest = nights.reduce((peak, night) => Math.max(peak, nightTotalH(night) ?? 0), 0);
  const rounded = Math.ceil(longest / HOURS_PER_TICK) * HOURS_PER_TICK;
  return Math.max(rounded, MIN_AXIS_HOURS);
}

/** "Sep 23": the night's total, then each stage in hours; a week reads "Week of Sep 23" and the average night. */
export function sleepNightTooltip(
  night: SleepNight,
  today?: Date,
  resolution: Resolution = "day",
  tokens?: ColorTokens,
): TooltipCard {
  const total = nightTotalH(night);
  const colors = tokens === undefined ? undefined : sleepStageColors(tokens);
  return {
    heading: dayHeading(night.day, resolution, today),
    rows: [
      { label: "Total", value: total === null ? MISSING : formatWithUnit(total, "h", 1) },
      ...SLEEP_STAGES.map((stage) => ({
        label: stage.label,
        value: formatWithUnit(night[stage.value], "h", 1),
        color: colors?.[stage.color],
      })),
    ],
  };
}

export function buildSleepStagesOption({
  nights,
  tokens,
  today,
  resolution = "day",
}: SleepStagesInput): ChartOption {
  const colors = sleepStageColors(tokens);
  const maxH = sleepAxisMaxH(nights);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: HEALTH_CHART_GRID,
    xAxis: dayAxis(
      nights.map((night) => night.day),
      tokens,
      today,
    ),
    yAxis: {
      type: "value",
      min: 0,
      max: maxH,
      interval: HOURS_PER_TICK,
      ...quietAxis,
      splitLine: gridLineStyle(tokens),
      // "h" once, on the top tick, as the pace axis carries "/km".
      axisLabel: {
        ...axisLabelStyle(tokens),
        formatter: (value: number) =>
          value === maxH ? formatWithUnit(value, "h") : formatDecimal(value, 0),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: barHoverPointer(tokens),
      formatter: (params) => {
        const index = hoveredIndex(params);
        const night = index === null ? undefined : nights[index];
        return night
          ? tooltipHtml(sleepNightTooltip(night, today, resolution, tokens), tokens)
          : "";
      },
    },
    series: SLEEP_STAGES.map((stage) => ({
      type: "bar",
      name: stage.label,
      stack: "night",
      data: nights.map((night) => night[stage.value]),
      color: colors[stage.color],
      itemStyle: { color: colors[stage.color] },
      emphasis: { disabled: true },
      barCategoryGap: "20%",
    })),
  };
}
