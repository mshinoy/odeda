import { useCallback, useState } from "react";
import type { DayWindow } from "@/charts/health/zoomWindow";

/** One chart's zoom and selection. Each chart owns its own; the page range moves them all. */
export interface ChartZoom {
  /** The stretch the chart is zoomed to, or null for the whole range. */
  zoom: DayWindow | null;
  /** The stretch being selected, which the stats describe; null for none. */
  selection: DayWindow | null;
  select: (window: DayWindow | null) => void;
  /** Make the selection the zoom. */
  zoomToSelection: () => void;
  /** Back to the whole range with nothing selected. */
  reset: () => void;
}

interface State {
  key: string;
  zoom: DayWindow | null;
  selection: DayWindow | null;
}

const fresh = (key: string): State => ({ key, zoom: null, selection: null });

/** A reset key for a chart's raw days: it changes when the page range does. */
export function zoomKey(days: readonly string[]): string {
  return `${days[0] ?? ""}|${days[days.length - 1] ?? ""}|${days.length}`;
}

/**
 * `resetKey` identifies the data: when the page range changes it changes, and a zoom
 * into the old data would otherwise point at days the new data may not contain.
 */
export function useChartZoom(resetKey: string): ChartZoom {
  const [state, setState] = useState<State>(() => fresh(resetKey));
  const current = state.key === resetKey ? state : fresh(resetKey);

  const select = useCallback(
    (selection: DayWindow | null) =>
      setState((prev) => ({ ...(prev.key === resetKey ? prev : fresh(resetKey)), selection })),
    [resetKey],
  );
  const zoomToSelection = useCallback(
    () =>
      setState((prev) => {
        const base = prev.key === resetKey ? prev : fresh(resetKey);
        return base.selection === null ? base : { ...base, zoom: base.selection, selection: null };
      }),
    [resetKey],
  );
  const reset = useCallback(() => setState(fresh(resetKey)), [resetKey]);

  return { zoom: current.zoom, selection: current.selection, select, zoomToSelection, reset };
}
