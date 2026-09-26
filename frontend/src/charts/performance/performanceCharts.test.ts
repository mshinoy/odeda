import { describe, expect, it } from "vitest";
import type { components } from "@/api/schema";
import type { ChartOption } from "@/charts/echarts";
import {
  buildSessionTrendOption,
  sessionTrendTooltip,
  sessionTrendYScale,
  type SessionPoint,
} from "@/charts/performance/buildSessionTrendOption";
import {
  buildVo2maxOption,
  vo2maxTooltip,
  vo2maxYScale,
} from "@/charts/performance/buildVo2maxOption";
import {
  decouplingPoints,
  efficiencyPoints,
  sessionDetail,
} from "@/charts/performance/performancePoints";
import { colorTokens } from "@/design/tokens";
import { formatPercent, formatSigned } from "@/lib/format";
import { dayToMs } from "@/lib/time";

type DecouplingPoint = components["schemas"]["DecouplingPoint"];
type Vo2maxPoint = components["schemas"]["Vo2maxPoint"];

const tokens = colorTokens.light;
const TODAY = new Date(2026, 8, 25);

function single<T>(value: T | T[] | undefined): T {
  if (value === undefined || Array.isArray(value)) throw new Error("expected exactly one");
  return value;
}

function seriesOf(option: ChartOption) {
  return Array.isArray(option.series) ? option.series : [];
}

/** The scatter series and the trend line behind it, in the order the builder adds them. */
function dotsAndTrend(option: ChartOption) {
  const [dots, trend] = seriesOf(option);
  if (dots?.type !== "scatter") throw new Error("expected a scatter series");
  if (trend?.type !== "line") throw new Error("expected a line series");
  return { dots, trend };
}

/** Calls a y tick formatter the way ECharts does. */
function yTickLabel(option: ChartOption, value: number): string {
  const axis = single(option.yAxis);
  if (axis.type !== "value") throw new Error("expected a value axis");
  const formatter = axis.axisLabel?.formatter;
  if (typeof formatter !== "function") throw new Error("expected a formatter");
  return formatter(value, 0, null);
}

/** One [x, y] pair out of a series' data, without widening either to `any`. */
function pairAt(data: unknown, index: number): [number, number] {
  const pair = Array.isArray(data) ? (data[index] as unknown) : undefined;
  if (!Array.isArray(pair) || typeof pair[0] !== "number" || typeof pair[1] !== "number") {
    throw new Error(`expected a numeric pair at ${index}`);
  }
  return [pair[0], pair[1]];
}

function run(overrides: Partial<DecouplingPoint> = {}): DecouplingPoint {
  return {
    activity_id: "1",
    day: "2026-09-01",
    name: "Doha - Base",
    distance_km: 5.35,
    duration_s: 3149,
    decoupling_pct: 8.2,
    efficiency_factor: 0.81,
    aerobically_durable: false,
    ...overrides,
  };
}

function vo2max(day: string, value: number): Vo2maxPoint {
  return { day, vo2max_run: value };
}

const points: SessionPoint[] = [
  { day: "2026-09-01", value: 8.2, detail: "Doha - Base" },
  { day: "2026-09-10", value: 2.1, detail: "Doha - Long" },
  { day: "2026-09-20", value: -3.4, detail: "Doha - Easy" },
];

const threshold = { value: 5, label: "5%" };

function trendOption(overrides: Partial<Parameters<typeof buildSessionTrendOption>[0]> = {}) {
  return buildSessionTrendOption({
    points,
    tokens,
    formatValue: (value) => formatPercent(value, 1),
    formatTick: (value, isTopTick) => (isTopTick ? formatPercent(value) : formatSigned(value, 0)),
    today: TODAY,
    ...overrides,
  });
}

describe("sessionDetail", () => {
  it("names the run, how far and how long", () => {
    expect(sessionDetail(run())).toBe("Doha - Base · 5.4 km · 52:29");
  });

  it("leaves out what Garmin did not send", () => {
    expect(sessionDetail(run({ name: null, duration_s: null }))).toBe("5.4 km");
  });
});

describe("decouplingPoints", () => {
  it("drops runs whose HR could not measure drift", () => {
    const runs = [run({ day: "2026-09-01" }), run({ day: "2026-09-02", decoupling_pct: null })];
    expect(decouplingPoints(runs).map((point) => point.day)).toEqual(["2026-09-01"]);
  });

  it("keeps a negative drift, which is a real result", () => {
    expect(decouplingPoints([run({ decoupling_pct: -3.4 })])[0]?.value).toBe(-3.4);
  });
});

describe("efficiencyPoints", () => {
  it("borrows the detail line from the run on the same day", () => {
    const trend = [{ day: "2026-09-01", ef: 0.81 }];
    expect(efficiencyPoints(trend, [run()])[0]?.detail).toBe("Doha - Base · 5.4 km · 52:29");
  });

  it("still plots a day with no matching run", () => {
    const trend = [{ day: "2020-01-01", ef: 0.9 }];
    expect(efficiencyPoints(trend, [run()])).toEqual([
      { day: "2020-01-01", value: 0.9, detail: "" },
    ]);
  });
});

describe("sessionTrendYScale", () => {
  it("rounds the bounds outwards to a round step", () => {
    // Span 11.6, padded by 5% each side to [-3.98, 8.78]: the smallest 1/2/5 step that
    // splits 12.76 into at most four intervals is 5, and 5 snaps that out to [-5, 10].
    expect(sessionTrendYScale([-3.4, 8.2])).toEqual({ min: -5, max: 10, step: 5 });
  });

  it("keeps a full season of decoupling off the middle third of the chart", () => {
    // The owner's real range, -33.4 to +31.0: three intervals would only ever land on
    // a step of 50 and squash every session between two gridlines.
    expect(sessionTrendYScale([-33.4, 31.04], 5)).toEqual({ min: -40, max: 40, step: 20 });
  });

  it("widens to hold a threshold outside the data", () => {
    const scale = sessionTrendYScale([1, 2], 20);
    expect(scale?.max).toBeGreaterThanOrEqual(20);
  });

  it("is null with nothing to plot", () => {
    expect(sessionTrendYScale([])).toBeNull();
  });
});

describe("buildSessionTrendOption", () => {
  it("plots one dot per session against its day", () => {
    const { dots } = dotsAndTrend(trendOption());
    expect(dots.data).toEqual([
      [dayToMs("2026-09-01"), 8.2],
      [dayToMs("2026-09-10"), 2.1],
      [dayToMs("2026-09-20"), -3.4],
    ]);
  });

  it("draws the trend as the centred mean of the window", () => {
    // A window of 10 covers all three sessions: (8.2 + 2.1 - 3.4) / 3 = 2.3.
    const { trend } = dotsAndTrend(trendOption());
    for (const [i, day] of ["2026-09-01", "2026-09-10", "2026-09-20"].entries()) {
      const [x, y] = pairAt(trend.data, i);
      expect(x).toBe(dayToMs(day));
      expect(y).toBeCloseTo(2.3, 10);
    }
  });

  it("has no threshold line unless one is asked for", () => {
    expect(dotsAndTrend(trendOption()).trend.markLine).toBeUndefined();
  });

  it("labels the threshold line, because a status colour never travels alone", () => {
    const { markLine } = dotsAndTrend(trendOption({ threshold })).trend;
    expect(markLine?.data).toEqual([{ yAxis: 5 }]);
    expect(single(markLine?.label)?.formatter).toBe("5%");
    expect(markLine?.lineStyle?.color).toBe(tokens.status.warning);
  });

  it("names the session under the value in the tooltip", () => {
    const point = points[0];
    if (point === undefined) throw new Error("expected a point");
    expect(sessionTrendTooltip(point, (value) => formatPercent(value, 1), TODAY)).toBe(
      "Sep 1 · 8.2%<br>Doha - Base",
    );
  });

  it("gives the value alone when nothing names the session", () => {
    const orphan = { day: "2026-09-01", value: 0.9, detail: "" };
    expect(sessionTrendTooltip(orphan, (value) => formatPercent(value, 1), TODAY)).toBe(
      "Sep 1 · 0.9%",
    );
  });

  it("puts the unit on the top tick alone", () => {
    const option = trendOption();
    expect(yTickLabel(option, 10)).toBe("10%");
    expect(yTickLabel(option, 5)).toBe("+5");
  });

  it("survives having nothing to plot", () => {
    expect(dotsAndTrend(trendOption({ points: [] })).dots.data).toEqual([]);
  });
});

describe("vo2maxYScale", () => {
  it("rounds the bounds outwards to a round step", () => {
    // Span 6.6, padded by 10% each side to [40.74, 48.66]: a step of 5 splits 7.92 into
    // at most three intervals, and snaps the bounds out to [40, 50].
    expect(vo2maxYScale([vo2max("2026-01-01", 41.4), vo2max("2026-09-01", 48)])).toEqual({
      min: 40,
      max: 50,
      step: 5,
    });
  });

  it("is null with nothing to plot", () => {
    expect(vo2maxYScale([])).toBeNull();
  });
});

describe("buildVo2maxOption", () => {
  const option = buildVo2maxOption({
    series: [vo2max("2026-09-01", 45.8), vo2max("2026-09-02", 46)],
    tokens,
    today: TODAY,
  });

  it("draws one continuous line, because the estimate holds between runs", () => {
    const [line] = seriesOf(option);
    if (line?.type !== "line") throw new Error("expected a line series");
    expect(line.showSymbol).toBe(false);
    expect(line.data).toEqual([
      [dayToMs("2026-09-01"), 45.8],
      [dayToMs("2026-09-02"), 46],
    ]);
  });

  it("carries the unit in the tooltip, not on every tick", () => {
    expect(vo2maxTooltip(vo2max("2026-09-02", 46), TODAY)).toBe("Sep 2 · 46.0 ml/kg/min");
    expect(yTickLabel(option, 46)).toBe("46");
  });

  it("survives an empty series", () => {
    const empty = buildVo2maxOption({ series: [], tokens });
    expect(seriesOf(empty)[0]?.data).toEqual([]);
  });
});
