import { describe, expect, it } from "vitest";
import { frameLayout } from "@/features/activity/export/exportLayout";
import { EXPORT_CROPS, EXPORT_QUALITIES, exportSize } from "@/features/activity/export/exportPlan";

describe("frameLayout", () => {
  it("keeps the readout and the credit inside the frame for every crop and quality", () => {
    for (const crop of EXPORT_CROPS) {
      for (const quality of EXPORT_QUALITIES) {
        const size = exportSize(crop, quality);
        const layout = frameLayout(size, crop);
        expect(layout.readout.x).toBeGreaterThanOrEqual(0);
        expect(layout.readout.x + layout.readout.w).toBeLessThanOrEqual(size.width);
        expect(layout.readout.y).toBeGreaterThan(0);
        expect(layout.readout.y + layout.readout.h).toBeLessThan(size.height);
        expect(layout.credit.baseline).toBeLessThanOrEqual(size.height);
        expect(layout.credit.right).toBeLessThanOrEqual(size.width);
      }
    }
  });

  it("scales with the short side, so HD and 2K look the same", () => {
    const hd = frameLayout(exportSize("vertical", "hd"), "vertical");
    const k2 = frameLayout(exportSize("vertical", "2k"), "vertical");
    expect(k2.unit / hd.unit).toBeCloseTo(1440 / 1080, 6);
    expect(k2.readout.h / hd.readout.h).toBeCloseTo(1440 / 1080, 6);
  });

  it("keeps a vertical frame's readout clear of the bottom strip Reels cover", () => {
    const size = exportSize("vertical", "hd");
    const layout = frameLayout(size, "vertical");
    // Its bottom edge is above the lowest 22% of the picture.
    expect(layout.readout.y + layout.readout.h).toBeLessThanOrEqual(size.height * 0.78 + 0.001);
    // And the credit sits under it, still in the clear.
    expect(layout.credit.baseline).toBeLessThan(size.height);
  });

  it("puts the readout near the bottom of a horizontal or square frame", () => {
    for (const crop of ["horizontal", "square"] as const) {
      const size = exportSize(crop, "hd");
      const layout = frameLayout(size, crop);
      expect(layout.readout.y + layout.readout.h).toBeGreaterThan(size.height * 0.85);
    }
  });
});
