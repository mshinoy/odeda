import { describe, expect, it } from "vitest";
import type { Activity, ActivityStreams } from "@/api/adapters";
import { averageCadence, detailRows } from "@/features/activity/details";

function streams(cadence: (number | null)[]): ActivityStreams {
  return { cadenceSpm: cadence } as unknown as ActivityStreams;
}

describe("averageCadence", () => {
  it("averages the samples that were moving, not the standing ones", () => {
    expect(averageCadence(streams([0, 150, null, 170, 0]))).toBe(160);
  });
  it("is null with none", () => {
    expect(averageCadence(streams([0, null]))).toBeNull();
  });
});

function activity(
  over: Record<string, unknown> = {},
  cadence: (number | null)[] = [160],
): Activity {
  return {
    summary: {
      kind: "run",
      durationS: 6249,
      movingTimeS: 6162,
      elevationGainM: 50.4,
      maxHr: 166,
      calories: 1083,
      trimp: 141,
      trainingEffect: null,
      avgCadenceSpm: 124.75,
      ...over,
    },
    streams: streams(cadence),
    decouplingPct: 3.2,
  } as unknown as Activity;
}

describe("detailRows", () => {
  const rows = detailRows(activity());
  const byLabel = new Map(rows.map((r) => [r.label, r]));

  it("reads each number in its own unit", () => {
    expect(byLabel.get("Elapsed time")?.value).toBe("1:44:09");
    expect(byLabel.get("Moving time")?.value).toBe("1:42:42");
    expect(byLabel.get("Climb")?.value).toBe("50 m");
    // The watch's own average, not the stream's 160.
    expect(byLabel.get("Cadence")?.value).toBe("125 spm");
    expect(byLabel.get("Highest heart rate")?.value).toBe("166 bpm");
    expect(byLabel.get("Calories")?.value).toBe("1,083");
  });

  it("says what a steady drift means, and what an unsteady one means", () => {
    expect(byLabel.get("Heart-rate drift")?.note).toBe("Steady: heart rate stayed with the pace.");
    const drifting = detailRows({ ...activity(), decouplingPct: 8 } as unknown as Activity);
    expect(drifting.find((r) => r.label === "Heart-rate drift")?.note).toContain("rose against");
  });

  it("calls a ride's cadence rpm", () => {
    const ride = detailRows(activity({ kind: "ride", avgCadenceSpm: null }, [85]));
    expect(ride.find((r) => r.label === "Cadence")?.value).toBe("85 rpm");
  });

  it("leaves out what the activity does not have", () => {
    const bare = detailRows({
      ...activity({ maxHr: null, calories: null, trimp: null, avgCadenceSpm: null }, [null]),
      decouplingPct: null,
    } as unknown as Activity);
    const labels = bare.map((r) => r.label);
    expect(labels).not.toContain("Cadence");
    expect(labels).not.toContain("Highest heart rate");
    expect(labels).not.toContain("Calories");
    expect(labels).not.toContain("TRIMP");
    expect(labels).not.toContain("Heart-rate drift");
  });
});
