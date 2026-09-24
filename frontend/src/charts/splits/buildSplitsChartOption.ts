// Kilometre splits as bars, one per km, taller when faster. The y-axis reads in the unit
// each sport thinks in (pace on foot and in water, km/h on wheels), and says it once.
import type { Split } from "@/api/adapters";
import {
  decimalStep,
  padded,
  quantileRange,
  SECONDS_STEPS,
  snapToStep,
  stepFrom,
  withMinSpan,
} from "@/charts/axisScale";
import {
  axisLabelStyle,
  BAR_TOP_RADIUS,
  barHoverPointer,
  gridLineStyle,
  quietAxis,
  tooltipStyle,
} from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { STREAM_CHART_GRID } from "@/charts/streamChart/buildStreamChartOption";
import { kindColor } from "@/design/scales";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import type { ActivityKind } from "@/lib/activityKind";
import {
  formatDecimal,
  formatHeartRate,
  formatInteger,
  formatPace,
  formatPaceClock,
  formatSpeed,
  formatSportSpeed,
  formatSwimPace,
} from "@/lib/format";

export interface SplitsChartInput {
  splits: readonly Split[];
  kind: ActivityKind;
  tokens: ColorTokens;
}

/** How a split's speed is read for one sport. */
export interface SplitMeasure {
  /** The split in the axis unit (s/km, s/100m or km/h). Splits are 1 km each. */
  value: (split: Split) => number;
  /** Pace: a smaller value is faster. Speed: a larger one is. */
  lowerIsFaster: boolean;
  /** The smallest y span, so even splits don't turn noise into cliffs. */
  minSpan: number;
  tickStep: (span: number) => number;
  /** A tick without its unit, and the top tick, which carries it. */
  tick: (value: number) => string;
  tickWithUnit: (value: number) => string;
}

const MAX_Y_INTERVALS = 3;
// Room below the slowest split, so it still has a visible bar.
const Y_PADDING = 0.15;
const BAR_GAP = "30%";

const pacePerKm: SplitMeasure = {
  value: (split) => split.seconds,
  lowerIsFaster: true,
  minSpan: 30,
  tickStep: (span) => stepFrom(SECONDS_STEPS, span, MAX_Y_INTERVALS),
  tick: formatPaceClock,
  tickWithUnit: formatPace,
};

const pacePer100m: SplitMeasure = {
  value: (split) => split.seconds / 10,
  lowerIsFaster: true,
  minSpan: 5,
  tickStep: (span) => stepFrom(SECONDS_STEPS, span, MAX_Y_INTERVALS),
  tick: formatPaceClock,
  tickWithUnit: (secondsPer100m) => formatSwimPace(100 / secondsPer100m),
};

const speedKmh: SplitMeasure = {
  value: (split) => 3600 / split.seconds,
  lowerIsFaster: false,
  // At least 5 km/h keeps the step a whole number, so whole-number ticks never repeat.
  minSpan: 5,
  tickStep: (span) => decimalStep(span, MAX_Y_INTERVALS),
  tick: (kmh) => formatDecimal(kmh, 0),
  tickWithUnit: (kmh) => formatSpeed(kmh / 3.6, 0),
};

/** The same units as `formatSportSpeed`: pace on foot, /100m in water, km/h otherwise. */
export function splitMeasure(kind: ActivityKind): SplitMeasure {
  switch (kind) {
    case "run":
    case "walk":
      return pacePerKm;
    case "swim":
      return pacePer100m;
    case "ride":
    case "strength":
    case "other":
      return speedKmh;
  }
}

/**
 * Bars measure how much faster than the axis's slow end each split was, in the axis
 * unit, so every sport's bars grow upwards from one baseline. `labelAt` turns a bar
 * height back into the unit's value for tick labels.
 */
export interface SplitScale {
  heights: number[];
  max: number;
  step: number;
  labelAt: (height: number) => number;
}

export function splitScale(measure: SplitMeasure, splits: readonly Split[]): SplitScale | null {
  const values = splits.map(measure.value);
  const range = quantileRange(values, 0, 1);
  if (range === null) return null;

  const spread = padded(withMinSpan(range, measure.minSpan), Y_PADDING);
  const step = measure.tickStep(spread[1] - spread[0]);
  const [lo, hi] = snapToStep(spread, step);
  const slowEnd = measure.lowerIsFaster ? hi : lo;
  const sign = measure.lowerIsFaster ? -1 : 1;

  return {
    heights: values.map((value) => sign * (value - slowEnd)),
    max: hi - lo,
    step,
    labelAt: (height) => slowEnd + sign * height,
  };
}

/** "Km 3 · 5:12 /km · 151 bpm"; HR is left out when the split has none. */
export function splitTooltip(split: Split, kind: ActivityKind): string {
  const parts = [`Km ${formatInteger(split.km)}`, formatSportSpeed(1000 / split.seconds, kind)];
  if (split.avgHr !== null) parts.push(formatHeartRate(split.avgHr));
  return parts.join(" · ");
}

export function buildSplitsChartOption({ splits, kind, tokens }: SplitsChartInput): ChartOption {
  const measure = splitMeasure(kind);
  const scale = splitScale(measure, splits);
  const color = kindColor(tokens, kind);

  return {
    animation: false,
    textStyle: { fontFamily },
    // The same left edge as the stream charts, so the plots line up down the page.
    grid: { ...STREAM_CHART_GRID },
    xAxis: {
      type: "category",
      data: splits.map((split) => formatInteger(split.km)),
      ...quietAxis,
      axisLabel: axisLabelStyle(tokens),
    },
    yAxis: {
      type: "value",
      min: 0,
      max: scale?.max,
      interval: scale?.step,
      ...quietAxis,
      splitLine: gridLineStyle(tokens),
      axisLabel: {
        ...axisLabelStyle(tokens),
        formatter: (height: number) => {
          if (scale === null) return "";
          const value = scale.labelAt(height);
          const isTop = Math.abs(height - scale.max) < scale.step / 2;
          return isTop ? measure.tickWithUnit(value) : measure.tick(value);
        },
      },
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: barHoverPointer(tokens),
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const split = first ? splits[first.dataIndex] : undefined;
        return split ? splitTooltip(split, kind) : "";
      },
    },
    series: [
      {
        type: "bar",
        data: scale?.heights ?? [],
        color,
        itemStyle: { color, borderRadius: BAR_TOP_RADIUS },
        // The hover wash marks the bar; the bar itself keeps its colour.
        emphasis: { disabled: true },
        barCategoryGap: BAR_GAP,
      },
    ],
  };
}
