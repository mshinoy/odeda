import { describe, expect, it } from "vitest";
import type { components } from "@/api/schema";
import { toPersonalBestRows } from "@/features/trends/personalBestRow";
import { MISSING } from "@/lib/format";

type PersonalBest = components["schemas"]["PersonalBest"];

const TODAY = new Date(2026, 8, 25);

function best(overrides: Partial<PersonalBest> = {}): PersonalBest {
  return {
    distance_m: 10000,
    label: "10 k",
    seconds: 4918.5,
    day: "2025-03-17",
    activity_id: "18560798416",
    ...overrides,
  };
}

describe("toPersonalBestRows", () => {
  it("formats the time and derives the pace from it", () => {
    // 4918.5 s over 10 km is 491.85 s/km, which is 8:12 /km.
    const [row] = toPersonalBestRows([best()], [], TODAY);
    expect(row?.time).toBe("1:21:59");
    expect(row?.pace).toBe("8:12 /km");
    expect(row?.when).toBe("Mar 17, 2025");
    expect(row?.href).toBe("/activities/18560798416");
  });

  it("paces a non-round distance by its real length", () => {
    // The mile is 1609.34 m: 454.7 s over it is 282.5 s/km, 4:43 /km.
    const [row] = toPersonalBestRows(
      [best({ distance_m: 1609.34, label: "1 mile", seconds: 454.7 })],
      [],
      TODAY,
    );
    expect(row?.pace).toBe("4:43 /km");
  });

  it("puts the last 90 days beside the all-time best, matched by distance", () => {
    const recent = best({ seconds: 5400, day: "2026-09-06", activity_id: "24264030099" });
    const [row] = toPersonalBestRows([best()], [recent], TODAY);
    expect(row?.recent).toBe("1:30:00 · Sep 6");
    expect(row?.recentHref).toBe("/activities/24264030099");
  });

  it("leaves the 90-day pair empty for a distance not covered since", () => {
    const [row] = toPersonalBestRows([best()], [best({ distance_m: 5000, label: "5 k" })], TODAY);
    expect(row?.recent).toBe(MISSING);
    expect(row?.recentHref).toBeNull();
  });

  it("keeps the backend's order, which is shortest distance first", () => {
    const rows = toPersonalBestRows([best({ distance_m: 1000, label: "1 k" }), best()], [], TODAY);
    expect(rows.map((row) => row.label)).toEqual(["1 k", "10 k"]);
  });
});
