// Every colour in the app, for both themes, in one place. Components never hold a hex:
// CSS reads these through the variables `applyTokens` writes, and canvas-drawn things
// (ECharts, deck.gl) read them through `useTokens()`.
//
// The categorical, ramp and status steps come from a validated palette: run, ride and
// swim stay distinguishable under protanopia/deuteranopia with any two side by side
// (map routes), in both themes. Re-run the palette validator before changing a hue.

export type Theme = "light" | "dark";

export interface ColorTokens {
  /** The page behind everything. */
  page: string;
  /** Cards, charts, popovers. */
  surface: string;
  /** Hover washes, skeletons, the track behind a bar. */
  surfaceMuted: string;

  ink: string;
  inkSecondary: string;
  /** Axis labels, captions, placeholders. */
  inkMuted: string;

  border: string;
  gridline: string;
  axis: string;
  focusRing: string;

  /** One fixed colour per activity kind, used for routes, lines and badges alike. */
  kind: {
    run: string;
    ride: string;
    swim: string;
    walk: string;
    strength: string;
    other: string;
  };

  /**
   * The one magnitude scale (pace, HR, elevation, heatmap density), low to high.
   * Every step stays visible on the theme's surface and basemap: in dark mode it runs
   * dark-to-light so high values are the brightest.
   */
  metricRamp: readonly string[];

  /** HR zones 1-5, the same hue as the metric ramp, stepped for ordinal reading. */
  hrZones: readonly [string, string, string, string, string];

  /**
   * Up to five things of the same sort side by side: the compared activities' tracks
   * and their chart lines. Separate from `kind`, because comparing five runs would
   * otherwise be five orange lines.
   *
   * Checked by `palette.test.ts`: every pair stays apart under protanopia,
   * deuteranopia and tritanopia, and every colour stays off its theme's surface. Five
   * colours cannot hold the three `kind` colours' margin — that is the geometry of
   * colour-blind vision, not a shortcut — so the series also carry a legend.
   */
  series: readonly [string, string, string, string, string];

  status: {
    good: string;
    warning: string;
    serious: string;
    critical: string;
  };

  /** Text colour for a delta that is good news (▲ faster, ▼ resting HR). */
  deltaGood: string;
  deltaBad: string;

  /** The hovered-sample dot on maps and the crosshair on charts. */
  cursor: string;
}

const neutralKind = "#898781";

const status = {
  good: "#0ca30c",
  warning: "#fab219",
  serious: "#ec835a",
  critical: "#d03b3b",
};

export const colorTokens: Record<Theme, ColorTokens> = {
  light: {
    page: "#f9f9f7",
    surface: "#fcfcfb",
    surfaceMuted: "#f0efec",
    ink: "#0b0b0b",
    inkSecondary: "#52514e",
    inkMuted: "#898781",
    border: "rgba(11, 11, 11, 0.10)",
    gridline: "#e1e0d9",
    axis: "#c3c2b7",
    focusRing: "#2a78d6",
    kind: {
      run: "#eb6834",
      ride: "#4a3aa7",
      swim: "#1baf7a",
      walk: neutralKind,
      strength: neutralKind,
      other: neutralKind,
    },
    metricRamp: ["#86b6ef", "#6da7ec", "#5598e7", "#3987e5", "#2a78d6", "#1c5cab", "#104281"],
    hrZones: ["#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281"],
    series: ["#08306b", "#d95f02", "#2ca25f", "#c051a5", "#8ec4dd"],
    status,
    deltaGood: "#006300",
    deltaBad: "#d03b3b",
    cursor: "#0b0b0b",
  },
  dark: {
    page: "#0d0d0d",
    surface: "#1a1a19",
    surfaceMuted: "#262624",
    ink: "#ffffff",
    inkSecondary: "#c3c2b7",
    inkMuted: "#898781",
    border: "rgba(255, 255, 255, 0.10)",
    gridline: "#2c2c2a",
    axis: "#383835",
    focusRing: "#3987e5",
    kind: {
      run: "#d95926",
      ride: "#9085e9",
      swim: "#199e70",
      walk: neutralKind,
      strength: neutralKind,
      other: neutralKind,
    },
    metricRamp: ["#184f95", "#256abf", "#2a78d6", "#3987e5", "#6da7ec", "#9ec5f4", "#cde2fb"],
    hrZones: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"],
    series: ["#3b82f6", "#f97316", "#22c55e", "#e879c9", "#bfe4f8"],
    status,
    deltaGood: "#0ca30c",
    deltaBad: "#e66767",
    cursor: "#ffffff",
  },
};

/**
 * CSS variables for the chrome. The shadcn names (`--background`, `--card`, ...) are
 * mapped here so its components follow the same tokens; our own are prefixed `--ga-`.
 */
export function cssVariables(t: ColorTokens): Record<string, string> {
  return {
    "--background": t.page,
    "--foreground": t.ink,
    "--card": t.surface,
    "--card-foreground": t.ink,
    "--popover": t.surface,
    "--popover-foreground": t.ink,
    "--primary": t.ink,
    "--primary-foreground": t.page,
    "--secondary": t.surfaceMuted,
    "--secondary-foreground": t.ink,
    "--muted": t.surfaceMuted,
    "--muted-foreground": t.inkMuted,
    "--accent": t.surfaceMuted,
    "--accent-foreground": t.ink,
    "--destructive": t.status.critical,
    "--border": t.border,
    "--input": t.border,
    "--ring": t.focusRing,

    "--ga-ink-secondary": t.inkSecondary,
    "--ga-kind-run": t.kind.run,
    "--ga-kind-ride": t.kind.ride,
    "--ga-kind-swim": t.kind.swim,
    "--ga-kind-walk": t.kind.walk,
    "--ga-kind-strength": t.kind.strength,
    "--ga-kind-other": t.kind.other,
    "--ga-delta-good": t.deltaGood,
    "--ga-delta-bad": t.deltaBad,
    "--ga-status-good": t.status.good,
    "--ga-status-warning": t.status.warning,
    "--ga-status-serious": t.status.serious,
    "--ga-status-critical": t.status.critical,
  };
}

/** Writes the theme's variables onto <html> and sets the `dark` class shadcn keys off. */
export function applyTokens(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(cssVariables(colorTokens[theme]))) {
    root.style.setProperty(name, value);
  }
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}
