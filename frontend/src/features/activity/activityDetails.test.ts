import { describe, expect, it } from "vitest";
import { bestEffortRows, chartedSplits, hasZoneTime } from "@/features/activity/activityDetails";

describe("chartedSplits", () => {
  it("keeps timed splits when there are at least two", () => {
    const splits = [
      { km: 1, seconds: 300, avgHr: null },
      { km: 2, seconds: 0, avgHr: null },
      { km: 3, seconds: 310, avgHr: 150 },
    ];
    expect(chartedSplits(splits).map((s) => s.km)).toEqual([1, 3]);
  });

  it("is empty for a single split", () => {
    expect(chartedSplits([{ km: 1, seconds: 397, avgHr: 131 }])).toEqual([]);
    expect(chartedSplits([])).toEqual([]);
  });
});

describe("hasZoneTime", () => {
  it("is true only when some zone has time", () => {
    expect(hasZoneTime([{ zone: 1, seconds: 151 }])).toBe(true);
    expect(hasZoneTime([{ zone: 1, seconds: 0 }])).toBe(false);
    expect(hasZoneTime([])).toBe(false);
  });
});

describe("bestEffortRows", () => {
  const efforts = [
    { label: "5 k", distanceM: 5000, seconds: 1500 },
    { label: "1 k", distanceM: 1000, seconds: 270 },
    { label: null, distanceM: 3000, seconds: 870 },
  ];

  it("lists shortest first, with time and pace", () => {
    expect(bestEffortRows(efforts, "run")).toEqual([
      { key: "1000", distance: "1 k", time: "4:30", pace: "4:30 /km" },
      { key: "3000", distance: "3.0 km", time: "14:30", pace: "4:50 /km" },
      { key: "5000", distance: "5 k", time: "25:00", pace: "5:00 /km" },
    ]);
  });

  it("uses the sport's unit for pace", () => {
    const [ride] = bestEffortRows([{ label: "1 k", distanceM: 1000, seconds: 120 }], "ride");
    expect(ride?.pace).toBe("30.0 km/h");
  });

  it("drops efforts without a time", () => {
    expect(bestEffortRows([{ label: "1 k", distanceM: 1000, seconds: 0 }], "run")).toEqual([]);
  });
});
