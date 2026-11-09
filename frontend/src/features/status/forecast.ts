import type { components } from "@/api/schema";
import { formatDecimal, formatDuration, formatPace, formatSigned } from "@/lib/format";

type TimeRange = components["schemas"]["TimeRange"];
type FormForecast = components["schemas"]["FormForecast"];

export interface FinishRange {
  /** "1:48:20 – 1:54:05". */
  range: string;
  /** "most likely 1:51:10 · 5:16 /km". */
  detail: string;
}

/** The fast and slow ends of the adjusted estimate, and the likeliest finish between. */
export function finishRange(time: TimeRange): FinishRange {
  const { fast, central, slow } = time.adjusted;
  return {
    range: `${formatDuration(fast)} – ${formatDuration(slow)}`,
    detail: `most likely ${formatDuration(central)} · ${formatPace(time.central_pace_s_per_km)}`,
  };
}

/**
 * How the adjusted range differs from the plain one, in words a runner would use. Null
 * when neither rule moved it, so the panel does not announce an adjustment of nothing.
 */
export function adjustmentNote(time: TimeRange): string | null {
  const parts: string[] = [];
  if (Math.abs(time.fitness_pct) >= 0.05) {
    parts.push(`fitness ${formatSigned(time.fitness_pct, 1)}%`);
  }
  if (Math.abs(time.form_pct) >= 0.05) {
    parts.push(`race-morning form ${formatSigned(time.form_pct, 1)}%`);
  }
  return parts.length === 0 ? null : `Adjusted for ${parts.join(" and ")} on the time.`;
}

/** The race-morning form as a signed number. Follows the verdict's basis. */
export function morningForm(form: FormForecast): number {
  const m = form.race_morning;
  return form.basis === "followed" && m.tsb_followed !== null ? m.tsb_followed : m.tsb;
}

/**
 * The verdict, cut to fit under a number. When fitness is set to fall that is the news,
 * and it is said with the two figures; otherwise the sentence after the colon is enough.
 * The full sentence stays in the working.
 */
export function verdictShort(form: FormForecast): string {
  const first = form.curve[0];
  const m = form.race_morning;
  if (form.verdict.level === "warning" && form.verdict.text.includes("fitness falls") && first) {
    const now = form.basis === "followed" ? first.ctl_followed : first.ctl;
    const race = form.basis === "followed" ? m.ctl_followed : m.ctl;
    if (now !== null && race !== null) {
      return `Fitness falls ${formatDecimal(now, 0)} → ${formatDecimal(race, 0)}`;
    }
  }
  const [, after] = form.verdict.text.split(/on race morning:\s*/);
  return after ?? form.verdict.text;
}
