// What a video export is made of, kept apart from the rendering so it can be tested: the
// sizes on offer, how many frames the flyover takes, and which frame is which moment.

/** The shape of the picture: for Reels and Stories, for a post, for YouTube. */
export type ExportCrop = "vertical" | "square" | "horizontal";
/** How sharp: a quick draft, HD (1080 on the short side), or 2K (1440). */
export type ExportQuality = "draft" | "hd" | "2k";

export const EXPORT_CROPS: readonly ExportCrop[] = ["vertical", "square", "horizontal"];
export const EXPORT_QUALITIES: readonly ExportQuality[] = ["draft", "hd", "2k"];

export const CROP_LABELS: Record<ExportCrop, { title: string; hint: string }> = {
  vertical: { title: "Vertical 9:16", hint: "Reels and Stories" },
  square: { title: "Square 1:1", hint: "Feed posts" },
  horizontal: { title: "Horizontal 16:9", hint: "YouTube" },
};

export const QUALITY_LABELS: Record<ExportQuality, string> = {
  draft: "Draft (540p, fast)",
  hd: "HD (1080p)",
  "2k": "2K (1440p)",
};

const SHORT_SIDE_PX: Record<ExportQuality, number> = { draft: 540, hd: 1080, "2k": 1440 };

export interface ExportSize {
  width: number;
  height: number;
}

/** Video encoders want even sizes: round to the nearest even number. */
function even(value: number): number {
  return Math.round(value / 2) * 2;
}

/** The picture's size in pixels: the short side by quality, the long side by the crop. */
export function exportSize(crop: ExportCrop, quality: ExportQuality): ExportSize {
  const short = SHORT_SIDE_PX[quality];
  if (crop === "square") return { width: short, height: short };
  const long = even((short * 16) / 9);
  return crop === "vertical" ? { width: short, height: long } : { width: long, height: short };
}

/** 24 frames a second: what film runs at, and plenty for a flyover. Fewer frames to draw. */
export const EXPORT_FPS = 24;

/**
 * How many maps draw frames at once. Drawing a frame is mostly waiting (for tiles, for the
 * screen), so more maps overlap the waits; each holds its own tiles and canvases, so the count
 * falls as the picture grows. About 12 million pixels of map in all. Eight maps were slower than four: they fight over the same page and graphics chip.
 */
const PIXEL_BUDGET = 12_000_000;
const MIN_MAPS = 2;
const MAX_MAPS = 4;

export function mapsFor(size: ExportSize): number {
  const fit = Math.floor(PIXEL_BUDGET / (size.width * size.height));
  return Math.min(Math.max(fit, MIN_MAPS), MAX_MAPS);
}
/** A bit of picture per pixel per frame: enough for sharp map detail without a huge file. */
const BITS_PER_PIXEL = 0.12;

/** The target bitrate, in bits a second. */
export function exportBitrate(size: ExportSize, fps = EXPORT_FPS): number {
  return Math.round((size.width * size.height * fps * BITS_PER_PIXEL) / 100_000) * 100_000;
}

/** How long the finished video can be, in seconds, opening and closing cards included. */
export const EXPORT_LENGTHS_S: readonly number[] = [30, 45, 60, 90];
export const DEFAULT_LENGTH_S = 60;

/**
 * The replay speed that makes the video `lengthS` long: the flyover takes what is left after
 * the closing card. Never below real time, so a short activity gets a shorter video rather than
 * a slow-motion one.
 */
export function speedForLength(durationS: number, lengthS: number): number {
  const flyS = Math.max(lengthS - END_HOLD_S, 1);
  return Math.max(durationS / flyS, 1);
}

/** The lengths worth offering for an activity: those that need more than real time. */
export function lengthsFor(durationS: number): number[] {
  const usable = EXPORT_LENGTHS_S.filter((length) => durationS / Math.max(length - END_HOLD_S, 1) >= 1);
  return usable.length > 0 ? usable : [EXPORT_LENGTHS_S[0] ?? 30];
}

/** The opening title card is on screen for about this long. */
const TITLE_S = 2.6;
const TITLE_FADE_S = 0.5;
/** The closing card holds this long after the flyover reaches the end. */
export const END_HOLD_S = 2.5;
const END_FADE_S = 0.5;

export interface ExportFrame {
  /** The moment of the activity this frame shows, in its own `elapsed_s`. */
  activityS: number;
  /** 0 to 1: how visible the title card is. */
  titleAlpha: number;
  /** 0 to 1: how visible the closing card is. */
  endAlpha: number;
}

export interface ExportFrames {
  count: number;
  fps: number;
  /** The video's length in seconds. */
  videoS: number;
  at(index: number): ExportFrame;
}

function ramp(value: number, from: number, to: number): number {
  return Math.min(Math.max((value - from) / (to - from), 0), 1);
}

/**
 * The frames of an export: the flyover at `speed` times real time, then the closing card
 * held on the last picture. A frame's moment depends only on its number, so any one frame
 * can be drawn on its own, as the preview does.
 */
export function exportFrames(durationS: number, speed: number, fps = EXPORT_FPS): ExportFrames {
  const flyS = durationS / speed;
  const count = Math.max(Math.ceil((flyS + END_HOLD_S) * fps), 1);
  return {
    count,
    fps,
    videoS: count / fps,
    at(index) {
      const screenS = index / fps;
      const activityS = Math.min(screenS * speed, durationS);
      const titleAlpha =
        ramp(screenS, 0, TITLE_FADE_S) * (1 - ramp(screenS, TITLE_S - TITLE_FADE_S, TITLE_S));
      const endAlpha = ramp(screenS, flyS + END_HOLD_S - END_HOLD_S, flyS + END_FADE_S);
      return { activityS, titleAlpha, endAlpha };
    },
  };
}

/** A file name from the activity's name and day: "Doha Cycling 2026-11-13 vertical.mp4". */
export function exportFileName(name: string, day: string, crop: ExportCrop): string {
  const clean =
    name
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Activity";
  return `${clean} ${day} ${crop}.mp4`;
}
