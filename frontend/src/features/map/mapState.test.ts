import { describe, expect, it } from "vitest";
import {
  hasFilters,
  NO_FILTERS,
  parseMapState,
  serializeMapState,
  toHeatmapParams,
  type MapState,
} from "@/features/map/mapState";

function parse(search: string): MapState {
  return parseMapState(new URLSearchParams(search));
}

describe("parseMapState", () => {
  it("defaults to every activity ever recorded", () => {
    expect(parse("")).toEqual(NO_FILTERS);
  });

  it("reads the type and both bounds", () => {
    expect(parse("type=running&start=2025-01-01&end=2025-12-31")).toEqual({
      type: "running",
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });

  it("ignores a date that is not a day", () => {
    expect(parse("start=yesterday&end=2025-13")).toEqual(NO_FILTERS);
  });

  it("treats an empty type as no filter", () => {
    expect(parse("type=").type).toBeNull();
  });
});

describe("serializeMapState", () => {
  it("leaves the defaults out", () => {
    expect(serializeMapState(NO_FILTERS).toString()).toBe("");
  });

  it("round-trips a filtered state", () => {
    const state: MapState = { type: "cycling", start: "2024-06-01", end: null };
    expect(parseMapState(serializeMapState(state))).toEqual(state);
  });
});

describe("toHeatmapParams", () => {
  it("sends nothing at all when nothing is filtered", () => {
    expect(toHeatmapParams(NO_FILTERS)).toEqual({});
  });

  it("sends only the filters that are set", () => {
    expect(toHeatmapParams({ type: "running", start: null, end: "2025-12-31" })).toEqual({
      type: "running",
      end: "2025-12-31",
    });
  });
});

describe("hasFilters", () => {
  it("is false only for the default state", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, type: "running" })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, start: "2025-01-01" })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, end: "2025-01-01" })).toBe(true);
  });
});
