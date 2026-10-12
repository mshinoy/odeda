import { describe, expect, it } from "vitest";
import type { RouteAttempt, RouteListItem } from "@/api/adapters";
import {
  mergeCandidates,
  pickLabel,
  splitBlockedReason,
  splitOptions,
  toggle,
} from "@/features/routes/routePicks";

const today = new Date(2026, 8, 25);

function route(overrides: Partial<RouteListItem> = {}): RouteListItem {
  return {
    id: 4,
    name: "4.2 km route #4",
    activityType: "running",
    kind: "run",
    distanceM: 5020,
    attempts: 25,
    isLoop: true,
    layout: "loop",
    pinned: false,
    polyline: null,
    bestTimeS: 1980,
    medianTimeS: 2488,
    bestLapS: null,
    medianLapS: null,
    firstDay: "2024-02-01",
    lastDay: "2025-02-24",
    ...overrides,
  };
}

function attempt(overrides: Partial<RouteAttempt> = {}): RouteAttempt {
  return {
    activityId: "a1",
    day: "2026-09-15",
    startLocal: "2026-09-15T06:10:00",
    name: "Doha Running",
    distanceM: 5047.7,
    movingTimeS: 2499.9,
    avgHr: 145,
    avgSpeedMps: 2.018,
    excluded: false,
    manual: false,
    laps: null,
    lapTimesS: [],
    bestLapS: null,
    ...overrides,
  };
}

describe("mergeCandidates", () => {
  const target = { id: 31, activityType: "running" };
  const score = (id: number, similarity: number, away: number) => ({
    route_id: id,
    similarity,
    metres_away: away,
  });

  it("keeps the server's order, most alike then nearest", () => {
    const routes = [route({ id: 4 }), route({ id: 9 }), route({ id: 42 })];
    const scored = [score(42, 0.157, 190), score(9, 0, 1810), score(4, 0, 1900)];
    expect(mergeCandidates(routes, scored, target).map((c) => c.route.id)).toEqual([42, 9, 4]);
  });

  it("carries the score and the gap through for the row to show", () => {
    const [first] = mergeCandidates([route({ id: 42 })], [score(42, 0.157, 190)], target);
    expect(first?.similarity).toBe(0.157);
    expect(first?.metresAway).toBe(190);
  });

  it("never offers the route being merged into", () => {
    expect(mergeCandidates([route({ id: 31 })], [score(31, 1, 0)], target)).toEqual([]);
  });

  it("never offers another activity's type, which the clusterer keeps apart", () => {
    const walk = route({ id: 7, activityType: "walking" });
    expect(mergeCandidates([walk], [score(7, 0.9, 10)], target)).toEqual([]);
  });

  it("drops a score for a route the list has not got, rather than a row with no map", () => {
    expect(mergeCandidates([], [score(99, 0.5, 10)], target)).toEqual([]);
  });
});

describe("splitOptions", () => {
  it("lists the attempts newest first", () => {
    const options = splitOptions(
      [attempt({ activityId: "old", day: "2024-01-18" }), attempt({ activityId: "new" })],
      today,
    );
    expect(options.map((o) => o.id)).toEqual(["new", "old"]);
    expect(options[0]?.detail).toBe("Sep 15 · 41:40");
  });

  it("names an untitled attempt rather than leaving the row blank", () => {
    expect(splitOptions([attempt({ name: null })], today)[0]?.label).toBe("Untitled");
  });
});

describe("splitBlockedReason", () => {
  it("allows a split that leaves something behind", () => {
    expect(splitBlockedReason(2, 5)).toBeNull();
  });

  it("says why splitting every attempt out is refused, before the request is made", () => {
    expect(splitBlockedReason(5, 5)).toContain("Rename it instead");
  });

  it("says nothing at all when nothing is ticked yet", () => {
    expect(splitBlockedReason(0, 5)).toBeNull();
  });
});

describe("toggle", () => {
  it("ticks and unticks without touching the set it was given", () => {
    const first = new Set(["a"]);
    const second = toggle(first, "b");
    expect([...second]).toEqual(["a", "b"]);
    expect([...toggle(second, "a")]).toEqual(["b"]);
    expect([...first]).toEqual(["a"]);
  });
});

describe("pickLabel", () => {
  it("counts once something is ticked, and stays a plain verb until then", () => {
    expect(pickLabel("Merge", 0)).toBe("Merge");
    expect(pickLabel("Split", 2)).toBe("Split 2");
  });
});
