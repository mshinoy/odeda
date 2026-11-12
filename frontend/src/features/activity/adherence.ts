// How a stretch of a run measured up to the workout step it belonged to: the planned time
// or distance, and the target range (pace, heart rate or cadence). The plan is Garmin's;
// the share of time in range is read from the sample stream, the averages from the laps.
import type { ActivityStreams, PlanStep } from "@/api/adapters";
import { formatDistance, formatPaceClock } from "@/lib/format";

/** The streams this needs; the speed and cadence ones only when a step targets them. */
export type StreamsLike = Pick<ActivityStreams, "elapsedS" | "hr"> &
  Partial<Pick<ActivityStreams, "smoothSpeedMps" | "speedMps" | "cadenceSpm">>;

export interface StepJudgement {
  /** What the target is on, for sentences: "pace", "heart rate", "cadence". */
  on: "pace" | "heart rate" | "cadence" | null;
  /** "5:21–5:53 /km", "150–200 spm", "130–145 bpm", "zone 2"; null for an open step. */
  target: string | null;
  /** Share of the stretch's time inside the target range, 0–100; null without a range. */
  inRangePct: number | null;
  /** "on target", "0:25 /km slow", "6 bpm high"; null without a range. */
  verdict: string | null;
  /** Average against the range: below, inside or above it. Null without a range. */
  side: "low" | "in" | "high" | null;
  /** "4:00", "800 m"; null when the step ran to the lap button. */
  planned: string | null;
  /** Did the stretch last the planned time or distance? Null when nothing was planned. */
  heldPlan: boolean | null;
}

/** A stretch of the run: its window on the stream and Garmin's averages for it. */
export interface Stretch {
  startS: number | null;
  durationS: number;
  distanceM: number | null;
  avgHr: number | null;
  avgCadenceSpm: number | null;
}

/** Planned time is held within 5 s or 2 %, distance within 20 m or 2 %. */
const TIME_SLACK_S = 5;
const DISTANCE_SLACK_M = 20;
const SLACK_SHARE = 0.02;

/** A step that repeats others: it has no time or target of its own. */
export function isRepeat(step: PlanStep): boolean {
  return (step.durationType ?? "").startsWith("REPEAT");
}

function range(step: PlanStep): { low: number; high: number } | null {
  const { targetLow: low, targetHigh: high } = step;
  if (low === null || high === null || high <= 0 || high < low) return null;
  return { low, high };
}

export function targetText(step: PlanStep): string | null {
  const type = step.targetType;
  if (!type || type === "OPEN") return null;
  const r = range(step);
  if (type === "SPEED" && r) {
    // The faster bound is the higher speed; a zero low bound means "no slower limit".
    const fast = formatPaceClock(1000 / r.high);
    return r.low > 0 ? `${fast}–${formatPaceClock(1000 / r.low)} /km` : `faster than ${fast} /km`;
  }
  if (type === "CADENCE" && r) return `${Math.round(r.low)}–${Math.round(r.high)} spm`;
  if (type === "HEART_RATE") {
    if (r) return `${Math.round(r.low)}–${Math.round(r.high)} bpm`;
    if (step.targetValue) return `zone ${Math.round(step.targetValue)}`;
  }
  return null;
}

export function plannedText(step: PlanStep): string | null {
  if (step.durationValue === null) return null;
  if (step.durationType === "TIME") return formatPaceClock(step.durationValue);
  if (step.durationType === "DISTANCE") return formatDistance(step.durationValue);
  return null;
}

function heldPlan(step: PlanStep, s: Stretch): boolean | null {
  const goal = step.durationValue;
  if (goal === null || goal <= 0) return null;
  if (step.durationType === "TIME") {
    return Math.abs(s.durationS - goal) <= Math.max(TIME_SLACK_S, goal * SLACK_SHARE);
  }
  if (step.durationType === "DISTANCE" && s.distanceM !== null) {
    return Math.abs(s.distanceM - goal) <= Math.max(DISTANCE_SLACK_M, goal * SLACK_SHARE);
  }
  return null;
}

/** The stream's value for a target type at sample i, in the target's units. */
function valueAt(type: string, streams: StreamsLike, i: number): number | null {
  if (type === "SPEED") return streams.smoothSpeedMps?.[i] ?? streams.speedMps?.[i] ?? null;
  if (type === "HEART_RATE") return streams.hr[i] ?? null;
  if (type === "CADENCE") {
    // The stream holds running cadence per leg (about 85); targets are steps per minute.
    const c = streams.cadenceSpm?.[i];
    return c === null || c === undefined ? null : c * 2;
  }
  return null;
}

/** Time-weighted share of the stretch inside [low, high]; null without stream values. */
function inRangeShare(
  type: string,
  r: { low: number; high: number },
  s: Stretch,
  streams: StreamsLike,
): number | null {
  if (s.startS === null) return null;
  const from = s.startS;
  const to = s.startS + s.durationS;
  const t = streams.elapsedS;
  let inside = 0;
  let total = 0;
  for (let i = 0; i < t.length - 1; i++) {
    const a = t[i] ?? 0;
    if (a < from) continue;
    if (a >= to) break;
    const dt = Math.min(t[i + 1] ?? a, to) - a;
    const v = valueAt(type, streams, i);
    if (v === null || dt <= 0) continue;
    total += dt;
    if (v >= r.low && v <= r.high) inside += dt;
  }
  return total > 0 ? Math.round((inside / total) * 100) : null;
}

/** The stretch's average, in the target's units. */
function average(type: string, s: Stretch): number | null {
  if (type === "SPEED") {
    return s.distanceM && s.durationS > 0 ? s.distanceM / s.durationS : null;
  }
  if (type === "HEART_RATE") return s.avgHr;
  if (type === "CADENCE") return s.avgCadenceSpm;
  return null;
}

function verdictFor(
  type: string,
  r: { low: number; high: number },
  avg: number,
): { side: "low" | "in" | "high"; verdict: string } {
  if (avg >= r.low && avg <= r.high) return { side: "in", verdict: "on target" };
  const side = avg < r.low ? "low" : "high";
  if (type === "SPEED") {
    // Said as pace: how many seconds per km off the nearer end of the range.
    const edge = side === "low" ? r.low : r.high;
    const off = Math.abs(1000 / avg - 1000 / edge);
    return { side, verdict: `${formatPaceClock(off)} /km ${side === "low" ? "slow" : "fast"}` };
  }
  const off = Math.round(side === "low" ? r.low - avg : avg - r.high);
  const unit = type === "CADENCE" ? "spm" : "bpm";
  return { side, verdict: `${off} ${unit} ${side === "low" ? "low" : "high"}` };
}

export function judge(
  step: PlanStep | undefined,
  s: Stretch,
  streams: StreamsLike,
): StepJudgement | null {
  if (!step || isRepeat(step)) return null;
  const type = step.targetType ?? "";
  const r = range(step);
  const avg = r ? average(type, s) : null;
  const scored = r && avg !== null ? verdictFor(type, r, avg) : null;
  const on =
    type === "SPEED"
      ? "pace"
      : type === "HEART_RATE"
        ? "heart rate"
        : type === "CADENCE"
          ? "cadence"
          : null;
  const target = targetText(step);
  return {
    on: target ? on : null,
    target,
    inRangePct: r ? inRangeShare(type, r, s, streams) : null,
    verdict: scored?.verdict ?? null,
    side: scored?.side ?? null,
    planned: plannedText(step),
    heldPlan: heldPlan(step, s),
  };
}

/**
 * How many times the plan meant a step to be run: once, times every repeat that loops
 * back over it. Garmin's REPEAT step goes back to `durationValue`, `targetValue` times.
 */
export function plannedCount(steps: readonly PlanStep[], stepIndex: number): number {
  let count = 1;
  for (const s of steps) {
    if (!isRepeat(s) || s.durationValue === null || !s.targetValue) continue;
    if (stepIndex >= s.durationValue && stepIndex < s.stepIndex) count *= s.targetValue;
  }
  return count;
}
