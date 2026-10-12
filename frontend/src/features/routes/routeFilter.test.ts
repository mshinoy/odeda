import { describe, expect, it } from "vitest";
import type { RouteRowView } from "@/features/routes/routeRowView";
import { filterByKind, kindOptions, parseKind } from "@/features/routes/routeFilter";
import type { ActivityKind } from "@/lib/activityKind";

function row(id: number, kind: ActivityKind): RouteRowView {
  return {
    id,
    href: `/routes/${id}`,
    name: `${id}`,
    kind,
    activityType: kind,
    typeLabel: kind,
    shape: "Loop",
    attempts: "1",
    distance: "1.0 km",
    best: "10:00",
    median: "11:00",
    first: "Jan 1",
    last: "Jan 2",
    polyline: null,
  };
}

/** The owner's own spread: 31 running, 16 walking, 5 cycling, 1 other. */
const rows = [
  ...Array.from({ length: 31 }, (_, i) => row(i, "run")),
  ...Array.from({ length: 16 }, (_, i) => row(100 + i, "walk")),
  ...Array.from({ length: 5 }, (_, i) => row(200 + i, "ride")),
  row(300, "other"),
];

describe("kindOptions", () => {
  it("counts each kind that has routes", () => {
    expect(kindOptions(rows)).toEqual([
      { kind: "run", label: "Run", count: 31 },
      { kind: "ride", label: "Ride", count: 5 },
      { kind: "walk", label: "Walk", count: 16 },
      { kind: "other", label: "Other", count: 1 },
    ]);
  });

  it("leaves out a kind with no routes, rather than offering an empty list", () => {
    expect(kindOptions(rows).map((o) => o.kind)).not.toContain("swim");
    expect(kindOptions(rows).map((o) => o.kind)).not.toContain("strength");
  });

  it("keeps a fixed order, so the buttons do not move after a sync", () => {
    const fewer = kindOptions([row(1, "other"), row(2, "ride"), row(3, "run")]);
    expect(fewer.map((o) => o.kind)).toEqual(["run", "ride", "other"]);
  });

  it("has nothing to offer for no routes", () => {
    expect(kindOptions([])).toEqual([]);
  });
});

describe("filterByKind", () => {
  it("keeps only that kind", () => {
    expect(filterByKind(rows, "ride")).toHaveLength(5);
    expect(filterByKind(rows, "ride").every((r) => r.kind === "ride")).toBe(true);
  });

  it("keeps everything for null", () => {
    expect(filterByKind(rows, null)).toHaveLength(rows.length);
  });
});

describe("parseKind", () => {
  it("reads a kind the app knows", () => {
    expect(parseKind("ride")).toBe("ride");
  });

  it("reads anything else as all, not as an empty list", () => {
    // A hand-typed or stale `?kind=cycling` must not strand the page with no way back.
    expect(parseKind("cycling")).toBeNull();
    expect(parseKind("")).toBeNull();
    expect(parseKind(null)).toBeNull();
  });
});
