// Where things go on an exported frame, as numbers, so the rules are testable. Everything
// scales with the short side (1080 is one unit), and a vertical frame keeps its readout
// clear of the strips Reels and Stories draw their own buttons and captions in.
import type { ExportCrop, ExportSize } from "@/features/activity/export/exportPlan";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameLayout {
  /** Pixels per design unit: the short side over 1080. */
  unit: number;
  margin: number;
  readout: Rect;
  /** Where the credit line sits: its right edge and baseline. */
  credit: { right: number; baseline: number };
  /** The vertical middle of the opening title. */
  titleY: number;
  /** The top of the closing card's figures. */
  endStatsY: number;
}

/** Instagram's own interface covers about this much of the top and bottom of a 9:16 frame. */
const VERTICAL_SAFE_TOP = 0.12;
const VERTICAL_SAFE_BOTTOM = 0.22;

export function frameLayout(size: ExportSize, crop: ExportCrop): FrameLayout {
  const { width, height } = size;
  const unit = Math.min(width, height) / 1080;
  const margin = 48 * unit;
  const vertical = crop === "vertical";

  const bottomClear = vertical ? height * VERTICAL_SAFE_BOTTOM : 56 * unit;
  const readoutH = 150 * unit;
  const readoutW = Math.min(width - 2 * margin, 900 * unit);
  const readout: Rect = {
    x: (width - readoutW) / 2,
    y: height - bottomClear - readoutH,
    w: readoutW,
    h: readoutH,
  };

  // The credit goes right under the readout in a vertical frame, where the corners are taken.
  const baseline = vertical ? readout.y + readout.h + 36 * unit : height - 22 * unit;
  return {
    unit,
    margin,
    readout,
    credit: { right: width - margin, baseline },
    titleY: vertical ? height * (VERTICAL_SAFE_TOP + 0.08) : height * 0.3,
    endStatsY: height * (vertical ? 0.5 : 0.52),
  };
}
