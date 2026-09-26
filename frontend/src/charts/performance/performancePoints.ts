// `/api/performance` rows reduced to what `buildSessionTrendOption` plots: a day, one
// number, and the line of detail its tooltip shows. Pure, so the panels hold no logic.
import type { components } from "@/api/schema";
import type { SessionPoint } from "@/charts/performance/buildSessionTrendOption";
import { formatDistance, formatDuration } from "@/lib/format";

type DecouplingPoint = components["schemas"]["DecouplingPoint"];
type EfficiencyPoint = components["schemas"]["EfficiencyPoint"];

/** "Doha - Long Easy Run · 15.2 km · 2:17:33", dropping whatever Garmin did not send. */
export function sessionDetail(point: DecouplingPoint): string {
  return [
    point.name,
    formatDistance(point.distance_km * 1000),
    point.duration_s === null ? null : formatDuration(point.duration_s),
  ]
    .filter((part): part is string => part !== null && part !== "")
    .join(" · ");
}

/** The runs whose HR was usable enough to measure drift. */
export function decouplingPoints(runs: readonly DecouplingPoint[]): SessionPoint[] {
  return runs
    .filter(
      (run): run is DecouplingPoint & { decoupling_pct: number } => run.decoupling_pct !== null,
    )
    .map((run) => ({ day: run.day, value: run.decoupling_pct, detail: sessionDetail(run) }));
}

/**
 * Efficiency comes back as its own thinner series, so the detail line is looked up in
 * `decoupling` by day. A day with two long runs takes the first; the alternative is a
 * tooltip that names no run at all.
 */
export function efficiencyPoints(
  trend: readonly EfficiencyPoint[],
  runs: readonly DecouplingPoint[],
): SessionPoint[] {
  const byDay = new Map(runs.map((run) => [run.day, run]));
  return trend.map((point) => {
    const run = byDay.get(point.day);
    return {
      day: point.day,
      value: point.ef,
      detail: run === undefined ? "" : sessionDetail(run),
    };
  });
}
