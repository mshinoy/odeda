// The body diagram's geometry: a hand-drawn schematic figure, front and back, as SVG
// path data on a 100 x 220 grid. No library, no anatomy beyond what a shaded region can
// honestly say — the point is "you trained this side of your body a lot this week", not
// a medical illustration.
//
// Each muscle is one path per view. Paired muscles are two subpaths of that one path,
// mirrored about x = 50, so a muscle is one element to fill, stroke and hover.
import type { Muscle } from "@/lib/muscles";

export const BODY_VIEW_BOX = "0 0 100 220";

export type BodyView = "front" | "back";

export const BODY_VIEWS: readonly BodyView[] = ["front", "back"];

export const BODY_VIEW_LABELS: Readonly<Record<BodyView, string>> = {
  front: "Front",
  back: "Back",
};

/** The head, drawn as a circle rather than a path. */
export const HEAD = { cx: 50, cy: 17, r: 11 } as const;

/**
 * The figure under the muscles: neck, torso, arms and legs. Filled in the neutral body
 * colour, so an untrained region simply does not stand out.
 */
export const BODY_OUTLINE: readonly string[] = [
  // Neck.
  "M 45 25 L 55 25 L 56 35 L 44 35 Z",
  // Torso: shoulders, waist, hips.
  "M 30 35 L 70 35 L 73 52 L 67 78 L 69 101 L 31 101 L 33 78 L 27 52 Z",
  // Arms, hanging at the sides.
  "M 29 36 L 20 40 L 15 62 L 12 101 L 20 102 L 24 66 L 31 48 Z",
  "M 71 36 L 80 40 L 85 62 L 88 101 L 80 102 L 76 66 L 69 48 Z",
  // Legs, with a foot at the bottom of each.
  "M 31 101 L 49 101 L 47 152 L 45 198 L 34 198 L 33 152 Z",
  "M 69 101 L 51 101 L 53 152 L 55 198 L 66 198 L 67 152 Z",
  "M 34 198 L 45 198 L 45 204 L 33 204 Z",
  "M 66 198 L 55 198 L 55 204 L 67 204 Z",
];

/** One path per muscle per view. A muscle absent from a view is not drawn there. */
export const MUSCLE_PATHS: Readonly<Record<BodyView, Partial<Record<Muscle, string>>>> = {
  front: {
    traps: "M 45 30 L 33 37 L 42 39 L 46 34 Z M 55 30 L 67 37 L 58 39 L 54 34 Z",
    frontDelts:
      "M 30 37 L 22 41 L 22 52 L 31 49 L 33 40 Z M 70 37 L 78 41 L 78 52 L 69 49 L 67 40 Z",
    sideDelts: "M 22 41 L 17 48 L 18 58 L 22 53 Z M 78 41 L 83 48 L 82 58 L 78 53 Z",
    chest: "M 35 40 L 48 43 L 48 58 L 36 55 L 32 47 Z M 65 40 L 52 43 L 52 58 L 64 55 L 68 47 Z",
    abs: "M 42 60 L 58 60 L 57 90 L 50 96 L 43 90 Z",
    obliques: "M 36 58 L 41 60 L 42 88 L 35 80 Z M 64 58 L 59 60 L 58 88 L 65 80 Z",
    biceps: "M 22 54 L 18 60 L 17 74 L 25 72 L 26 58 Z M 78 54 L 82 60 L 83 74 L 75 72 L 74 58 Z",
    forearms: "M 17 76 L 25 74 L 23 98 L 14 99 Z M 83 76 L 75 74 L 77 98 L 86 99 Z",
    quads:
      "M 33 103 L 48 103 L 46 148 L 35 148 L 32 125 Z M 67 103 L 52 103 L 54 148 L 65 148 L 68 125 Z",
    calves: "M 36 155 L 46 155 L 44 190 L 37 190 Z M 64 155 L 54 155 L 56 190 L 63 190 Z",
  },
  back: {
    traps: "M 40 31 L 60 31 L 68 41 L 57 57 L 43 57 L 32 41 Z",
    rearDelts:
      "M 30 37 L 22 41 L 22 52 L 31 49 L 33 40 Z M 70 37 L 78 41 L 78 52 L 69 49 L 67 40 Z",
    lats: "M 33 45 L 43 55 L 42 76 L 33 70 L 30 56 Z M 67 45 L 57 55 L 58 76 L 67 70 L 70 56 Z",
    lowerBack: "M 43 62 L 57 62 L 58 86 L 50 93 L 42 86 Z",
    triceps: "M 22 54 L 18 60 L 17 74 L 25 72 L 26 58 Z M 78 54 L 82 60 L 83 74 L 75 72 L 74 58 Z",
    forearms: "M 17 76 L 25 74 L 23 98 L 14 99 Z M 83 76 L 75 74 L 77 98 L 86 99 Z",
    glutes:
      "M 33 96 L 49 98 L 49 118 L 34 116 L 31 105 Z M 67 96 L 51 98 L 51 118 L 66 116 L 69 105 Z",
    hamstrings: "M 34 120 L 47 120 L 45 150 L 35 150 Z M 66 120 L 53 120 L 55 150 L 65 150 Z",
    calves: "M 36 154 L 46 154 L 44 188 L 37 188 Z M 64 154 L 54 154 L 56 188 L 63 188 Z",
  },
};
