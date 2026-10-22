// Chart chrome every chart shares: quiet axes, hairline gridlines, one tooltip style.
import type { ColorTokens } from "@/design/tokens";
import { fontFamily, fontSize } from "@/design/typography";

export function axisLabelStyle(tokens: ColorTokens) {
  return { color: tokens.inkMuted, fontSize: fontSize.caption, fontFamily };
}

export function gridLineStyle(tokens: ColorTokens) {
  return { show: true, lineStyle: { color: tokens.gridline, width: 1 } };
}

/**
 * A chart's plot area. Only the side gutters vary between charts, because only they
 * depend on how wide that chart's y-axis labels run; the space above the top gridline
 * and below the x-axis labels is chrome, and is the same everywhere.
 */
export function chartGrid(gutters: { left: number; right: number }) {
  return { ...gutters, top: GRID_TOP, bottom: GRID_BOTTOM } as const;
}

/** Pixels above the top gridline and below the plot (the x-axis labels live there). */
export const GRID_TOP = 12;
export const GRID_BOTTOM = 28;

/** Axis line, ticks and vertical gridlines all off: the data and the labels carry it. */
export const quietAxis = {
  axisLine: { show: false },
  axisTick: { show: false },
} as const;

export function tooltipStyle(tokens: ColorTokens) {
  return {
    showDelay: 0,
    transitionDuration: 0,
    confine: true,
    backgroundColor: tokens.surface,
    borderColor: tokens.border,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: tokens.ink, fontSize: fontSize.body, fontFamily },
    extraCssText: "font-variant-numeric: tabular-nums; box-shadow: none; border-radius: 6px;",
  };
}

export interface TooltipRow {
  label: string;
  value: string;
  /** A swatch of the series the row reads, so a line is told apart without its name. */
  color?: string;
}

/** What a Health chart shows under the pointer: the day, then one row per fact. */
export interface TooltipCard {
  heading: string;
  rows: readonly TooltipRow[];
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** The card as the HTML ECharts' tooltip takes: bold heading, muted labels, values right-aligned. */
export function tooltipHtml(card: TooltipCard, tokens: ColorTokens): string {
  const rows = card.rows
    .map((row) => {
      const swatch =
        row.color === undefined
          ? ""
          : `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${row.color};margin-right:6px"></span>`;
      return (
        `<div style="display:flex;justify-content:space-between;gap:20px;line-height:1.6">` +
        `<span style="color:${tokens.inkMuted}">${swatch}${escapeHtml(row.label)}</span>` +
        `<span style="font-weight:600">${escapeHtml(row.value)}</span></div>`
      );
    })
    .join("");
  return `<div style="font-weight:600;margin-bottom:2px">${escapeHtml(card.heading)}</div>${rows}`;
}

/** The data index under an axis-triggered tooltip's pointer, or null. */
export function hoveredIndex(params: unknown): number | null {
  const first = Array.isArray(params) ? params[0] : params;
  const index = (first as { dataIndex?: unknown } | undefined)?.dataIndex;
  return typeof index === "number" ? index : null;
}

/** Bars get rounded tops only, so they still sit flat on the baseline. */
export const BAR_TOP_RADIUS: [number, number, number, number] = [3, 3, 0, 0];

/** The corner radius at the two ends of a single horizontal bar. */
export const BAR_END_RADIUS = 3;

/** Hovering a bar chart washes the whole category behind the bar. */
export function barHoverPointer(tokens: ColorTokens) {
  return {
    type: "shadow",
    shadowStyle: { color: tokens.surfaceMuted, opacity: 0.6 },
  } as const;
}
