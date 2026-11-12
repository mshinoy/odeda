import { describe, expect, it } from "vitest";
import type { Lap } from "@/api/adapters";
import { intervals, isWorkout, zone2Ceiling } from "@/features/activity/intervals";

function lap(
  index: number,
  startS: number,
  durationS: number,
  intensity: string | null,
  maxHr: number | null = null,
  distanceM: number | null = null,
): Lap {
  return {
    index,
    startS,
    durationS,
    distanceM,
    intensity,
    avgHr: maxHr === null ? null : maxHr - 10,
    maxHr,
    avgSpeedMps: null,
    avgCadenceSpm: 165,
  };
}

// Warm-up, then 4:00 run / 1:00 walk three times, the last run cut short at 0:26.
const laps: Lap[] = [
  lap(1, 0, 142, "WARMUP", 119, 200),
  lap(2, 142, 240, "ACTIVE", 139, 508),
  lap(3, 382, 60, "REST", 139, 88),
  lap(4, 442, 240, "ACTIVE", 148, 490),
  lap(5, 682, 60, "REST", 148, 86),
  lap(6, 742, 240, "ACTIVE", 155, 497),
  lap(7, 982, 61, "REST", 156, 85),
  lap(8, 1043, 26, "ACTIVE", 146, 51),
];

// One sample every 2 s; heart rate is 150 at the end of each run and 130 at the end of
// each walk, so every walk reads 150 -> 130.
const elapsedS = Array.from({ length: 600 }, (_, i) => i * 2);
const hr = elapsedS.map((t) => (t === 382 || t === 682 || t === 982 ? 150 : 130));
const streams = { elapsedS, hr };

describe("zone2Ceiling", () => {
  it("is 70 % of heart-rate reserve, rounded down", () => {
    // 52 + 0.7 * (187 - 52) = 52 + 94.5 = 146.5 -> 146
    expect(zone2Ceiling(52, 187)).toBe(146);
  });

  it("is unknown without both numbers", () => {
    expect(zone2Ceiling(null, 187)).toBeNull();
    expect(zone2Ceiling(52, undefined)).toBeNull();
  });
});

describe("isWorkout", () => {
  it("needs run steps and recovery steps", () => {
    expect(isWorkout(laps)).toBe(true);
    expect(isWorkout([lap(1, 0, 300, null), lap(2, 300, 300, null)])).toBe(false);
    expect(isWorkout([lap(1, 0, 300, "ACTIVE"), lap(2, 300, 300, "ACTIVE")])).toBe(false);
  });
});

describe("intervals", () => {
  const out = intervals(laps, streams, 146);

  it("numbers the runs and walks separately", () => {
    expect(out.rows.map((r) => r.label)).toEqual([
      "Warm-up",
      "Run 1",
      "Walk 1",
      "Run 2",
      "Walk 2",
      "Run 3",
      "Walk 3",
      "Run 4",
    ]);
  });

  it("finds the workout's shape from the most common step times", () => {
    expect(out.target).toEqual({ run: 240, walk: 60 });
    expect(out.shape).toBe("4:00 run / 1:00 walk");
  });

  it("gives each rep its time and pace", () => {
    const run1 = out.rows[1];
    expect(run1?.time).toBe("4:00");
    // 240 s over 0.508 km = 472.4 s/km -> 7:52
    expect(run1?.pace).toBe("7:52 /km");
  });

  it("marks reps whose peak passed the ceiling", () => {
    expect(out.rows.filter((r) => r.overCeiling).map((r) => r.label)).toEqual(["Run 2", "Run 3"]);
  });

  it("reads heart rate at each lap's edges from the stream", () => {
    const walk1 = out.rows[2];
    expect(walk1?.hrIn).toBe(150);
    expect(walk1?.hrOut).toBe(130);
  });

  it("answers in sentences", () => {
    expect(out.summary).toEqual([
      "3 of 4 run reps held 4:00. The last stopped at 0:26.",
      "Every walk held 1:00.",
      // Runs 2 and 3 ran hot; run 4 was cut short, so it does not count against "on".
      "Heart rate went past the Zone 2 ceiling (146) from run 2 on.",
      "Each walk brought it down 20 bpm on average.",
    ]);
  });

  it("says 'from run n on' when every rep after one point ran hot", () => {
    const hot = laps.map((l) =>
      l.intensity === "ACTIVE" && l.index > 2 ? { ...l, maxHr: 160 } : l,
    );
    expect(intervals(hot, streams, 146).summary).toContain(
      "Heart rate went past the Zone 2 ceiling (146) from run 2 on.",
    );
  });

  it("lists the reps when the hot ones are not one stretch to the end", () => {
    const patchy = laps.map((l) =>
      l.index === 2 || l.index === 6 ? { ...l, maxHr: 160 } : { ...l, maxHr: 140 },
    );
    expect(intervals(patchy, streams, 146).summary).toContain(
      "Heart rate went past the Zone 2 ceiling (146) in runs 1 and 3.",
    );
  });

  it("says so when every rep stayed easy", () => {
    expect(intervals(laps, streams, 160).summary).toContain(
      "Heart rate stayed under the Zone 2 ceiling (160) in every run rep.",
    );
  });

  it("leaves out heart-rate sentences without a ceiling", () => {
    expect(intervals(laps, streams, null).summary.some((s) => s.includes("Zone 2"))).toBe(false);
  });

  it("is empty for auto laps", () => {
    expect(intervals([lap(1, 0, 300, null), lap(2, 300, 300, null)], streams, 146).rows).toEqual(
      [],
    );
  });
});
