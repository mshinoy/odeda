import { describe, expect, it } from "vitest";
import type { RacePacing } from "@/api/queries/usePlan";
import { pacingRows, pacingText, parseTarget } from "@/features/race/pacingView";

function plan(over: Partial<RacePacing> = {}): RacePacing {
  const splits = Array.from({ length: 21 }, (_, i) => ({
    km: i + 1,
    distance_m: 1000,
    split_s: 595,
    cum_s: 595 * (i + 1),
    pace_s_per_km: 595,
    end_m: 1000 * (i + 1),
  }));
  splits.push({
    km: 22,
    distance_m: 97.5,
    split_s: 58,
    cum_s: 12553,
    pace_s_per_km: 595,
    end_m: 21097.5,
  });
  return {
    race: {
      name: "Doha Half",
      date: "2027-01-15",
      start_local: "07:35",
      timezone: "Asia/Qatar",
      distance_m: 21097.5,
    },
    target_s: 12553,
    strategy: "even",
    presets: [],
    course: {
      source: "gpx",
      length_m: 21022,
      turns: [
        { km: 4.9, kind: "turn" },
        { km: 10.6, kind: "turnaround" },
      ],
    },
    splits,
    ...over,
  };
}

describe("pacingRows", () => {
  const rows = pacingRows(plan());

  it("is a row a kilometre, the last one the partial 21.1", () => {
    expect(rows).toHaveLength(22);
    expect(rows[0]?.km).toBe("1");
    expect(rows[21]?.km).toBe("21.1");
  });

  it("reads each split, the running total and the pace", () => {
    expect(rows[0]?.split).toBe("9:55");
    expect(rows[1]?.total).toBe("19:50");
    expect(rows[0]?.pace).toBe("9:55");
  });

  it("puts a turn on the kilometre it falls in", () => {
    expect(rows[4]?.note).toBe("Turn at 4.9 km"); // 4.9 km is inside kilometre 5
    expect(rows[10]?.note).toBe("U-turn at 10.6 km"); // and 10.6 is inside kilometre 11
  });

  it("marks the start, the round numbers and the finish", () => {
    expect(rows[0]?.note).toBe("Start: hold back a little");
    expect(rows[9]?.note).toBe("10 km");
    expect(rows[14]?.note).toBe("15 km");
    expect(rows[21]?.note).toBe("Finish");
  });

  it("has no note on an ordinary kilometre", () => {
    expect(rows[2]?.note).toBeNull();
  });

  it("is just the splits and the marks when there is no course", () => {
    const bare = pacingRows(plan({ course: { source: "none", length_m: null, turns: [] } }));
    expect(bare[4]?.note).toBeNull();
    expect(bare[9]?.note).toBe("10 km");
  });

  it("joins a mark and a turn that share a kilometre", () => {
    const joined = pacingRows(
      plan({ course: { source: "gpx", length_m: 1, turns: [{ km: 9.7, kind: "turn" }] } }),
    );
    expect(joined[9]?.note).toBe("Turn at 9.7 km · 10 km");
  });
});

describe("parseTarget", () => {
  it("reads hours, minutes and seconds", () => {
    expect(parseTarget("3:30:00")).toBe(12600);
    expect(parseTarget("3:29:47")).toBe(12587);
  });
  it("reads h:mm as hours and minutes", () => {
    expect(parseTarget("3:30")).toBe(12600);
  });
  it("refuses what is not a time, or not a half marathon", () => {
    expect(parseTarget("")).toBeNull();
    expect(parseTarget("abc")).toBeNull();
    expect(parseTarget("3:75")).toBeNull();
    expect(parseTarget("0:10:00")).toBeNull();
    expect(parseTarget("20:00:00")).toBeNull();
  });
});

describe("pacingText", () => {
  it("is a heading and a line a kilometre, with the notes", () => {
    const lines = pacingText(plan()).split("\n");
    expect(lines[0]).toBe("Doha Half, 2027-01-15, target 3:29:13");
    expect(lines).toHaveLength(24);
    expect(lines[2]).toContain("Start: hold back a little");
  });
});
