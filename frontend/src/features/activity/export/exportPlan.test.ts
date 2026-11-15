import { describe, expect, it } from "vitest";
import {
  CROP_LABELS,
  END_HOLD_S,
  EXPORT_CROPS,
  EXPORT_FPS,
  EXPORT_QUALITIES,
  exportBitrate,
  exportFileName,
  exportFrames,
  exportSize,
  lengthsFor,
  speedForLength,
} from "@/features/activity/export/exportPlan";

describe("exportSize", () => {
  it("is 1080 on the short side at HD and 1440 at 2K", () => {
    expect(exportSize("vertical", "hd")).toEqual({ width: 1080, height: 1920 });
    expect(exportSize("square", "hd")).toEqual({ width: 1080, height: 1080 });
    expect(exportSize("horizontal", "hd")).toEqual({ width: 1920, height: 1080 });
    expect(exportSize("vertical", "2k")).toEqual({ width: 1440, height: 2560 });
    expect(exportSize("horizontal", "2k")).toEqual({ width: 2560, height: 1440 });
  });

  it("gives a fast draft at the same shapes", () => {
    expect(exportSize("vertical", "draft")).toEqual({ width: 540, height: 960 });
    expect(exportSize("horizontal", "draft")).toEqual({ width: 960, height: 540 });
  });

  it("always has even sides, which video encoders need", () => {
    for (const crop of EXPORT_CROPS) {
      for (const quality of EXPORT_QUALITIES) {
        const { width, height } = exportSize(crop, quality);
        expect(width % 2).toBe(0);
        expect(height % 2).toBe(0);
      }
    }
  });

  it("has a label for every crop", () => {
    for (const crop of EXPORT_CROPS) expect(CROP_LABELS[crop].title).not.toBe("");
  });
});

describe("exportBitrate", () => {
  it("grows with the picture, to a few megabits at HD and more at 2K", () => {
    const hd = exportBitrate(exportSize("vertical", "hd"));
    const k2 = exportBitrate(exportSize("vertical", "2k"));
    expect(hd).toBeGreaterThan(5_000_000);
    expect(hd).toBeLessThan(12_000_000);
    expect(k2).toBeGreaterThan(hd);
  });
});

describe("exportFrames", () => {
  // A 2 hour ride at 100x: 72 seconds of flying, then the closing card.
  const frames = exportFrames(7200, 100);

  it("lasts the flyover plus the closing card, at 24 frames a second", () => {
    expect(frames.fps).toBe(EXPORT_FPS);
    expect(EXPORT_FPS).toBe(24);
    expect(frames.videoS).toBeCloseTo(72 + END_HOLD_S, 1);
    expect(frames.count).toBe(Math.ceil((72 + END_HOLD_S) * 24));
  });

  it("starts at the start of the activity and reaches the end, then holds it", () => {
    expect(frames.at(0).activityS).toBe(0);
    expect(frames.at(24).activityS).toBeCloseTo(100, 6);
    expect(frames.at(frames.count - 1).activityS).toBe(7200);
  });

  it("shows the title card at the start and fades it out", () => {
    expect(frames.at(0).titleAlpha).toBe(0);
    expect(frames.at(24).titleAlpha).toBe(1);
    expect(frames.at(Math.round(3.5 * 24)).titleAlpha).toBe(0);
    expect(frames.at(Math.round(2.4 * 24)).titleAlpha).toBeGreaterThan(0);
    expect(frames.at(Math.round(2.4 * 24)).titleAlpha).toBeLessThan(1);
  });

  it("shows the closing card only at the end", () => {
    expect(frames.at(24).endAlpha).toBe(0);
    expect(frames.at(frames.count - 1).endAlpha).toBe(1);
  });

  it("makes a single frame for a zero-length activity rather than none", () => {
    expect(exportFrames(0, 100).count).toBeGreaterThanOrEqual(1);
  });
});

describe("exportFileName", () => {
  it("makes a safe file name from the activity and the crop", () => {
    expect(exportFileName("Doha Cycling", "2026-11-13", "vertical")).toBe(
      "Doha Cycling 2026-11-13 vertical.mp4",
    );
    expect(exportFileName('A/B: "C"?', "2026-11-13", "square")).toBe("A B C 2026-11-13 square.mp4");
    expect(exportFileName("  ", "2026-11-13", "horizontal")).toBe(
      "Activity 2026-11-13 horizontal.mp4",
    );
  });
});

describe("speedForLength", () => {
  it("picks the speed that makes the video as long as asked, closing card included", () => {
    const speed = speedForLength(7200, 60);
    const frames = exportFrames(7200, speed);
    expect(frames.videoS).toBeCloseTo(60, 0);
  });

  it("is never slower than real time", () => {
    expect(speedForLength(20, 90)).toBe(1);
  });

  it("offers only the lengths a short activity can fill", () => {
    expect(lengthsFor(7200)).toEqual([30, 45, 60, 90]);
    expect(lengthsFor(70)).toEqual([30, 45, 60]);
    expect(lengthsFor(1)).toEqual([30]);
  });

  it("a 2 hour ride in a minute is about 126 times real time and about 1,440 frames", () => {
    const speed = speedForLength(7200, 60);
    expect(speed).toBeCloseTo(125.2, 0);
    expect(exportFrames(7200, speed).count).toBe(1440);
  });
});
