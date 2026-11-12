import { describe, expect, it } from "vitest";
import type { Split } from "@/api/adapters";
import { kilometres } from "@/features/activity/kilometres";

function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`no item ${index}`);
  return value;
}

const run: Split[] = [500, 535, 560, 625, 520].map((seconds, i) => ({
  km: i + 1,
  seconds,
  avgHr: null,
}));

describe("kilometres on foot", () => {
  const out = kilometres(run, "run");

  it("is a row a kilometre, with the pace", () => {
    expect(out.unit).toBe("km");
    expect(out.rows.map((r) => r.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(out.rows.map((r) => r.value)).toEqual(["8:20", "8:55", "9:20", "10:25", "8:40"]);
  });

  it("makes a longer bar a faster kilometre: the fastest fills the row, the slowest still shows", () => {
    expect(out.rows[0]?.widthPct).toBe(100);
    expect(out.rows[3]?.widthPct).toBe(25);
    expect((out.rows[4]?.widthPct ?? 0) < 100).toBe(true);
    expect((out.rows[4]?.widthPct ?? 0) > (out.rows[1]?.widthPct ?? 0)).toBe(true);
  });

  it("names the fastest and the slowest", () => {
    expect(out.summary).toBe("Fastest: kilometre 1 (8:20). Slowest: kilometre 4 (10:25).");
  });

  it("reads a walk the same way", () => {
    expect(kilometres(run, "walk").rows).toHaveLength(5);
  });
});

describe("kilometres on a bike", () => {
  const ride: Split[] = Array.from({ length: 12 }, (_, i) => ({
    km: i + 1,
    seconds: i < 5 ? 120 : i < 10 ? 150 : 180,
    avgHr: null,
  }));
  const out = kilometres(ride, "ride");

  it("is a row for every five kilometres, the last one partial, in km/h", () => {
    expect(out.unit).toBe("5 km");
    expect(out.rows.map((r) => r.label)).toEqual(["1–5", "6–10", "11–12"]);
    expect(out.rows.map((r) => r.value)).toEqual(["30.0 km/h", "24.0 km/h", "20.0 km/h"]);
  });

  it("names the fastest and the slowest block", () => {
    expect(out.summary).toBe("Fastest: km 1–5 (30.0 km/h). Slowest: km 11–12 (20.0 km/h).");
  });
});

describe("kilometres with nothing to compare", () => {
  it("has no rows for one kilometre, for a swim, or for nothing", () => {
    expect(kilometres([at(run, 0)], "run").rows).toEqual([]);
    expect(kilometres(run, "swim").rows).toEqual([]);
    expect(kilometres([], "ride").rows).toEqual([]);
  });

  it("has no summary when every kilometre was the same", () => {
    const flat = [1, 2, 3].map((km) => ({ km, seconds: 300, avgHr: null }));
    const out = kilometres(flat, "run");
    expect(out.summary).toBeNull();
    expect(out.rows.every((r) => r.widthPct === 100)).toBe(true);
  });

  it("leaves out a kilometre with no time", () => {
    const gappy = [{ km: 1, seconds: 0, avgHr: null }, ...run];
    expect(kilometres(gappy, "run").rows).toHaveLength(5);
  });
});
