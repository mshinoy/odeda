// The two sentences under the race-day card, built as strings so they are testable.
//
// The second one exists because a number without it is a different claim. The seconds
// come from applying ~2 s per mile per pound to the projected change: a rough empirical
// average across runners, assuming the weight lost is fat rather than muscle, knowing
// nothing about this athlete. Saying so is the difference between a rule of thumb and a
// prediction, and this section is not allowed to make the second kind.
import type { RaceWeightProjection } from "@/api/queries/useBody";
import { formatDays, formatDuration, formatSigned } from "@/lib/format";

/** [what the projection is, what the pace figure is not]. */
export function projectionSentences(projection: RaceWeightProjection): [string, string] {
  const basis =
    `${projection.race_name} is ${formatDays(projection.days_out)} away; the projection ` +
    `carries the last ${formatDays(projection.window_days)} of trend ` +
    `(${projection.readings_used} weigh-ins, ${formatSigned(projection.slope_kg_per_week, 2)} kg ` +
    `a week) forward to ${projection.race_day}.`;

  const seconds = Math.abs(projection.rule_of_thumb_race_s);
  const faster = projection.rule_of_thumb_race_s < 0;
  const ruleOfThumb =
    seconds < 1
      ? "No weight change means no pace estimate to qualify."
      : `As a rule of thumb only — not a prediction — a change of that size is worth about ` +
        `${formatDuration(seconds)} ${faster ? "faster" : "slower"} over the half, at roughly ` +
        `2 seconds a mile per pound. That figure is an average across runners and assumes ` +
        `the change is fat rather than muscle.`;

  return [basis, ruleOfThumb];
}
