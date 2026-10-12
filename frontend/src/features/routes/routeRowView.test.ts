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
    layout: "loop",
    pinned: false,
    polyline: null,
    bestTimeS: 1722.9,
    medianTimeS: 2526.6,
    bestLapS: 601.5,
    medianLapS: 729,
    firstDay: "2024-01-18",
    lastDay: "2026-09-15",
    ...overrides,
  };
}

describe("toRouteRowView", () => {
  it("formats every cell through format.ts", () => {
    expect(toRouteRowView(route(), today)).toEqual({
      id: 31,
      href: "/routes/31",
      name: "5.0 km loop #31",
      kind: "run",
      typeLabel: "Trail running",
      polyline: null,
      shape: "Loop",
      attempts: "65",
      distance: "5.1 km",
      best: "10:02",
      median: "12:09",
      last: "Sep 15",
    });
  });

  it("names the shape the clusterer found", () => {
    expect(toRouteRowView(route({ layout: "out_and_back" }), today).shape).toBe("Out and back");
    expect(toRouteRowView(route({ isLoop: false, layout: "one_way" }), today).shape).toBe(
      "One way",
    );
  });

  it("times a loop by the lap and any other route by the attempt", () => {
    const outAndBack = toRouteRowView(route({ layout: "out_and_back" }), today);
    expect([outAndBack.best, outAndBack.median]).toEqual(["28:43", "42:07"]);
  });

  it("shows a dash rather than a zero for a route with no timed attempt or lap", () => {
    const untimed = toRouteRowView(route({ bestLapS: null, medianLapS: null }), today);
    expect([untimed.best, untimed.median]).toEqual([MISSING, MISSING]);
  });

  it("carries the year on a last attempt from an earlier one", () => {
    expect(toRouteRowView(route({ lastDay: "2025-03-04" }), today).last).toBe("Mar 4, 2025");
  });
});
