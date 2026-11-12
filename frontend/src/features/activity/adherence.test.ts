import { describe, expect, it } from "vitest";
import type { Lap, PlanStep } from "@/api/adapters";
import { judge, plannedCount, plannedText, targetText } from "@/features/activity/adherence";
import { blocks, intervals } from "@/features/activity/intervals";

function step(stepIndex: number, over: Partial<PlanStep> = {}): PlanStep {
  return {
    stepIndex,
    intensity: "ACTIVE",
    durationType: "TIME",
    durationValue: 240,
    targetType: "OPEN",
    targetValue: null,
    targetLow: null,
    targetHigh: null,
    ...over,
  };
}

// The tempo plan of 26 Aug 2025: 32:00 at 2.833-3.111 m/s.
const tempo = step(1, {
  intensity: "INTERVAL",
  durationValue: 1920,
  targetType: "SPEED",
  targetLow: 2.833,
  targetHigh: 3.111,
});

describe("targetText", () => {
  it("says a speed range as pace, fast end first", () => {
    // 1000 / 3.111 = 321.4 s -> 5:21; 1000 / 2.833 = 353.0 s -> 5:53
    expect(targetText(tempo)).toBe("5:21–5:53 /km");
  });

  it("says cadence and heart-rate ranges in their units", () => {
    expect(targetText(step(2, { targetType: "CADENCE", targetLow: 150, targetHigh: 200 }))).toBe(
      "150–200 spm",
    );
    expect(targetText(step(2, { targetType: "HEART_RATE", targetLow: 134, targetHigh: 148 }))).toBe(
      "134–148 bpm",
    );
    expect(targetText(step(2, { targetType: "HEART_RATE", targetValue: 2 }))).toBe("zone 2");
  });

  it("is nothing for an open step", () => {
    expect(targetText(step(1))).toBeNull();
    expect(targetText(step(1, { targetType: null }))).toBeNull();
  });
});

describe("plannedText", () => {
  it("says time as a clock and distance as distance", () => {
    expect(plannedText(step(1))).toBe("4:00");
    expect(plannedText(step(1, { durationType: "DISTANCE", durationValue: 800 }))).toBe("800 m");
    expect(plannedText(step(1, { durationType: "OPEN", durationValue: null }))).toBeNull();
  });
});

describe("plannedCount", () => {
  it("multiplies by every repeat that loops over the step", () => {
    const plan = [
      step(0, { intensity: "WARMUP" }),
      step(1),
      step(2, { intensity: "REST", durationValue: 60 }),
      step(3, { durationType: "REPEAT_UNTIL_STEPS_CMPLT", durationValue: 1, targetValue: 10 }),
      step(4, { intensity: "COOLDOWN" }),
    ];
    expect(plannedCount(plan, 1)).toBe(10);
    expect(plannedCount(plan, 2)).toBe(10);
    expect(plannedCount(plan, 0)).toBe(1);
    expect(plannedCount(plan, 4)).toBe(1);
  });
});

describe("judge", () => {
  // 10 s samples: 2.0 m/s for the first 1200 s, then 3.0 m/s (inside 2.833-3.111).
  const elapsedS = Array.from({ length: 200 }, (_, i) => i * 10);
  const speed = elapsedS.map((t) => (t < 1200 ? 2.0 : 3.0));
  const streams = { elapsedS, hr: elapsedS.map(() => 140), smoothSpeedMps: speed };

  it("scores the share of time inside the range from the stream", () => {
    const out = judge(
      tempo,
      { startS: 0, durationS: 1920, distanceM: 4560, avgHr: 140, avgCadenceSpm: 165 },
      streams,
    );
    // 720 of 1920 s at 3.0 m/s: 37.5 % -> 38
    expect(out?.inRangePct).toBe(38);
    expect(out?.heldPlan).toBe(true);
  });

  it("says how far the average was off, as pace", () => {
    // 4560 m in 1920 s = 2.375 m/s = 421.1 s/km; the slow end is 353.0 s/km: 68 s slow.
    const out = judge(
      tempo,
      { startS: 0, durationS: 1920, distanceM: 4560, avgHr: 140, avgCadenceSpm: 165 },
      streams,
    );
    expect(out?.side).toBe("low");
    expect(out?.verdict).toBe("1:08 /km slow");
    expect(out?.on).toBe("pace");
  });

  it("is on target when the average is inside", () => {
    const out = judge(
      tempo,
      { startS: 1200, durationS: 600, distanceM: 1800, avgHr: 140, avgCadenceSpm: 165 },
      streams,
    );
    expect(out?.verdict).toBe("on target");
    expect(out?.inRangePct).toBe(100);
  });

  it("checks a distance step against its distance", () => {
    const repeat = step(9, {
      durationType: "DISTANCE",
      durationValue: 800,
      targetType: "SPEED",
      targetLow: 2.454,
      targetHigh: 2.531,
    });
    const s = { startS: 0, durationS: 320, avgHr: 150, avgCadenceSpm: 170 };
    expect(judge(repeat, { ...s, distanceM: 805 }, streams)?.heldPlan).toBe(true);
    expect(judge(repeat, { ...s, distanceM: 600 }, streams)?.heldPlan).toBe(false);
  });
});

function lap(
  index: number,
  intensity: string,
  stepIndex: number | null,
  startS: number,
  durationS: number,
  distanceM: number,
): Lap {
  return {
    index,
    startS,
    durationS,
    distanceM,
    intensity,
    stepIndex,
    avgHr: 140,
    maxHr: 145,
    avgSpeedMps: null,
    avgCadenceSpm: 165,
  };
}

describe("intervals against the plan", () => {
  // Last night's plan: 4:00 run / 1:00 walk, ten times; the battery gave out in rep 4.
  const plan = [
    step(0, { intensity: "WARMUP", durationType: "OPEN", durationValue: null }),
    step(1),
    step(2, { intensity: "REST", durationValue: 60 }),
    step(3, { durationType: "REPEAT_UNTIL_STEPS_CMPLT", durationValue: 1, targetValue: 10 }),
  ];
  const laps = [
    lap(1, "WARMUP", 0, 0, 142, 200),
    lap(2, "ACTIVE", 1, 142, 240, 508),
    lap(3, "REST", 2, 382, 60, 88),
    lap(4, "ACTIVE", 1, 442, 240, 490),
    lap(5, "REST", 2, 682, 60, 86),
    lap(6, "ACTIVE", 1, 742, 240, 497),
    lap(7, "REST", 2, 982, 60, 85),
    lap(8, "ACTIVE", 1, 1042, 26, 51),
  ];
  const out = intervals(laps, { elapsedS: [], hr: [] }, null, plan);

  it("counts each rep type against the plan and holds it to its planned length", () => {
    expect(out.summary).toEqual([
      // Ten planned; the battery gave out in the fourth, which stopped at 0:26.
      "4:00 reps: 4 of 10 done, 3 held it.",
      "Every 1:00 recovery was held.",
    ]);
    expect(out.shape).toBe("10 × 4:00 / 1:00");
  });

  it("merges blocks of the same rep and puts the biggest first", () => {
    // Strides: 2 × 0:30 in each of two blocks (steps 1 and 3); then 2 × 800 m (step 5).
    const mixed = [
      step(1, { durationValue: 30, targetType: "CADENCE", targetLow: 150, targetHigh: 200 }),
      step(2, { intensity: "RECOVERY", durationValue: 30 }),
      step(3, { durationValue: 30 }),
      step(4, { intensity: "RECOVERY", durationValue: 30 }),
      step(5, { durationType: "DISTANCE", durationValue: 800 }),
      step(6, { intensity: "RECOVERY", durationValue: 180 }),
      step(7, { durationType: "REPEAT_UNTIL_STEPS_CMPLT", durationValue: 5, targetValue: 2 }),
    ];
    const done = [
      lap(1, "ACTIVE", 1, 0, 30, 100),
      lap(2, "RECOVERY", 2, 30, 30, 50),
      lap(3, "ACTIVE", 3, 60, 30, 100),
      lap(4, "RECOVERY", 4, 90, 30, 50),
      lap(5, "ACTIVE", 5, 120, 300, 800),
      lap(6, "RECOVERY", 6, 420, 180, 300),
      lap(7, "ACTIVE", 5, 600, 300, 700),
      lap(8, "RECOVERY", 6, 900, 180, 300),
    ];
    expect(intervals(done, { elapsedS: [], hr: [] }, null, mixed).summary).toEqual([
      "800 m reps: all 2 done, 1 held it.",
      // One block had a cadence target, the other none: one sentence, the target on the one.
      "0:30 reps: all 2 done, every one held it; cadence inside 150–200 spm, averaging inside it.",
      "Every recovery was held.",
    ]);
  });

  it("does not flag an open step, which has nothing to hold", () => {
    const open = [...plan.slice(0, 1), step(1, { durationType: "OPEN", durationValue: null })];
    const rows = intervals(
      [
        lap(1, "WARMUP", 0, 0, 100, 100),
        lap(2, "ACTIVE", 1, 100, 8, 10),
        lap(3, "REST", 9, 108, 30, 30),
      ],
      { elapsedS: [], hr: [] },
      null,
      open,
    ).rows;
    expect(rows[1]?.onTime).toBe(true);
  });

  it("says nothing about a target the plan did not set", () => {
    expect(out.summary.some((s) => s.includes("target"))).toBe(false);
    expect(out.rows[1]?.plan?.target).toBeNull();
    expect(out.rows[1]?.plan?.planned).toBe("4:00");
  });

  it("scores a pace target over all the reps", () => {
    const paced = plan.map((p) =>
      p.stepIndex === 1 ? { ...p, targetType: "SPEED", targetLow: 2.0, targetHigh: 2.1 } : p,
    );
    // Rep averages: 508/240 = 2.117 (fast), 490/240 = 2.042 (in), 497/240 = 2.071 (in),
    // 51/26 = 1.962 (slow): 2 of 4 inside.
    expect(intervals(laps, { elapsedS: [], hr: [] }, null, paced).summary).toContain(
      // 2.1 m/s = 476.2 s/km -> 7:56; 2.0 m/s = 500 s/km -> 8:20
      "4:00 reps: 4 of 10 done, 3 held it; pace inside 7:56–8:20 /km, 2 of 4 averaging inside it.",
    );
  });
});

describe("blocks against the plan", () => {
  it("says how the main part went against its pace target", () => {
    const plan = [
      step(0, { intensity: "WARMUP", durationValue: 600 }),
      tempo,
      step(2, { intensity: "COOLDOWN", durationValue: 600 }),
    ];
    const laps = [
      lap(1, "WARMUP", 0, 0, 600, 1300),
      lap(2, "INTERVAL", 1, 600, 1000, 2000),
      lap(3, "INTERVAL", 1, 1600, 920, 1800),
      lap(4, "COOLDOWN", 2, 2520, 600, 1200),
    ];
    const out = blocks(laps, null, { elapsedS: [], hr: [] }, plan);
    // Main: 3800 m in 1920 s = 1.979 m/s = 505.3 s/km; slow end 353.0: 152 s slow -> 2:32
    expect(out?.summary).toContain(
      "Pace was inside its target (5:21–5:53 /km) and averaged 2:32 /km slow.",
    );
    expect(out?.rows[1]?.plan?.heldPlan).toBe(true);
  });

  it("says when a part fell short of its planned length", () => {
    const plan = [step(0, { durationType: "DISTANCE", durationValue: 4023 }), step(1)];
    const laps = [lap(1, "ACTIVE", 0, 0, 1200, 3000), lap(2, "ACTIVE", 1, 1200, 240, 500)];
    const out = blocks(laps, null, { elapsedS: [], hr: [] }, plan);
    expect(out?.summary).toContain("Part 1 ran 20:00 (3.0 km) of a planned 4.0 km.");
  });
});
