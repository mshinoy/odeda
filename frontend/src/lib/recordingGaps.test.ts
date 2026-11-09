import { describe, expect, it } from "vitest";
import { isRecordingGap, type GpsSample } from "@/lib/recordingGaps";

const here: GpsSample = { elapsedS: 764, distanceM: 4000, lat: 25.3173, lon: 51.4965 };

describe("isRecordingGap", () => {
  it("is a pause that ended 7 km away, with no distance recorded in between", () => {
    const after = { elapsedS: 2471, distanceM: 4010, lat: 25.2837, lon: 51.559 };
    expect(isRecordingGap(here, after)).toBe(true);
  });

  it("is not a tunnel: the signal went but the distance was still counted", () => {
    const after = { elapsedS: 830, distanceM: 4000 + 1100, lat: 25.3173, lon: 51.5066 };
    expect(isRecordingGap(here, after)).toBe(false);
  });

  it("is not a short pause, however far", () => {
    const after = { elapsedS: 790, distanceM: 4000, lat: 25.3173, lon: 51.5066 };
    expect(isRecordingGap(here, after)).toBe(false);
  });

  it("is not a long pause that ended where it began", () => {
    const after = { elapsedS: 2471, distanceM: 4000, lat: 25.3174, lon: 51.4966 };
    expect(isRecordingGap(here, after)).toBe(false);
  });

  it("is a long pause and a long way when the device recorded no distance at all", () => {
    const after = { elapsedS: 2471, distanceM: null, lat: 25.2837, lon: 51.559 };
    expect(isRecordingGap({ ...here, distanceM: null }, after)).toBe(true);
  });
});
