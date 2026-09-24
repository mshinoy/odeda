// Time in HR zones as one horizontal bar split into zones, zone 1 on the left, each
// segment in its zone's step of the HR ramp and labelled underneath.
import type { HrZoneTime } from "@/api/adapters";
import { axisLabelStyle, BAR_END_RADIUS, tooltipStyle } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { hrZoneColor } from "@/design/scales";
import type { ColorTokens } from "@/design/tokens";
import { fontFamily } from "@/design/typography";
import { formatDuration, formatInteger, formatPercent } from "@/lib/format";

export interface HrZonesInput {
  zones: readonly HrZoneTime[];
  tokens: ColorTokens;
}

export interface ZoneShare {
  zone: number;
  seconds: number;
  /** Of the time in any zone, 0..1. */
  share: number;
}

/** The bar's thickness and the chart's height, room for one line of labels below. */
export const HR_ZONES_BAR_PX = 16;
export const HR_ZONES_CHART_HEIGHT = 48;
const LABEL_GAP_PX = 6;
// A segment narrower than this share of the bar is too thin for a label; its tooltip still works.
const MIN_LABEL_SHARE = 0.04;
// Below this share the segment only says which zone it is.
const MIN_TIME_LABEL_SHARE = 0.12;

/** The zones with time in them, in zone order, with their share of the total. */
export function zoneShares(zones: readonly HrZoneTime[]): ZoneShare[] {
  const withTime = zones.filter((z) => z.seconds > 0).sort((a, b) => a.zone - b.zone);
  const total = withTime.reduce((sum, z) => sum + z.seconds, 0);
  return withTime.map((z) => ({ zone: z.zone, seconds: z.seconds, share: z.seconds / total }));
}

/** "Z2". */
export function zoneName(zone: number): string {
  return `Z${formatInteger(zone)}`;
}

/** The label under a segment: "Z2 48:05", "Z3", or nothing when the segment is too thin. */
export function zoneLabel({ zone, seconds, share }: ZoneShare): string {
  if (share < MIN_LABEL_SHARE) return "";
  if (share < MIN_TIME_LABEL_SHARE) return zoneName(zone);
  return `${zoneName(zone)} ${formatDuration(seconds)}`;
}

/** "Z2 · 48:05 · 61%". */
export function zoneTooltip({ zone, seconds, share }: ZoneShare): string {
  return `${zoneName(zone)} · ${formatDuration(seconds)} · ${formatPercent(share * 100)}`;
}

/** Rounded outer ends only, so the segments read as one bar. */
function segmentRadius(index: number, count: number): number[] {
  const left = index === 0 ? BAR_END_RADIUS : 0;
  const right = index === count - 1 ? BAR_END_RADIUS : 0;
  return [left, right, right, left];
}

export function buildHrZonesOption({ zones, tokens }: HrZonesInput): ChartOption {
  const shares = zoneShares(zones);
  const total = shares.reduce((sum, z) => sum + z.seconds, 0);

  return {
    animation: false,
    textStyle: { fontFamily },
    grid: { left: 0, right: 0, top: 0, bottom: HR_ZONES_CHART_HEIGHT - HR_ZONES_BAR_PX },
    xAxis: { type: "value", show: false, min: 0, max: total },
    yAxis: { type: "category", show: false, data: ["time"] },
    tooltip: {
      trigger: "item",
      ...tooltipStyle(tokens),
      formatter: (params) => {
        const first = Array.isArray(params) ? params[0] : params;
        const share = first ? shares[first.seriesIndex ?? -1] : undefined;
        return share ? zoneTooltip(share) : "";
      },
    },
    series: shares.map((share, i) => {
      const color = hrZoneColor(tokens, share.zone);
      return {
        type: "bar" as const,
        name: zoneName(share.zone),
        stack: "zones",
        data: [share.seconds],
        barWidth: HR_ZONES_BAR_PX,
        color,
        itemStyle: {
          color,
          borderRadius: segmentRadius(i, shares.length),
          // A hairline of page colour between neighbouring zones, which are close in hue.
          borderColor: tokens.page,
          borderWidth: 1,
        },
        emphasis: { disabled: true },
        label: {
          show: true,
          position: "bottom" as const,
          distance: LABEL_GAP_PX,
          ...axisLabelStyle(tokens),
          formatter: () => zoneLabel(share),
        },
      };
    }),
  };
}
