import { describe, expect, it } from "vitest";
import { bandDisplay, readinessParts, scoreWidthPct } from "@/features/status/readiness";

describe("readiness helpers", () => {
  it("covers every band", () => {
    expect(Object.keys(bandDisplay).sort()).toEqual(["low", "moderate", "prime", "ready", "rest"]);
  });

  it("lists the four parts in order, null when missing", () => {
    const parts = readinessParts({
      day: "2026-09-24",
      score: 64,
      band: "moderate",
      components: { sleep: 73, hrv: 64, tsb: 63 },
      weights: { sleep: 0.3, hrv: 0.25, tsb: 0.25, rhr: 0.2 },
      reasons: [],
      recommendation: "",
      garmin_training_readiness: null,
      flags: [],
    });
    expect(parts.map((p) => p.label)).toEqual(["Sleep", "HRV", "Form", "Resting HR"]);
    expect(parts[3]?.score).toBeNull();
  });

  it("clamps bar widths", () => {
    expect(scoreWidthPct(120)).toBe(100);
    expect(scoreWidthPct(-3)).toBe(0);
    expect(scoreWidthPct(null)).toBe(0);
  });
});
