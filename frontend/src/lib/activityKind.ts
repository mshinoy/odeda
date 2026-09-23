export type ActivityKind = "run" | "ride" | "swim" | "walk" | "strength" | "other";

// Garmin typeKeys we know by name. Anything else falls through to the substring rules.
const KIND_BY_TYPE: Readonly<Record<string, ActivityKind>> = {
  running: "run",
  trail_running: "run",
  treadmill_running: "run",
  track_running: "run",
  indoor_running: "run",
  street_running: "run",
  virtual_run: "run",
  ultra_run: "run",
  obstacle_run: "run",

  cycling: "ride",
  road_biking: "ride",
  mountain_biking: "ride",
  indoor_cycling: "ride",
  virtual_ride: "ride",
  gravel_cycling: "ride",
  cyclocross: "ride",
  track_cycling: "ride",
  recumbent_cycling: "ride",
  bmx: "ride",
  e_bike_fitness: "ride",
  e_bike_mountain: "ride",

  lap_swimming: "swim",
  open_water_swimming: "swim",
  swimming: "swim",

  walking: "walk",
  casual_walking: "walk",
  speed_walking: "walk",
  indoor_walking: "walk",
  hiking: "walk",

  strength_training: "strength",
};

// Checked in order; the first rule whose fragment appears in the type wins.
const KIND_BY_FRAGMENT: ReadonlyArray<readonly [ActivityKind, readonly string[]]> = [
  ["run", ["run"]],
  ["ride", ["cycl", "bik", "ride"]],
  ["swim", ["swim"]],
  ["walk", ["walk", "hik"]],
];

export function activityKind(activityType: string): ActivityKind {
  const type = activityType.trim().toLowerCase();
  const known = KIND_BY_TYPE[type];
  if (known) return known;

  for (const [kind, fragments] of KIND_BY_FRAGMENT) {
    if (fragments.some((fragment) => type.includes(fragment))) return kind;
  }
  return "other";
}

/** "trail_running" → "Trail running". */
export function activityTypeLabel(activityType: string): string {
  const words = activityType.trim().toLowerCase().split(/_+/).filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
