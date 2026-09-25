import { describe, expect, it } from "vitest";
import type { ActivityStreams } from "@/api/adapters";
import {
  buildCompareChartOption,
  compareKind,
  compareSeriesData,
  compareXAxis,
  compareTooltip,
  compareYValues,
  type CompareSeries,
} from "@/charts/compareChart/buildCompareChartOption";
import { colorTokens } from "@/design/tokens";
import { metrics } from "@/lib/metrics";

const tokens = colorTokens.light;

function streams(overrides: Partial<ActivityStreams> = {}): ActivityStreams {
  const empty = [null, null, null];
  return {
    length: 3,
    elapsedS: [0, 60, 120],
    distanceM: [0, 200, 400],
    hr: [120, 140, 150],
    speedMps: [3, 3.2, 3.4],
    smoothSpeedMps: [3, 3.2, 3.4],
    paceSPerKm: [333, 312, 294],
    cadenceSpm: empty,
    altitudeM: empty,
    gradientPct: empty,
    lat: empty,
    lon: empty,
    ...overrides,
  };
}

function series(overrides: Partial<CompareSeries> = {}): CompareSeries {
  return {
    id: "a",
    label: "Sep 22",
    color: tokens.series[0],
    streams: streams(),
    kind: "run",
    ...overrides,
  };
}

const two = [series(), series({ id: "b", label: "Sep 23", color: tokens.series[1] })];

describe("compareXAxis", () => {
  it("plots against distance when every activity recorded it", () => {
    const axis = compareXAxis(two);
    expect(axis.unit).toBe("km");
    expect(axis.max).toBeCloseTo(0.4, 5);
    expect(axis.grid[0]).toBe(0);
    expect(axis.grid[axis.grid.length - 1]).toBeCloseTo(0.4, 5);
  });

  it("falls back to elapsed time for everyone as soon as one has no distance", () => {
    const indoor = series({ id: "c", streams: streams({ distanceM: [null, null, null] }) });
    const axis = compareXAxis([...two, indoor]);
    expect(axis.unit).toBe("min");
    expect(axis.max).toBeCloseTo(2, 5);
  });

  it("gives every activity the same grid, so a crosshair names all of them", () => {
    const axis = compareXAxis(two);
    const data = two.map((item) => compareSeriesData(item, metrics.hr, "run", axis));
    expect(data[0]).toHaveLength(axis.grid.length);
    expect(data[1]).toHaveLength(axis.grid.length);
  });

  it("reads a shorter activity as null past its end, rather than extending it", () => {
    const longer = series({ id: "c", streams: streams({ distanceM: [0, 500, 1500] }) });
    const axis = compareXAxis([...two, longer]);
    const shorter = compareSeriesData(two[0] as CompareSeries, metrics.hr, "run", axis);
    expect(shorter[shorter.length - 1]).toBeNull();
    expect(shorter[0]).toBe(120);
  });

  it("spans the longest activity, so a shorter one simply stops earlier", () => {
    const longer = series({ id: "c", streams: streams({ distanceM: [0, 500, 1500] }) });
    expect(compareXAxis([...two, longer]).max).toBeCloseTo(1.5, 5);
  });
});

describe("compareKind", () => {
  it("takes the first activity's sport, because one axis carries one unit", () => {
    expect(compareKind([series({ kind: "ride" }), series()])).toBe("ride");
  });

  it("falls back to neutral with nothing to compare", () => {
    expect(compareKind([])).toBe("other");
  });
});

describe("compareYValues", () => {
  it("pools every activity's values, so one y-scale fits them all", () => {
    expect(compareYValues(two, metrics.hr, "run")).toEqual([120, 140, 150, 120, 140, 150]);
  });
});

describe("buildCompareChartOption", () => {
  it("draws one line per activity, in the colour it was given", () => {
    const option = buildCompareChartOption({ series: two, metric: metrics.hr, tokens });
    expect(option.series).toHaveLength(2);
    const [first, second] = option.series as [{ color: string }, { color: string }];
    expect([first.color, second.color]).toEqual([tokens.series[0], tokens.series[1]]);
  });

  it("gives every line the same x-axis", () => {
    const longer = series({ id: "c", streams: streams({ distanceM: [0, 500, 1500] }) });
    const option = buildCompareChartOption({
      series: [...two, longer],
      metric: metrics.hr,
      tokens,
    });
    expect(option.xAxis).toMatchObject({ min: 0, max: 1.5 });
  });

  it("labels the x-axis only when asked, so stacked charts label it once", () => {
    const option = buildCompareChartOption({
      series: two,
      metric: metrics.hr,
      tokens,
      showXAxisLabels: false,
    });
    expect(option.xAxis).toMatchObject({ axisLabel: { show: false } });
  });
});

describe("compareTooltip", () => {
  it("names each activity and its value at the crosshair", () => {
    const params = [
      { seriesName: "Sep 22", value: [0.2, 140] },
      { seriesName: "Sep 23", value: [0.2, 151] },
    ];
    expect(compareTooltip(params, metrics.hr, "run")).toBe("Sep 22 140 bpm<br>Sep 23 151 bpm");
  });

  it("shows a dash where an activity has no value there", () => {
    expect(compareTooltip([{ seriesName: "Sep 22", value: [0.2, null] }], metrics.hr, "run")).toBe(
      "Sep 22 –",
    );
  });
});
