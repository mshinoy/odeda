// One histogram builder for all three distributions. What changes between them is the
// unit on the axis and in the tooltip, and that arrives as a `HistogramSpec` — so pace,
// distance and heart rate cannot drift apart in how they draw.
import {
  axisLabelStyle,
  BAR_TOP_RADIUS,
  barHoverPointer,
  chartGrid,
  gridLineStyle,
  quietAxis,
  tooltipStyle,
} from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import type { components } from "@/api/schema";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import type { HistogramSpec } from "@/features/trends/distributions";
import { formatInteger } from "@/lib/format";

type HistogramBucket = components["schemas"]["HistogramBucket"];

export interface HistogramInput {
  buckets: readonly HistogramBucket[];
  spec: HistogramSpec;
  tokens: ColorTokens;
}

/** Enough ticks to read the shape, few enough that they do not collide. */
const X_LABELS = 6;

/** "5:00–5:15 /km · 12 activities". */
export function histogramTooltip(bucket: HistogramBucket, spec: HistogramSpec): string {
  const activities = bucket.count === 1 ? "activity" : "activities";
  return `${spec.formatRange(bucket.lo, bucket.hi)} · ${formatInteger(bucket.count)} ${activities}`;
}

export function buildHistogramOption({ buckets, spec, tokens }: HistogramInput): ChartOption {
  return {
    animation: false,
    textStyle: { fontFamily },
    grid: chartGrid({ left: 40, right: 16 }),
    xAxis: {
      type: "category",
      // The bucket's low edge is the category; its width is in the tooltip.
      data: buckets.map((bucket) => bucket.lo),
      ...quietAxis,
      splitLine: { show: false },
      axisLabel: {
        ...axisLabelStyle(tokens),
        interval: Math.max(Math.floor(buckets.length / X_LABELS) - 1, 0),
        formatter: (value: string) => spec.formatTick(Number(value)),
      },
    },
    yAxis: {
      type: "value",
      ...quietAxis,
      splitNumber: 3,
      // Counts are whole activities; a tick at 2.5 of them means nothing.
      minInterval: 1,
      splitLine: gridLineStyle(tokens),
      axisLabel: axisLabelStyle(tokens),
    },
    tooltip: {
      trigger: "axis",
      ...tooltipStyle(tokens),
      axisPointer: barHoverPointer(tokens),
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const bucket = first ? buckets[first.dataIndex] : undefined;
        return bucket ? histogramTooltip(bucket, spec) : "";
      },
    },
    series: [
      {
        type: "bar",
        name: spec.label,
        data: buckets.map((bucket) => bucket.count),
        color: tokens.inkSecondary,
        itemStyle: { color: tokens.inkSecondary, borderRadius: BAR_TOP_RADIUS },
        emphasis: { itemStyle: { color: tokens.ink } },
        // Histogram bars touch: the buckets are contiguous, and a gap between them
        // would read as a range with nothing in it.
        barCategoryGap: "8%",
      },
    ],
  };
}
