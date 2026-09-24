import { describe, expect, it } from "vitest";
import { projectedPace } from "@/features/status/race";

const race = {
  name: "Half",
  date: "2027-01-15",
  distance_m: 21097.5,
  days_to_go: 113,
  projection: {
    from_distance_m: 10000,
    from_label: "10 km",
    from_seconds: 2880,
    from_day: "2026-09-01",
    projected_seconds: 6170,
    exponent: 1.06,
  },
};

describe("projectedPace", () => {
  it("divides the projected time by the race distance", () => {
    expect(projectedPace(race)).toBeCloseTo(6170 / 21.0975);
  });

  it("is null without a projection", () => {
    expect(projectedPace({ ...race, projection: null })).toBeNull();
  });
});
