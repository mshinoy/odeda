// A structured workout's intervals, as the watch timed them: did each run rep hold its
// time, and did heart rate stay under the Zone 2 ceiling? The laps carry Garmin's own
// numbers; the stream adds heart rate at each lap's edges, which is what a walk is for.
import type { Lap } from "@/api/adapters";
import { formatPaceClock } from "@/lib/format";

export type IntervalKind = "warmup" | "run" | "walk" | "cooldown";

export interface IntervalRow {
  kind: IntervalKind;
  /** "Run 3", "Walk 3", "Warm-up". */
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
  /** Within a few seconds of the step's target time. */
  onTime: boolean;
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
  streams: { elapsedS: readonly number[]; hr: readonly (number | null)[] },
  ceiling: number | null,
): Intervals {
  const empty: Intervals = {
    rows: [],
    target: { run: null, walk: null },
    shape: null,
    summary: [],
  };
  if (!isWorkout(laps)) return empty;

  const steps = laps.filter(
    (l): l is Lap & { durationS: number } =>
      l.durationS !== null && l.durationS > 0 && !!l.intensity && !!KIND[l.intensity],
  );
  const durationsOf = (kind: IntervalKind) =>
    steps.filter((l) => KIND[l.intensity ?? ""] === kind).map((l) => l.durationS);
  const target = {
    run: commonDuration(durationsOf("run")),
    walk: commonDuration(durationsOf("walk")),
  };

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
      onTime: goal !== null && Math.abs(lap.durationS - goal) <= ON_TIME_S,
    };
  });

  const runRows = rows.filter((r) => r.kind === "run");
  const walkRows = rows.filter((r) => r.kind === "walk");
  const shape =
    target.run !== null && target.walk !== null
      ? `${formatPaceClock(target.run)} run / ${formatPaceClock(target.walk)} walk`
      : null;

  const summary: string[] = [];
  if (target.run !== null) {
    const held = runRows.filter((r) => r.onTime).length;
    const last = runRows[runRows.length - 1];
    const cutShort = last && !last.onTime && last.durationS < target.run;
    const time = formatPaceClock(target.run);
    let sentence =
      held === runRows.length
        ? `All ${held} run reps held ${time}.`
        : `${held} of ${runRows.length} run reps held ${time}.`;
    if (cutShort && held === runRows.length - 1) sentence += ` The last stopped at ${last.time}.`;
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

  return { rows, target, shape, summary };
}
