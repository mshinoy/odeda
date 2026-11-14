// What Today says about a long run that was missed or cut short, in one testable place.
import type { RaceForecast } from "@/api/queries/usePlan";
import { formatDate, formatDecimal, formatShortSeconds, formatWeekday } from "@/lib/format";

export type LongRun = NonNullable<RaceForecast["long_run"]>;

export interface LongRunNote {
  /** "Friday's long run was short". */
  heading: string;
  /** What was missed, what it costs, and what is next. */
  detail: string;
  /** Red is a session that did not happen; a cut-short one is a warning. */
  tone: "critical" | "warning";
}

/**
 * Plain about the price: it is a rule of thumb, usually small, and a single run barely
 * moves a half marathon. The note says so by saying the number, and does not scold.
 */
export function longRunNote(run: LongRun): LongRunNote {
  const day = `${formatWeekday(run.day)} ${formatDate(run.day)}`;
  const missed = run.verdict === "missed";
  // A ride on the day pays off part of the run: still not a long run, so not green, but
  // not a day off either.
  const rode = run.ride_km != null && run.ride_credit_km != null;
  const heading = rode
    ? `The long run on ${day} was ${missed ? "swapped for a ride" : "short, with a ride"}`
    : missed
      ? `The long run on ${day} was missed`
      : `The long run on ${day} was short`;

  const planned = missed
    ? `${formatDecimal(run.planned_km)} km planned`
    : `${formatDecimal(run.done_km)} of ${formatDecimal(run.planned_km)} km`;
  const what = rode
    ? `${planned}; the ${formatDecimal(run.ride_km ?? 0)} km ride counts for about ${formatDecimal(run.ride_credit_km ?? 0)} km of running`
    : planned;
  const cost =
    run.cost_seconds === null
      ? ""
      : ` That costs about ${formatShortSeconds(run.cost_seconds)} on race day.`;
  const next =
    run.next_day === null || run.next_km === null
      ? ""
      : ` Next: ${formatWeekday(run.next_day)} ${formatDate(run.next_day)}, ${formatDecimal(run.next_km)} km.`;

  return {
    heading,
    detail: `${what}.${cost}${next}`,
    tone: missed && !rode ? "critical" : "warning",
  };
}
