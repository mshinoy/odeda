// A structured workout's intervals, as the watch timed them: did each run rep hold its
// time, and did heart rate stay under the Zone 2 ceiling? The laps carry Garmin's own
// numbers; the stream adds heart rate at each lap's edges, which is what a walk is for.
import type { Lap, PlanStep } from "@/api/adapters";
import {
  isRepeat,
  judge,
  plannedCount,
  plannedText,
  type StepJudgement,
  type StreamsLike,
} from "@/features/activity/adherence";
import { formatDistance, formatPaceClock } from "@/lib/format";

export type IntervalKind = "warmup" | "run" | "walk" | "cooldown" | "after";

export interface IntervalRow {
  kind: IntervalKind;
  /** "Run 3", "Walk 3", "Warm-up", "After the workout". */
  label: string;
  durationS: number;
  /** "4:00". */
  time: string;
  /** "8:09 /km", or null without distance. */
  pace: string | null;
  avgHr: number | null;
  maxHr: number | null;
  /** Heart rate at the lap's first and last sample, from the stream. */
  hrIn: number | null;
  hrOut: number | null;
  cadenceSpm: number | null;
  /** A run rep whose peak passed the Zone 2 ceiling. */
  overCeiling: boolean;
  /** Held the planned time or distance; without a plan, within a few seconds of the usual. */
  onTime: boolean;
  /** Against the step's plan: its target and how this rep measured up. Null without one. */
  plan: StepJudgement | null;
  /** The plan step this lap ran; null after the workout. */
  stepIndex: number | null;
}

export interface Intervals {
  rows: IntervalRow[];
  /** The step times, most common first: { run: 240, walk: 60 }. */
  target: { run: number | null; walk: number | null };
  /** "4:00 run / 1:00 walk". */
  shape: string | null;
  /** The answer, in a sentence or three. */
  summary: string[];
}

/** How close to the target a step has to be to count as held. */
const ON_TIME_S = 5;

const KIND: Record<string, IntervalKind> = {
  WARMUP: "warmup",
  ACTIVE: "run",
  INTERVAL: "run",
  REST: "walk",
  RECOVERY: "walk",
  COOLDOWN: "cooldown",
};

/** Zone 2's top by heart-rate reserve (70 %), the convention the backend's zones use. */
export function zone2Ceiling(hrRest: number | null | undefined, hrMax: number | null | undefined) {
  if (!hrRest || !hrMax || hrMax <= hrRest) return null;
  return Math.floor(hrRest + 0.7 * (hrMax - hrRest));
}

type TimedLap = Lap & { durationS: number };

function timed(laps: readonly Lap[]): TimedLap[] {
  return laps.filter((l): l is TimedLap => l.durationS !== null && l.durationS > 0);
}

/**
 * Laps run after the workout ended: the watch keeps lapping, but with no step. Only
 * meaningful when some lap does carry a step, i.e. a workout was followed at all.
 */
function splitAfter(laps: readonly Lap[]): { inside: Lap[]; after: Lap[] } {
  if (!laps.some((l) => l.stepIndex !== null)) return { inside: [...laps], after: [] };
  return {
    inside: laps.filter((l) => l.stepIndex !== null),
    after: laps.filter((l) => l.stepIndex === null),
  };
}

/** Several laps as one: summed time and distance, time-weighted HR, the highest peak. */
function combine(laps: readonly TimedLap[]) {
  const durationS = laps.reduce((a, l) => a + l.durationS, 0);
  const distanceM = laps.reduce((a, l) => a + (l.distanceM ?? 0), 0);
  const withHr = laps.filter((l) => l.avgHr !== null);
  const hrTime = withHr.reduce((a, l) => a + l.durationS, 0);
  const peaks = laps.flatMap((l) => (l.maxHr === null ? [] : [l.maxHr]));
  const withCad = laps.filter((l) => l.avgCadenceSpm !== null);
  const cadTime = withCad.reduce((a, l) => a + l.durationS, 0);
  return {
    startS: laps[0]?.startS ?? null,
    avgCadenceSpm:
      cadTime > 0
        ? withCad.reduce((a, l) => a + (l.avgCadenceSpm ?? 0) * l.durationS, 0) / cadTime
        : null,
    durationS,
    distanceM,
    avgHr:
      hrTime > 0
        ? Math.round(withHr.reduce((a, l) => a + (l.avgHr ?? 0) * l.durationS, 0) / hrTime)
        : null,
    maxHr: peaks.length > 0 ? Math.max(...peaks) : null,
    pace: distanceM > 0 ? durationS / (distanceM / 1000) : null,
  };
}

function afterRow(after: readonly Lap[]): IntervalRow | null {
  const laps = timed(after);
  if (laps.length === 0) return null;
  const c = combine(laps);
  return {
    kind: "after",
    label: "After the workout",
    durationS: c.durationS,
    time: formatPaceClock(c.durationS),
    pace: c.pace === null ? null : `${formatPaceClock(c.pace)} /km`,
    avgHr: c.avgHr,
    maxHr: c.maxHr,
    hrIn: null,
    hrOut: null,
    cadenceSpm: null,
    overCeiling: false,
    onTime: false,
    plan: null,
    stepIndex: null,
  };
}

function afterSentence(after: readonly Lap[]): string | null {
  const c = combine(timed(after));
  if (c.durationS <= 0) return null;
  return c.distanceM > 0
    ? `Then ${formatDistance(c.distanceM)} more after the workout ended.`
    : `Then ${formatPaceClock(c.durationS)} more after the workout ended.`;
}

function stepsByIndex(plan: readonly PlanStep[]): Map<number, PlanStep> {
  return new Map(plan.filter((p) => !isRepeat(p)).map((p) => [p.stepIndex, p]));
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * How the targeted stretches went, in one sentence: the share of their time inside the
 * target, and how many averaged inside it. Only stretches aimed at the same thing as the
 * first targeted one are counted, so pace and cadence are never mixed.
 */
function targetSentence(
  rows: readonly { durationS: number; label: string; plan: StepJudgement | null }[],
  noun: string,
  subject?: string,
): string | null {
  const first = rows.find((r) => r.plan?.on && r.plan.target);
  const on = first?.plan?.on;
  if (!first?.plan || !on) return null;
  const aimed = rows.filter((r) => r.plan?.on === on);
  const timed = aimed.filter((r) => r.plan?.inRangePct != null);
  const total = timed.reduce((a, r) => a + r.durationS, 0);
  const pct =
    total > 0
      ? Math.round(timed.reduce((a, r) => a + (r.plan?.inRangePct ?? 0) * r.durationS, 0) / total)
      : null;
  if (aimed.length === 1) {
    const verdict = first.plan.verdict;
    const share = pct === null ? "" : ` for ${pct}% of the time`;
    const avg =
      verdict === null
        ? ""
        : verdict === "on target"
          ? " and averaged inside it"
          : ` and averaged ${verdict}`;
    const lead = subject ? `${subject}: ${on}` : capitalise(on);
    return `${lead} was inside its target (${first.plan.target})${share}${avg}.`;
  }
  const inside = aimed.filter((r) => r.plan?.side === "in").length;
  const share = pct === null ? "" : ` for ${pct}% of the time`;
  const lead = subject ? `${subject}: ${on}` : capitalise(on);
  return `${lead} was inside its target (${first.plan.target})${share}; ${inside} of ${aimed.length} ${noun} averaged inside it.`;
}

/**
 * The plan's shape, one repeat at a time: "10 × 4:00 / 1:00", or for a session of several
 * blocks "4 × 0:30 / 0:30 · 12 × 800 m / 3:00". Steps outside any repeat are left out.
 */
function planShape(plan: readonly PlanStep[]): string | null {
  const parts: string[] = [];
  for (const r of plan) {
    if (!isRepeat(r) || r.durationValue === null || !r.targetValue) continue;
    const from = r.durationValue;
    const inner = plan
      .filter((p) => !isRepeat(p) && p.stepIndex >= from && p.stepIndex < r.stepIndex)
      .map((p) => plannedText(p))
      .filter((t): t is string => t !== null);
    if (inner.length > 0) parts.push(`${Math.round(r.targetValue)} × ${inner.join(" / ")}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * How a group of targeted stretches did, as a clause: "pace inside 6:35–6:47 /km for 8% of
 * the time, 1 of 12 averaged inside it". Null when the group had no target.
 */
function targetClause(
  all: readonly { durationS: number; plan: StepJudgement | null }[],
): string | null {
  let rows = all;
  const first = all.find((r) => r.plan?.on && r.plan.target)?.plan;
  if (!first?.on) return null;
  // Only the reps aimed at that same target: a block of strides may have had none.
  rows = rows.filter((r) => r.plan?.on === first.on && r.plan.target === first.target);
  const timed = rows.filter((r) => r.plan?.inRangePct != null);
  const total = timed.reduce((a, r) => a + r.durationS, 0);
  const pct =
    total > 0
      ? Math.round(timed.reduce((a, r) => a + (r.plan?.inRangePct ?? 0) * r.durationS, 0) / total)
      : null;
  const share = pct === null ? "" : ` for ${pct}% of the time`;
  if (rows.length === 1) {
    const avg =
      first.verdict === null
        ? ""
        : first.verdict === "on target"
          ? ", averaging inside it"
          : `, averaging ${first.verdict}`;
    return `${first.on} inside ${first.target}${share}${avg}`;
  }
  const inside = rows.filter((r) => r.plan?.side === "in").length;
  return `${first.on} inside ${first.target}${share}, ${inside} of ${rows.length} averaging inside it`;
}

/**
 * Rep by rep type, against the plan: one sentence per kind of rep (the same planned length
 * and target), the biggest first, then one for the recoveries.
 */
function planSentences(rows: readonly IntervalRow[], plan: readonly PlanStep[]): string[] {
  const out: string[] = [];
  const planned = stepsByIndex(plan);
  const groups = (kind: IntervalKind) => {
    const byKind = new Map<
      string,
      { length: string; meant: number; rows: IntervalRow[]; steps: Set<number> }
    >();
    for (const r of rows) {
      if (r.kind !== kind || r.stepIndex === null) continue;
      const step = planned.get(r.stepIndex);
      const length = step ? plannedText(step) : null;
      if (!step || !length) continue;
      const key = length;
      const g = byKind.get(key) ?? { length, meant: 0, rows: [], steps: new Set<number>() };
      if (!g.steps.has(r.stepIndex)) {
        g.steps.add(r.stepIndex);
        g.meant += plannedCount(plan, r.stepIndex);
      }
      g.rows.push(r);
      byKind.set(key, g);
    }
    const time = (g: { rows: IntervalRow[] }) => g.rows.reduce((a, r) => a + r.durationS, 0);
    return [...byKind.values()].sort((a, b) => time(b) - time(a));
  };

  for (const g of groups("run")) {
    const n = g.rows.length;
    const held = g.rows.filter((r) => r.onTime).length;
    const done = n < g.meant ? `${n} of ${g.meant} done` : `all ${n} done`;
    const kept = held === n ? "every one held it" : `${held} held it`;
    const aimed = targetClause(g.rows);
    out.push(`${g.length} reps: ${done}, ${kept}${aimed ? `; ${aimed}` : ""}.`);
  }
  const walks = groups("walk");
  const all = walks.flatMap((g) => g.rows);
  if (all.length > 0) {
    const held = all.filter((r) => r.onTime).length;
    const what = walks.length === 1 ? `${walks[0]?.length} recover` : "recover";
    out.push(
      held === all.length
        ? `Every ${what}y was held.`
        : `${held} of ${all.length} ${what}ies were held.`,
    );
  }
  return out;
}

/** A workout, rather than auto laps: it has run steps and recovery steps. */
export function isWorkout(laps: readonly Lap[]): boolean {
  const kinds = new Set(laps.map((l) => (l.intensity ? KIND[l.intensity] : undefined)));
  return kinds.has("run") && kinds.has("walk");
}

/** The most common duration, to the second, among steps of one kind. */
function commonDuration(durations: readonly number[]): number | null {
  const counts = new Map<number, number>();
  for (const d of durations) {
    const key = Math.round(d);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [d, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && d > best)) {
      best = d;
      bestCount = n;
    }
  }
  return bestCount >= 2 ? best : null;
}

/** Heart rate at the sample nearest `t`, or null when the stream has none there. */
function hrAt(
  elapsedS: readonly number[],
  hr: readonly (number | null)[],
  t: number,
): number | null {
  if (elapsedS.length === 0) return null;
  let lo = 0;
  let hi = elapsedS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((elapsedS[mid] ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  const prev = lo > 0 ? lo - 1 : lo;
  const pick = Math.abs((elapsedS[prev] ?? 0) - t) < Math.abs((elapsedS[lo] ?? 0) - t) ? prev : lo;
  return hr[pick] ?? null;
}

function ordinalList(numbers: readonly number[]): string {
  if (numbers.length <= 2) return numbers.join(" and ");
  return `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
}

/** 3, 4, 5 ... last: every rep from one point to the end. */
function fromOn(numbers: readonly number[], last: number): boolean {
  return (
    numbers.length >= 2 &&
    numbers[numbers.length - 1] === last &&
    numbers.every((n, i) => i === 0 || n === (numbers[i - 1] ?? 0) + 1)
  );
}

export function intervals(
  laps: readonly Lap[],
  streams: StreamsLike,
  ceiling: number | null,
  plan: readonly PlanStep[] = [],
): Intervals {
  const empty: Intervals = {
    rows: [],
    target: { run: null, walk: null },
    shape: null,
    summary: [],
  };
  if (!isWorkout(laps)) return empty;

  const { inside, after } = splitAfter(laps);
  const steps = timed(inside).filter((l) => !!l.intensity && !!KIND[l.intensity]);
  const durationsOf = (kind: IntervalKind) =>
    steps.filter((l) => KIND[l.intensity ?? ""] === kind).map((l) => l.durationS);
  const target = {
    run: commonDuration(durationsOf("run")),
    walk: commonDuration(durationsOf("walk")),
  };

  const planned = stepsByIndex(plan);
  let runs = 0;
  let walks = 0;
  const rows: IntervalRow[] = steps.map((lap) => {
    const kind = KIND[lap.intensity ?? ""] ?? "run";
    const n = kind === "run" ? ++runs : kind === "walk" ? ++walks : 0;
    const label =
      kind === "warmup"
        ? "Warm-up"
        : kind === "cooldown"
          ? "Cool-down"
          : `${kind === "run" ? "Run" : "Walk"} ${n}`;
    const goal = kind === "run" ? target.run : kind === "walk" ? target.walk : null;
    const start = lap.startS;
    const metres = lap.distanceM ?? 0;
    const judged = judge(
      lap.stepIndex === null ? undefined : planned.get(lap.stepIndex),
      lap,
      streams,
    );
    return {
      kind,
      label,
      durationS: lap.durationS,
      time: formatPaceClock(lap.durationS),
      pace: metres > 0 ? `${formatPaceClock(lap.durationS / (metres / 1000))} /km` : null,
      avgHr: lap.avgHr,
      maxHr: lap.maxHr,
      hrIn: start === null ? null : hrAt(streams.elapsedS, streams.hr, start),
      hrOut: start === null ? null : hrAt(streams.elapsedS, streams.hr, start + lap.durationS),
      cadenceSpm: lap.avgCadenceSpm,
      overCeiling: kind === "run" && ceiling !== null && (lap.maxHr ?? 0) > ceiling,
      // An open step (to the lap button) has nothing to hold, so it is never flagged.
      onTime: judged
        ? (judged.heldPlan ?? true)
        : goal !== null && Math.abs(lap.durationS - goal) <= ON_TIME_S,
      plan: judged,
      stepIndex: lap.stepIndex,
    };
  });

  const tail = afterRow(after);
  if (tail) rows.push(tail);

  const runRows = rows.filter((r) => r.kind === "run");
  const walkRows = rows.filter((r) => r.kind === "walk");
  const shape =
    plan.length > 0
      ? planShape(plan)
      : target.run !== null && target.walk !== null
        ? `${formatPaceClock(target.run)} run / ${formatPaceClock(target.walk)} walk`
        : null;

  const summary: string[] = [];
  if (plan.length > 0) {
    summary.push(...planSentences(rows, plan));
  } else {
    if (target.run !== null) {
      const held = runRows.filter((r) => r.onTime).length;
      const last = runRows[runRows.length - 1];
      const cutShort = last && !last.onTime && last.durationS < target.run;
      const time = formatPaceClock(target.run);
      let sentence =
        held === runRows.length
          ? `All ${held} run reps held ${time}.`
          : `${held} of ${runRows.length} run reps held ${time}.`;
      if (cutShort && held === runRows.length - 1) {
        sentence += ` The last stopped at ${last.time}.`;
      }
      summary.push(sentence);
    }
    if (target.walk !== null && walkRows.length > 0) {
      const held = walkRows.filter((r) => r.onTime).length;
      const time = formatPaceClock(target.walk);
      summary.push(
        held === walkRows.length
          ? `Every walk held ${time}.`
          : `${held} of ${walkRows.length} walks held ${time}.`,
      );
    }
  }
  if (ceiling !== null && runRows.some((r) => r.maxHr !== null)) {
    // A last rep cut short (a dead battery, the end of the road) does not break "from run n on".
    const final = runRows[runRows.length - 1];
    const lastFull =
      final && target.run !== null && !final.onTime && final.durationS < target.run
        ? runRows.length - 1
        : runRows.length;
    const over = runRows
      .map((r, i) => (r.overCeiling ? i + 1 : null))
      .filter((n): n is number => n !== null);
    summary.push(
      over.length === 0
        ? `Heart rate stayed under the Zone 2 ceiling (${ceiling}) in every run rep.`
        : over.length === runRows.length
          ? `Heart rate went past the Zone 2 ceiling (${ceiling}) in every run rep.`
          : fromOn(over, runRows.length) || fromOn(over, lastFull)
            ? `Heart rate went past the Zone 2 ceiling (${ceiling}) from run ${over[0]} on.`
            : `Heart rate went past the Zone 2 ceiling (${ceiling}) in runs ${ordinalList(over)}.`,
    );
  }
  const drops = walkRows
    .filter((r) => r.hrIn !== null && r.hrOut !== null)
    .map((r) => (r.hrIn ?? 0) - (r.hrOut ?? 0));
  if (drops.length > 0) {
    const mean = Math.round(drops.reduce((a, b) => a + b, 0) / drops.length);
    summary.push(`Each walk brought it down ${mean} bpm on average.`);
  }
  const then = after.length > 0 ? afterSentence(after) : null;
  if (then) summary.push(then);

  return { rows, target, shape, summary };
}

// ---------------------------------------------------------------- step workouts

export interface BlockRow {
  kind: "warmup" | "main" | "cooldown" | "after";
  /** "Warm-up", "Main", "Part 2", "Cool-down", "After the workout". */
  label: string;
  durationS: number;
  time: string;
  distance: string | null;
  pace: string | null;
  /** Seconds per km, for comparing parts. */
  paceS: number | null;
  avgHr: number | null;
  maxHr: number | null;
  overCeiling: boolean;
  plan: StepJudgement | null;
}

export interface Blocks {
  rows: BlockRow[];
  summary: string[];
}

/**
 * A workout without recovery steps (a tempo, a threshold, a negative split), step by step.
 * The watch cuts each step into auto laps; consecutive laps of one step are one block.
 * Null when there is no such workout: fewer than two steps is a plain run.
 */
export function blocks(
  laps: readonly Lap[],
  ceiling: number | null,
  streams: StreamsLike = { elapsedS: [], hr: [] },
  plan: readonly PlanStep[] = [],
): Blocks | null {
  if (isWorkout(laps)) return null;
  const { inside, after } = splitAfter(laps);
  const steps = timed(inside).filter((l) => l.stepIndex !== null && !!l.intensity);

  const groups: TimedLap[][] = [];
  for (const lap of steps) {
    const current = groups[groups.length - 1];
    const head = current?.[0];
    if (current && head && head.stepIndex === lap.stepIndex && head.intensity === lap.intensity) {
      current.push(lap);
    } else {
      groups.push([lap]);
    }
  }
  if (groups.length < 2) return null;

  const kindOf = (g: TimedLap[]): BlockRow["kind"] => {
    const k = KIND[g[0]?.intensity ?? ""];
    return k === "warmup" ? "warmup" : k === "cooldown" ? "cooldown" : "main";
  };
  const mains = groups.filter((g) => kindOf(g) === "main").length;
  const planned = stepsByIndex(plan);
  let part = 0;
  const rows: BlockRow[] = groups.map((g) => {
    const kind = kindOf(g);
    const c = combine(g);
    const label =
      kind === "warmup"
        ? "Warm-up"
        : kind === "cooldown"
          ? "Cool-down"
          : mains === 1
            ? "Main"
            : `Part ${++part}`;
    return {
      kind,
      label,
      durationS: c.durationS,
      time: formatPaceClock(c.durationS),
      distance: c.distanceM > 0 ? formatDistance(c.distanceM) : null,
      pace: c.pace === null ? null : `${formatPaceClock(c.pace)} /km`,
      paceS: c.pace,
      avgHr: c.avgHr,
      maxHr: c.maxHr,
      overCeiling: ceiling !== null && (c.maxHr ?? 0) > ceiling,
      plan: judge(g[0]?.stepIndex == null ? undefined : planned.get(g[0].stepIndex), c, streams),
    };
  });
  const tail = afterRow(after);
  if (tail) {
    rows.push({
      kind: "after",
      label: tail.label,
      durationS: tail.durationS,
      time: tail.time,
      distance: (() => {
        const m = combine(timed(after)).distanceM;
        return m > 0 ? formatDistance(m) : null;
      })(),
      pace: tail.pace,
      paceS: null,
      avgHr: tail.avgHr,
      maxHr: tail.maxHr,
      overCeiling: false,
      plan: null,
    });
  }

  const summary: string[] = [];
  const mainRows = rows.filter((r) => r.kind === "main");
  const longest = mainRows.reduce<BlockRow | null>(
    (a, b) => (a === null || b.durationS > a.durationS ? b : a),
    null,
  );
  if (longest) {
    const what = mains === 1 ? "The main part" : `${longest.label}, the longest`;
    const parts = [
      longest.distance ? `${longest.distance} in ${longest.time}` : longest.time,
      longest.pace ? `at ${longest.pace}` : null,
    ].filter(Boolean);
    const hr =
      longest.avgHr !== null && longest.maxHr !== null
        ? `, heart rate averaging ${longest.avgHr} and peaking at ${longest.maxHr}`
        : "";
    summary.push(`${what}: ${parts.join(" ")}${hr}.`);
  }
  const first = mainRows[0];
  const last = mainRows[mainRows.length - 1];
  if (mainRows.length >= 2 && first?.paceS != null && last?.paceS != null && first !== last) {
    const diff = Math.round(last.paceS - first.paceS);
    summary.push(
      Math.abs(diff) < 3
        ? `${last.label} was run at the same pace as ${first.label.toLowerCase()}.`
        : `${last.label} was ${formatPaceClock(Math.abs(diff))} /km ${diff < 0 ? "faster" : "slower"} than ${first.label.toLowerCase()}.`,
    );
  }
  const short = mainRows.filter((r) => r.plan?.heldPlan === false && r.plan.planned);
  for (const r of short) {
    summary.push(
      `${r.label} ran ${r.time} (${r.distance ?? "–"}) of a planned ${r.plan?.planned}.`,
    );
  }
  const aimed = targetSentence(mainRows, "parts");
  if (aimed) summary.push(aimed);
  if (ceiling !== null && mainRows.some((r) => r.maxHr !== null)) {
    const over = mainRows.filter((r) => r.overCeiling);
    summary.push(
      over.length === 0
        ? `Heart rate stayed under the Zone 2 ceiling (${ceiling}) ${mains === 1 ? "in the main part" : "in every part"}.`
        : mains === 1
          ? `Heart rate went past the Zone 2 ceiling (${ceiling}) in the main part.`
          : over.length === mainRows.length
            ? `Heart rate went past the Zone 2 ceiling (${ceiling}) in every part.`
            : `Heart rate went past the Zone 2 ceiling (${ceiling}) in ${over.length === 1 ? "part" : "parts"} ${ordinalList(over.map((r) => Number(r.label.replace("Part ", ""))))}.`,
    );
  }
  const then = after.length > 0 ? afterSentence(after) : null;
  if (then) summary.push(then);

  return { rows, summary };
}
