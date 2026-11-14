import { describe, expect, it } from "vitest";
import {
  heartRateZone,
  readoutAt,
  readoutLabels,
  readoutSeries,
} from "@/features/activity/readout";

/** A recording one sample a second, with a value per sample for each stream. */
function recording(
  length: number,
  speed: (i: number) => number | null,
  hr: (i: number) => number | null = () => 130,
) {
  const indices = Array.from({ length }, (_, i) => i);
  return {
    elapsedS: indices,
    distanceM: indices.map((i) => i * 5),
    speedMps: indices.map(speed),
    hr: indices.map(hr),
  };
}

describe("distance", () => {
  it("climbs smoothly between samples", () => {
    const series = readoutSeries({
      elapsedS: [0, 10, 20],
      distanceM: [0, 100, 250],
      speedMps: [5, 5, 5],
      hr: [100, 100, 100],
    });
    expect(readoutAt(series, 5, 100).distanceM).toBeCloseTo(50, 9);
    expect(readoutAt(series, 15, 100).distanceM).toBeCloseTo(175, 9);
  });

  it("holds the ends before the start and after the finish", () => {
    const series = readoutSeries(recording(20, () => 5));
    expect(readoutAt(series, -10, 100).distanceM).toBe(0);
    expect(readoutAt(series, 999, 100).distanceM).toBe(95);
  });
});

describe("smoothing over screen time", () => {
  // Alternating 5 and 7 m/s, and heart rate alternating 120 and 140.
  const jittery = readoutSeries(
    recording(
      800,
      (i) => (i % 2 === 0 ? 5 : 7),
      (i) => (i % 2 === 0 ? 120 : 140),
    ),
  );

  it("settles at a fast replay: two seconds on screen is minutes of the ride", () => {
    for (const seconds of [250, 300, 333, 400, 500]) {
      const readout = readoutAt(jittery, seconds, 100);
      expect(readout.speedMps).toBeGreaterThan(5.95);
      expect(readout.speedMps).toBeLessThan(6.05);
      expect(readout.hr).toBeGreaterThan(129);
      expect(readout.hr).toBeLessThan(131);
    }
  });

  it("averages over more of the ride at a faster replay", () => {
    const readings = (replaySpeed: number) =>
      [300, 301, 302, 303].map((seconds) => readoutAt(jittery, seconds, replaySpeed).speedMps ?? 0);
    const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(spread(readings(1))).toBeGreaterThan(spread(readings(200)));
  });

  it("follows a real change in speed, only a little late", () => {
    const climb = readoutSeries(recording(800, (i) => (i < 400 ? 8 : 4)));
    expect(readoutAt(climb, 100, 100).speedMps).toBeCloseTo(8, 1);
    expect(readoutAt(climb, 700, 100).speedMps).toBeCloseTo(4, 1);
    const across = readoutAt(climb, 400, 100).speedMps ?? 0;
    expect(across).toBeGreaterThan(5.5);
    expect(across).toBeLessThan(6.5);
  });
});

describe("stops and missing readings", () => {
  it("counts a recorded zero, so a stop pulls the average down", () => {
    const series = readoutSeries(recording(400, (i) => (i < 200 ? 10 : 0)));
    const across = readoutAt(series, 200, 100).speedMps ?? 0;
    expect(across).toBeGreaterThan(4);
    expect(across).toBeLessThan(6);
  });

  it("reads Stopped when it has been standing still the whole window", () => {
    const series = readoutSeries(recording(400, () => 0));
    const readout = readoutAt(series, 200, 100);
    expect(readout.speedMps).toBeNull();
    expect(readoutLabels("ride", readout).speed.value).toBe("Stopped");
  });

  it("leaves out samples with no reading at all, rather than counting them as zero", () => {
    const series = readoutSeries(recording(400, (i) => (i % 2 === 0 ? null : 10)));
    expect(readoutAt(series, 200, 100).speedMps).toBeCloseTo(10, 9);
  });
});

describe("a tunnel is not a stop", () => {
  // Recorded speed up to 10 s, then no GPS and no speed until 110 s.
  const underground = readoutSeries(
    {
      elapsedS: [0, 10, 20, 110, 120],
      distanceM: [0, 100, 105, 110, 230],
      speedMps: [10, 10, null, null, 10],
      hr: [130, 130, 130, 130, 130],
    },
    [{ startS: 10, endS: 110, speedMps: 12, road: null }],
  );

  it("reads the average through the tunnel, flagged as an estimate, not zero", () => {
    const inside = readoutAt(underground, 60, 100);
    expect(inside.speedMps).toBe(12);
    expect(inside.estimated).toBe(true);
    expect(readoutLabels("ride", inside).speed.value).toBe("≈ 43 km/h");
    expect(readoutLabels("run", { ...inside, speedMps: 3 }).speed.value).toBe("≈ 5:33 /km");
  });

  it("goes back to the recorded speed on either side", () => {
    expect(readoutAt(underground, 5, 100).estimated).toBe(false);
    expect(readoutAt(underground, 115, 100).estimated).toBe(false);
  });
});

describe("heartRateZone", () => {
  // Resting 50, max 190: a reserve of 140, so zone 2 tops out at 50 + 0.7 * 140 = 148.
  it("uses heart-rate reserve, with zone 2 ending at 70%", () => {
    expect(heartRateZone(120, 50, 190)).toBe(1);
    expect(heartRateZone(140, 50, 190)).toBe(2);
    expect(heartRateZone(150, 50, 190)).toBe(3);
    expect(heartRateZone(165, 50, 190)).toBe(4);
    expect(heartRateZone(185, 50, 190)).toBe(5);
  });

  it("has no zone without a reading or without the athlete's rest and max", () => {
    expect(heartRateZone(null, 50, 190)).toBeNull();
    expect(heartRateZone(140, null, 190)).toBeNull();
    expect(heartRateZone(140, 50, undefined)).toBeNull();
    expect(heartRateZone(140, 190, 50)).toBeNull();
  });
});

describe("readoutLabels", () => {
  const moving = { distanceM: 12_345, speedMps: 6, hr: 141.4, estimated: false };

  it("reads speed in whole kilometres an hour on a ride and pace on a run", () => {
    expect(readoutLabels("ride", moving).speed).toEqual({ label: "Speed", value: "22 km/h" });
    expect(readoutLabels("run", moving).speed).toEqual({ label: "Pace", value: "2:47 /km" });
  });

  it("says stopped rather than a pace of infinity while standing still", () => {
    expect(readoutLabels("run", { ...moving, speedMps: null }).speed.value).toBe("Stopped");
    expect(readoutLabels("ride", { ...moving, speedMps: null }).speed.value).toBe("Stopped");
  });

  it("writes the distance and heart rate the way the rest of the app does", () => {
    const labels = readoutLabels("ride", moving);
    expect(labels.distance).toBe("12.3 km");
    expect(labels.heartRate).toBe("141 bpm");
  });
});
