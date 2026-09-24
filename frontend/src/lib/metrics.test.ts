import { describe, expect, it } from "vitest";
import type { ActivityStreams } from "@/api/adapters";
import type { ActivityKind } from "@/lib/activityKind";
import { formatSportSpeed } from "@/lib/format";
import { metricLabel, metrics, paceScale } from "@/lib/metrics";

const KINDS: readonly ActivityKind[] = ["run", "ride", "swim", "walk", "strength", "other"];

/** Four samples at one steady speed, which is all the pace scales read. */
function streamsAt(mps: number): ActivityStreams {
  const indices = [0, 1, 2, 3];
  const column = <T>(value: T) => indices.map(() => value);
  return {
    length: indices.length,
    elapsedS: indices.map((i) => i * 10),
    distanceM: indices.map((i) => i * mps * 10),
    hr: column(140),
    speedMps: column(mps),
    smoothSpeedMps: column(mps),
    paceSPerKm: column(1000 / mps),
    cadenceSpm: column(null),
    altitudeM: column(100),
    gradientPct: column(null),
    lat: column(null),
    lon: column(null),
  };
}

describe("paceScale", () => {
  // The unit is chosen twice from the sport — here and in formatSportSpeed — so that
  // format.ts stays free of the metric definitions. This fails if the two ever disagree,
  // which is how a ride's chart came to read s/km while its stat card read km/h (T18).
  it("plots a speed in the same unit the stat card shows, for every sport", () => {
    const mps = 3;
    const streams = streamsAt(mps);
    for (const kind of KINDS) {
      const scale = paceScale(kind);
      const plotted = scale.values(streams)[0];
      if (plotted === null || plotted === undefined) throw new Error(`no value for ${kind}`);
      expect(scale.format(plotted)).toBe(formatSportSpeed(mps, kind));
    }
  });

  it("puts faster at the top whichever unit it is in", () => {
    // Time per distance counts down as you speed up, so those axes are inverted; km/h is not.
    expect(paceScale("run").invert).toBe(true);
    expect(paceScale("swim").invert).toBe(true);
    expect(paceScale("ride").invert).toBe(false);
  });
});

describe("metricLabel", () => {
  it("calls the speed metric Speed on a bike and Pace on foot and in water", () => {
    expect(metricLabel(metrics.pace, "ride")).toBe("Speed");
    expect(metricLabel(metrics.pace, "run")).toBe("Pace");
    expect(metricLabel(metrics.pace, "swim")).toBe("Pace");
  });

  it("leaves the other metrics' names alone", () => {
    expect(metricLabel(metrics.hr, "ride")).toBe(metrics.hr.label);
    expect(metricLabel(metrics.elevation, "swim")).toBe(metrics.elevation.label);
  });
});
