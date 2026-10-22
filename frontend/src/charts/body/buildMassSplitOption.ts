// Fat mass against lean mass — plotted as *change* over the window, not as levels.
//
// The reason this chart exists: on a scale, a kilogram of fat and a kilogram of muscle
// are the same kilogram. Here they are opposite news — a block where fat falls and lean
// holds is working, and a block where both fall is not.
//
// Drawn as levels it says nothing. Lean sits near 63 kg and fat near 11, so one axis
// covering both spans 60 kg, and the 3 kg that actually moved over a year is a pixel:
// two flat parallel lines, which is precisely the failure this chart was added to
// avoid. Two y-axes would fix it and are not allowed (Rules), and they would also
// invite the reader to compare two different scales by eye.
//
// So the levels live on the cards above, where a single number belongs, and the chart
// shows what each mass did. Both series start at zero by construction, so the only
// thing to read is the divergence — which is the question.
//
// `tokens.series`, not `tokens.kind`: two things of the same sort, which is what that
// palette is for, and it carries a legend for the same reason the compare chart does.
import { decimalStep, padded, quantileRange, snapToStep, withMinSpan } from "@/charts/axisScale";
import {
  axisLabelStyle,
  gridLineStyle,
  hoveredIndex,
  quietAxis,
  tooltipHtml,
  tooltipStyle,
  type TooltipCard,
} from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { dayAxis, HEALTH_CHART_GRID } from "@/charts/health/dayAxis";
import type { BodySeries } from "@/api/queries/useBody";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDate, formatDecimal, formatSigned } from "@/lib/format";

export interface MassSplitInput {
  series: BodySeries;
  tokens: ColorTokens;
  today?: Date;
}

const MAX_Y_INTERVALS = 4;
const Y_PADDING = 0.1;

/** The smallest y span, in kg. Under this a steady block fills the chart with nothing. */
export const MIN_MASS_SPAN_KG = 2;

export const MASS_SERIES = [
  { key: "lean_kg", label: "Lean", index: 0 },
  { key: "fat_kg", label: "Fat", index: 1 },
] as const;

/** The colour each mass line takes, read by the chart and by its legend. */
export function massColors(tokens: ColorTokens): Record<string, string> {
  return Object.fromEntries(
    MASS_SERIES.map(({ label, index }) => [label, tokens.series[index] ?? tokens.ink]),
  );
}

/** Whether there is any body-fat reading at all. Without one there is no split to draw. */
export function hasSplit(series: BodySeries): boolean {
  return series.fat_kg.some((value) => value !== null);
}

/**
 * A mass series as kilograms gained or lost since its first reading in the window.
 *
 * Nulls stay null: they are days before the first weigh-in, and turning them into a
 * zero would draw a flat line across a period with no scale in the house.
 */
export function changeFromStart(values: readonly (number | null)[]): (number | null)[] {
  const first = values.find((value): value is number => value !== null);
  if (first === undefined) return values.map(() => null);
  return values.map((value) => (value === null ? null : value - first));
}

/** One axis covering both changes, with zero inside it whatever the data did. */
export function massScale(series: BodySeries): { min: number; max: number; step: number } | null {
  const changes = [...changeFromStart(series.fat_kg), ...changeFromStart(series.lean_kg)];
  const range = quantileRange(changes, 0, 1);
  if (range === null) return null;
  // Zero is the baseline every reading is measured against; an axis that excluded it
  // would put the origin of both series off the chart.
  const withZero: [number, number] = [Math.min(range[0], 0), Math.max(range[1], 0)];
  const spread = padded(withMinSpan(withZero, MIN_MASS_SPAN_KG), Y_PADDING);
  const step = decimalStep(spread[1] - spread[0], MAX_Y_INTERVALS);
  const [min, max] = snapToStep(spread, step);
  return { min, max, step };
}

/** "Sep 23": each mass as the movement the line draws, then the level it stands at. */
export function massTooltip(
  series: BodySeries,
  index: number,
  today?: Date,
  tokens?: ColorTokens,
): TooltipCard | null {
  const day = series.days[index];
  if (day === undefined) return null;
  const colors = tokens === undefined ? undefined : massColors(tokens);
  const row = (key: (typeof MASS_SERIES)[number]["key"], label: string) => {
    const change = changeFromStart(series[key])[index] ?? null;
    const level = series[key][index] ?? null;
    return {
      label,
      value: `${formatSigned(change, 1)} kg · ${formatDecimal(level, 1)} kg`,
      color: colors?.[label],
    };
  };
  return {
    heading: formatDate(day, today),
    rows: MASS_SERIES.map(({ key, label }) => row(key, label)),
  };
}

export function buildMassSplitOption({ series, tokens, today }: MassSplitInput): ChartOption {
  const scale = massScale(series);
  const colors = massColors(tokens);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: HEALTH_CHART_GRID,
    xAxis: dayAxis(series.days, tokens, today),
    yAxis: {
      type: "value",
      min: scale?.min,
      max: scale?.max,
      interval: scale?.step,
      ...quietAxis,
      splitLine: gridLineStyle(tokens),
      axisLabel: {
        ...axisLabelStyle(tokens),
        // Signed throughout, because every value here is a change and an unsigned
        // "1" above a "−1" would read as a level.
        formatter: (value: number) =>
          scale !== null && value === scale.max
            ? `${formatSigned(value, 1)} kg`
            : formatSigned(value, 1),
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: { type: "line", lineStyle: { color: tokens.cursor, width: 1 } },
      formatter: (params) => {
        const index = hoveredIndex(params);
        const card = index === null ? null : massTooltip(series, index, today, tokens);
        return card ? tooltipHtml(card, tokens) : "";
      },
    },
    series: MASS_SERIES.map(({ key, label }) => ({
      type: "line" as const,
      name: label,
      data: changeFromStart(series[key]),
      color: colors[label],
      lineStyle: { color: colors[label], width: 2 },
      emphasis: { disabled: true },
      showSymbol: false,
      connectNulls: false,
    })),
  };
}
