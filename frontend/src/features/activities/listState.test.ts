import { describe, expect, it } from "vitest";
import {
  clearFilters,
  hasFilters,
  pageCount,
  parseListState,
  serializeListState,
  toApiParams,
  toggleSort,
  withFilters,
  type ListState,
} from "@/features/activities/listState";

const range = { start: "2026-08-26", end: "2026-09-24" };

const defaults: ListState = {
  type: null,
  start: "2026-08-26",
  end: "2026-09-24",
  q: "",
  race: false,
  sort: "date",
  order: "desc",
  page: 1,
};

function parse(query: string): ListState {
  return parseListState(new URLSearchParams(query), range);
}

describe("parseListState", () => {
  it("defaults to the store's time range, newest first, page 1", () => {
    expect(parse("")).toEqual(defaults);
  });

  it("reads every parameter", () => {
    expect(
      parse(
        "type=running&start=2026-01-01&end=2026-03-31&q=tempo&race=1&sort=distance&order=asc&page=3",
      ),
    ).toEqual({
      type: "running",
      start: "2026-01-01",
      end: "2026-03-31",
      q: "tempo",
      race: true,
      sort: "distance",
      order: "asc",
      page: 3,
    });
  });

  it("reads an empty date as no bound", () => {
    expect(parse("start=&end=")).toMatchObject({ start: null, end: null });
    expect(parse("start=")).toMatchObject({ start: null, end: range.end });
  });

  it("gives each sort column its own first order when the URL has none", () => {
    expect(parse("sort=pace").order).toBe("asc");
    expect(parse("sort=type").order).toBe("asc");
    expect(parse("sort=hr").order).toBe("desc");
  });

  it("falls back to defaults for anything unreadable", () => {
    expect(parse("type=&start=yesterday&end=2026-9-1&sort=name&order=up&page=0")).toEqual(defaults);
    expect(parse("page=2.5").page).toBe(1);
    expect(parse("page=-1").page).toBe(1);
  });

  it("trims the search", () => {
    expect(parse("q=%20%20tempo%20").q).toBe("tempo");
  });
});

describe("serializeListState", () => {
  it("leaves every default out", () => {
    expect(serializeListState(defaults, range).toString()).toBe("");
  });

  it("writes what differs from the defaults", () => {
    const state: ListState = {
      type: "strength_training",
      start: "2026-01-01",
      end: range.end,
      q: "legs",
      race: false,
      sort: "pace",
      order: "desc",
      page: 2,
    };
    expect(serializeListState(state, range).toString()).toBe(
      "type=strength_training&start=2026-01-01&q=legs&sort=pace&order=desc&page=2",
    );
  });

  it("writes an open bound as an empty value, so it differs from 'the default range'", () => {
    const all = { ...defaults, start: null, end: null };
    expect(serializeListState(all, range).toString()).toBe("start=&end=");
  });

  it("round-trips through parseListState", () => {
    const states: ListState[] = [
      defaults,
      { ...defaults, start: null, end: null, q: "long run", sort: "time", order: "asc" },
      { ...defaults, type: "cycling", start: "2025-01-01", sort: "pace", order: "asc", page: 4 },
    ];
    for (const state of states) {
      expect(parseListState(serializeListState(state, range), range)).toEqual(state);
    }
  });
});

describe("toApiParams", () => {
  it("maps columns to API fields and pages to offsets, leaving absent filters out", () => {
    expect(toApiParams({ ...defaults, start: null, end: null, page: 3 })).toEqual({
      limit: 50,
      offset: 100,
      sort: "day",
      order: "desc",
    });
  });

  it("passes every filter", () => {
    expect(
      toApiParams({ ...defaults, type: "running", q: "tempo", sort: "hr", order: "asc" }),
    ).toEqual({
      limit: 50,
      offset: 0,
      sort: "avg_hr",
      order: "asc",
      type: "running",
      start: "2026-08-26",
      end: "2026-09-24",
      q: "tempo",
    });
  });

  it("sorts pace on speed, flipped: fastest pace first is highest speed first", () => {
    expect(toApiParams({ ...defaults, sort: "pace", order: "asc" })).toMatchObject({
      sort: "avg_speed_mps",
      order: "desc",
    });
    expect(toApiParams({ ...defaults, sort: "pace", order: "desc" })).toMatchObject({
      sort: "avg_speed_mps",
      order: "asc",
    });
  });
});

describe("toggleSort", () => {
  it("flips the order of the current column", () => {
    expect(toggleSort(defaults, "date")).toMatchObject({ sort: "date", order: "asc" });
  });

  it("starts a new column at its first order", () => {
    expect(toggleSort(defaults, "distance")).toMatchObject({ sort: "distance", order: "desc" });
    expect(toggleSort(defaults, "pace")).toMatchObject({ sort: "pace", order: "asc" });
  });

  it("goes back to the first page", () => {
    expect(toggleSort({ ...defaults, page: 5 }, "hr").page).toBe(1);
  });
});

describe("filters", () => {
  it("withFilters applies the patch and goes back to the first page", () => {
    expect(withFilters({ ...defaults, page: 4 }, { type: "walking" })).toEqual({
      ...defaults,
      type: "walking",
    });
  });

  it("clearFilters removes every filter, including the date range, and keeps the sort", () => {
    const state = { ...defaults, type: "running", q: "x", sort: "pace" as const, page: 2 };
    expect(clearFilters(state)).toEqual({
      ...defaults,
      start: null,
      end: null,
      sort: "pace",
    });
  });

  it("hasFilters counts the default date range as a filter", () => {
    expect(hasFilters(defaults)).toBe(true);
    expect(hasFilters(clearFilters(defaults))).toBe(false);
    expect(hasFilters({ ...clearFilters(defaults), q: "tempo" })).toBe(true);
  });
});

describe("pageCount", () => {
  it("rounds up and never goes below one page", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(50)).toBe(1);
    expect(pageCount(51)).toBe(2);
    expect(pageCount(488)).toBe(10);
  });
});

describe("the races filter", () => {
  it("round-trips through the URL", () => {
    const races = withFilters(defaults, { race: true });
    expect(serializeListState(races, range).get("race")).toBe("1");
    expect(parseListState(serializeListState(races, range), range).race).toBe(true);
  });

  it("asks the API for races only, and for nothing when it is off", () => {
    expect(toApiParams(withFilters(defaults, { race: true })).race).toBe(true);
    expect(toApiParams(defaults).race).toBeUndefined();
  });

  it("drops the date bounds when switched on, so it is not empty by default", () => {
    const races = withFilters(defaults, { race: true });
    expect([races.start, races.end]).toEqual([null, null]);
  });

  it("leaves the dates alone when switched off again", () => {
    const dated = { ...defaults, start: "2026-01-01", end: "2026-06-30", race: true };
    expect(withFilters(dated, { race: false })).toMatchObject({
      start: "2026-01-01",
      end: "2026-06-30",
      race: false,
    });
  });

  it("counts as a filter, and Clear filters turns it off", () => {
    const races = withFilters(defaults, { race: true });
    expect(hasFilters(races)).toBe(true);
    expect(clearFilters(races).race).toBe(false);
  });
});
