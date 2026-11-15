import { useEffect, useRef, type PointerEvent, type ReactNode } from "react";
import { EChart } from "@/charts/EChart";
import { GRID_BOTTOM, GRID_TOP } from "@/charts/chrome";
import type { ChartOption } from "@/charts/echarts";
import { HEALTH_GUTTERS } from "@/charts/health/dayAxis";
import type { Stat } from "@/charts/health/rangeStats";
import type { Resolution } from "@/charts/health/resolution";
import { indicesFromWindow, windowFromIndices, type DayWindow } from "@/charts/health/zoomWindow";
import { InfoPopover } from "@/components/InfoPopover";
import { Button } from "@/components/ui/button";
import type { ChartZoom } from "@/features/health/useChartZoom";
import { formatDate } from "@/lib/format";

interface HealthChartProps {
  /** What the chart is, in a few words. */
  title: string;
  /** One sentence on what it shows and how to read it. */
  description: string;
  option: ChartOption;
  /** The day of each point drawn, so a drag can be turned into a window of days. */
  days: readonly string[];
  resolution: Resolution;
  zoom: ChartZoom;
  /** The numbers for the zoomed window, or for the selection when there is one. */
  stats: readonly Stat[];
  height?: number;
  /** Anything that has to sit beside the title, such as a stacked chart's legend. */
  legend?: ReactNode;
}

export const HEALTH_CHART_HEIGHT = 260;

/** The summary line is a glance, not a table: the first few numbers say what the chart does. */
const STATS_SHOWN = 4;

/** A press that moves less than this is a click, not the start of a selection. */
const DRAG_THRESHOLD_PX = 4;

const PLOT_INSET = HEALTH_GUTTERS.left + HEALTH_GUTTERS.right;

function scopeText(zoom: ChartZoom): string {
  const label = (window: DayWindow) => `${formatDate(window.from)} – ${formatDate(window.to)}`;
  if (zoom.selection !== null) return `Selected ${label(zoom.selection)}`;
  if (zoom.zoom !== null) return `Zoomed to ${label(zoom.zoom)}`;
  return "Whole range";
}

/**
 * One Health chart: a title and what it shows, the numbers for what is in view, and the
 * plot. Drag across the plot to select a stretch, "Zoom in" to redraw it at full
 * height, and double-click anywhere on it to go back out.
 */
export function HealthChart({
  title,
  description,
  option,
  days,
  resolution,
  zoom,
  stats,
  height = HEALTH_CHART_HEIGHT,
  legend,
}: HealthChartProps) {
  const plotRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ days, resolution, select: zoom.select });
  const stopDrag = useRef<(() => void) | null>(null);

  useEffect(() => {
    latest.current = { days, resolution, select: zoom.select };
  }, [days, resolution, zoom.select]);

  useEffect(() => () => stopDrag.current?.(), []);

  const indexAt = (clientX: number): number => {
    const rect = plotRef.current?.getBoundingClientRect();
    const count = latest.current.days.length;
    if (rect === undefined || count === 0) return 0;
    const fraction = (clientX - rect.left - HEALTH_GUTTERS.left) / (rect.width - PLOT_INSET);
    return Math.min(Math.max(Math.floor(fraction * count), 0), count - 1);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (rect === undefined || event.button !== 0 || days.length < 2) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const inPlot =
      x >= HEALTH_GUTTERS.left &&
      x <= rect.width - HEALTH_GUTTERS.right &&
      y >= GRID_TOP &&
      y <= rect.height - GRID_BOTTOM;
    if (!inPlot) return;

    const anchor = indexAt(event.clientX);
    const startX = event.clientX;
    let dragging = false;

    const move = (moved: globalThis.PointerEvent) => {
      if (!dragging && Math.abs(moved.clientX - startX) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      const { days: shown, resolution: at, select } = latest.current;
      select(windowFromIndices(shown, anchor, indexAt(moved.clientX), at));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stopDrag.current = null;
    };
    const end = () => {
      stop();
      // A click that selected nothing clears the old selection.
      if (!dragging) latest.current.select(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    stopDrag.current = stop;
  };

  const selected =
    zoom.selection === null ? null : indicesFromWindow(days, zoom.selection, resolution);
  const canZoom = zoom.selection !== null && zoom.selection.to > zoom.selection.from;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1">
            <span className="text-base leading-tight font-medium tracking-tight">{title}</span>
            <InfoPopover title={title}>
              <p>{description}</p>
              <p>Drag across the chart to select a range; double-click to reset.</p>
            </InfoPopover>
          </span>
          {legend}
          <span className="ml-auto flex items-center gap-2">
            {zoom.selection !== null && (
              <>
                <Button size="sm" disabled={!canZoom} onClick={zoom.zoomToSelection}>
                  Zoom in
                </Button>
                <Button size="sm" variant="outline" onClick={() => zoom.select(null)}>
                  Clear
                </Button>
              </>
            )}
            {zoom.zoom !== null && (
              <Button size="sm" variant="outline" onClick={zoom.reset}>
                Reset zoom
              </Button>
            )}
          </span>
        </span>
      </figcaption>

      <div className="flex flex-col gap-1">
        {/* "Whole range" is the default and says nothing; only a zoom or a selection is news. */}
        {(zoom.zoom !== null || zoom.selection !== null) && (
          <span className="text-muted-foreground text-xs">{scopeText(zoom)}</span>
        )}
        <dl className="flex flex-wrap gap-x-5 gap-y-1">
          {stats.slice(0, STATS_SHOWN).map((stat) => (
            <div key={stat.label} className="flex items-baseline gap-1.5">
              <dt className="text-muted-foreground text-xs">{stat.label}</dt>
              <dd className="text-sm font-medium tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div
        ref={plotRef}
        data-testid="health-chart-plot"
        className="relative cursor-crosshair touch-pan-y select-none"
        onPointerDown={onPointerDown}
        onDoubleClick={zoom.reset}
      >
        <EChart option={option} height={height} />
        {selected !== null && (
          <div
            data-testid="health-chart-selection"
            className="bg-foreground/10 border-foreground/30 pointer-events-none absolute border-x"
            style={{
              top: GRID_TOP,
              bottom: GRID_BOTTOM,
              left: `calc(${HEALTH_GUTTERS.left}px + (100% - ${PLOT_INSET}px) * ${selected[0] / days.length})`,
              width: `calc((100% - ${PLOT_INSET}px) * ${(selected[1] - selected[0] + 1) / days.length})`,
            }}
          />
        )}
      </div>
    </figure>
  );
}
