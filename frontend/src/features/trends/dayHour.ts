// The weekday × hour grid, as cells the component can render without thinking.
//
// It is a grid of divs rather than an ECharts heatmap: 168 cells need no canvas, and
// registering the heatmap series and its visual map would put both in the bundle for
// one block. The body diagram (T16) is hand-drawn for the same reason.
import type { components } from "@/api/schema";
import { formatInteger } from "@/lib/format";

type Patterns = components["schemas"]["Patterns"];

export const HOURS_PER_DAY = 24;

export interface DayHourCell {
  day: number;
  /** 0-23, by the activity's local start time. */
  hour: number;
  count: number;
  /** Where this cell sits on the magnitude ramp, 0..1; 0 when nothing happened. */
  intensity: number;
  /** "Mon 20:00 · 25 activities", for the cell's title. */
  title: string;
}

/** "20:00". */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Every cell of the 7 × 24 grid, row by row, Monday first.
 *
 * Intensity is scaled against the busiest cell, not against the total: the question is
 * which slots are the regular ones, and the busiest slot is the only useful "full".
 */
export function dayHourCells(patterns: Patterns): DayHourCell[] {
  const names = patterns.day_of_week.map((day) => day.name);
  const peak = patterns.dow_hour_matrix.reduce(
    (high, row) => row.reduce((rowHigh, count) => Math.max(rowHigh, count), high),
    0,
  );

  return patterns.dow_hour_matrix.flatMap((row, day) =>
    Array.from({ length: HOURS_PER_DAY }, (_, hour) => {
      const count = row[hour] ?? 0;
      const activities = count === 1 ? "activity" : "activities";
      return {
        day,
        hour,
        count,
        intensity: peak === 0 ? 0 : count / peak,
        title:
          `${names[day] ?? ""} ${formatHour(hour)} · ` + `${formatInteger(count)} ${activities}`,
      };
    }),
  );
}

/** Whether any activity has a start time to place on the grid. */
export function hasDayHourData(patterns: Patterns): boolean {
  return patterns.dow_hour_matrix.some((row) => row.some((count) => count > 0));
}
