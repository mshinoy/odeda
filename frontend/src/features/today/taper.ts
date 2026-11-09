// The taper check, ready to draw. Pure, so the popup holds no logic.
import type { RaceForecast } from "@/api/queries/usePlan";
import { formatDate, formatDecimal } from "@/lib/format";

export type Taper = NonNullable<RaceForecast["taper"]>;

export interface TaperRow {
  label: string;
  km: string;
  /** Share of the peak week, for the bar. */
  pct: number;
  raceWeek: boolean;
}

/** One row a week: its Monday (or "Race week"), its kilometres, and how big against the peak. */
export function taperRows(taper: Taper): TaperRow[] {
  return taper.weeks.map((week) => ({
    label: week.race_week ? "Race week" : `Week of ${formatDate(week.start)}`,
    km: `${formatDecimal(week.planned_km)} km`,
    pct: Math.min(Math.max(week.pct_of_peak, 0), 100),
    raceWeek: week.race_week,
  }));
}
