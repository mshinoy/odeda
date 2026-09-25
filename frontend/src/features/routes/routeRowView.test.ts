import { describe, expect, it } from "vitest";
import type { RouteListItem } from "@/api/adapters";
import { toRouteRowView } from "@/features/routes/routeRowView";
import { MISSING } from "@/lib/format";

const today = new Date(2026, 8, 25);

function route(overrides: Partial<RouteListItem> = {}): RouteListItem {
  return {
    id: 31,
    name: "5.0 km loop #31",
    activityType: "trail_running",
    kind: "run",
    distanceM: 5071.3,
    attempts: 65,
    isLoop: true,
    pinned: false,
    bestTimeS: 1722.9,
    medianTimeS: 2526.6,
    firstDay: "2024-01-18",
    lastDay: "2026-09-15",
    ...overrides,
  };
}

describe("toRouteRowView", () => {
  it("formats every cell through format.ts", () => {
    expect(toRouteRowView(route(), today)).toEqual({
      id: 31,
      name: "5.0 km loop #31",
      kind: "run",
      typeLabel: "Trail running",
      shape: "Loop",
      attempts: "65",
      distance: "5.1 km",
      best: "28:43",
      median: "42:07",
      last: "Sep 15",
    });
  });

  it("names the shape the clusterer found", () => {
    expect(toRouteRowView(route({ isLoop: false }), today).shape).toBe("Out and back");
  });

  it("shows a dash rather than a zero for a route with no timed attempt", () => {
    const untimed = toRouteRowView(route({ bestTimeS: null, medianTimeS: null }), today);
    expect([untimed.best, untimed.median]).toEqual([MISSING, MISSING]);
  });

  it("carries the year on a last attempt from an earlier one", () => {
    expect(toRouteRowView(route({ lastDay: "2025-03-04" }), today).last).toBe("Mar 4, 2025");
  });
});
