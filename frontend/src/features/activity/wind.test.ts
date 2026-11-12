import { describe, expect, it } from "vitest";
import { compass, headwindKmh, windShare, withHeadwind } from "@/features/activity/wind";
import type { ActivityStreams } from "@/api/adapters";

// 0.0005° of latitude is about 55 m, so a few steps are well past the heading span.
const STEP = 0.0005;

/** A path of `n` fixes heading due north from the equator. */
function north(n: number) {
  return {
    length: n,
    lat: Array.from({ length: n }, (_, i) => i * STEP),
    lon: Array.from({ length: n }, () => 0),
  };
}

describe("compass", () => {
  it("names a bearing by the nearest of eight points, wrapping at north", () => {
    expect(compass(0)).toBe("N");
    expect(compass(359)).toBe("N");
    expect(compass(304)).toBe("NW");
    expect(compass(90)).toBe("E");
    expect(compass(-45)).toBe("NW");
  });
});

describe("headwindKmh", () => {
  it("is the whole wind when running into it", () => {
    const values = headwindKmh(north(6), 20, 0);
    expect(values[2]).toBeCloseTo(20, 1);
  });

  it("is negative with the wind behind", () => {
    expect(headwindKmh(north(6), 20, 180)[2]).toBeCloseTo(-20, 1);
  });

  it("is nothing for a wind straight across the path", () => {
    expect(headwindKmh(north(6), 20, 90)[2]).toBeCloseTo(0, 1);
  });

  it("is a diagonal share at forty-five degrees", () => {
    expect(headwindKmh(north(6), 20, 45)[2]).toBeCloseTo(20 * Math.SQRT1_2, 1);
  });

  it("is null without a fix, and where the runner went nowhere", () => {
    const still = { length: 4, lat: [1, 1, 1, 1], lon: [1, 1, 1, 1] };
    expect(headwindKmh(still, 20, 0)).toEqual([null, null, null, null]);
    const none = { length: 2, lat: [null, null], lon: [null, null] };
    expect(headwindKmh(none, 20, 0)).toEqual([null, null]);
  });
});

describe("withHeadwind", () => {
  it("leaves the streams alone when the wind is unknown", () => {
    const streams = { ...north(3) } as unknown as ActivityStreams;
    expect(withHeadwind(streams, null, 90)).toBe(streams);
    expect(withHeadwind(streams, 10, null)).toBe(streams);
  });

  it("adds the column when it is known", () => {
    const streams = { ...north(6) } as unknown as ActivityStreams;
    expect(withHeadwind(streams, 20, 0).headwindKmh?.[2]).toBeCloseTo(20, 1);
  });
});

describe("windShare", () => {
  it("splits the distance into head, tail and side-on", () => {
    const share = windShare([null, 10, 10, -10, 0], [0, 100, 200, 300, 400]);
    expect(share?.head).toBeCloseTo(0.5);
    expect(share?.tail).toBeCloseTo(0.25);
    expect(share?.side).toBeCloseTo(0.25);
  });

  it("is null with no distance", () => {
    expect(windShare([null, null], [0, 0])).toBeNull();
  });
});

describe("the headwind metric's text", () => {
  it("says head or tail, so a legend needs no sign convention", async () => {
    const { metrics } = await import("@/lib/metrics");
    const format = metrics.headwind.formatScaleValue;
    expect(format(19, "run")).toBe("19 km/h head");
    expect(format(-18, "run")).toBe("18 km/h tail");
    expect(format(0.2, "run")).toBe("0 km/h");
  });
});
