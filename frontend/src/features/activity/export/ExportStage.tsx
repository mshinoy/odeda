import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import type { Activity, ActivityGap } from "@/api/adapters";
import type { ExportSize } from "@/features/activity/export/exportPlan";
import type { Playback } from "@/features/activity/usePlayback";
import type { MetricKey } from "@/lib/metrics";
import type { MapProbe } from "@/map/probe";

const ActivityMap = lazy(() =>
  import("@/features/activity/ActivityMap").then((m) => ({ default: m.ActivityMap })),
);

/** What the exporter can ask of the stage. */
export interface StageHandle {
  /**
   * Shows the activity at `activityS` on the hidden map and waits until it has finished
   * drawing: tiles in, camera settled, route layer redrawn. Resolves with what to copy.
   */
  show(activityS: number): Promise<StageShot>;
}

/** Where one frame's time went, in milliseconds. */
export interface StageTimings {
  /** Setting the moment and the page re-rendering for it, until the next screen refresh. */
  render: number;
  /** Waiting for the map to finish drawing, tiles included. */
  tiles: number;
  /** Draws until one had every tile (1 = they were already in). */
  renders: number;
  /** The first draw already had every tile. */
  readyFirst: boolean;
  /** Waiting for the route and dot layer, which draws a refresh or two later. */
  layers: number;
}

export interface StageShot {
  timings: StageTimings;
  /** The map's canvases, back to front. */
  canvases: HTMLCanvasElement[];
  /** Mapbox's logo, if the page has it, to draw into the frame. */
  logo: HTMLImageElement | null;
}

interface ExportStageProps {
  activity: Activity;
  colorBy: MetricKey;
  gaps: readonly ActivityGap[];
  satellite: boolean;
  /** The picture's size in pixels. */
  size: ExportSize;
  /** The replay speed the flyover is flown at, which sets the opening and the sway. */
  speed: number;
}

const noop = () => undefined;
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Mapbox draws its logo as a CSS background; this turns it into an image to draw. */
function logoOf(container: HTMLElement): Promise<HTMLImageElement | null> {
  const element = container.querySelector(".mapboxgl-ctrl-logo");
  if (!element) return Promise.resolve(null);
  const match = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(element).backgroundImage);
  if (!match?.[1]) return Promise.resolve(null);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = match[1] as string;
  });
}

/**
 * A map the page never shows, the exact size of the video, flown by hand: each call to
 * `show` puts it on one moment of the activity. It is the page's own activity map, so the
 * video draws the same route, trail, dot and camera as the flyover on screen.
 */
export const ExportStage = forwardRef<StageHandle, ExportStageProps>(function ExportStage(
  { activity, colorBy, gaps, satellite, size, speed },
  ref,
) {
  const [seconds, setSeconds] = useState(0);
  const container = useRef<HTMLDivElement>(null);
  const probe = useRef<MapProbe | null>(null);
  const waiting = useRef<((probe: MapProbe) => void)[]>([]);
  const logo = useRef<Promise<HTMLImageElement | null> | null>(null);

  const onMap = useCallback((next: MapProbe | null) => {
    probe.current = next;
    if (next) {
      for (const resolve of waiting.current) resolve(next);
      waiting.current = [];
    }
  }, []);

  useImperativeHandle(ref, () => ({
    async show(activityS) {
      const mapProbe =
        probe.current ?? (await new Promise<MapProbe>((resolve) => waiting.current.push(resolve)));
      const t0 = performance.now();
      flushSync(() => setSeconds(activityS));
      // Effects (the camera, the layers) run before the next paint; then the map draws.
      await nextFrame();
      const t1 = performance.now();
      const idle = await mapProbe.whenIdle();
      const t2 = performance.now();
      // The route layer draws on its own cycle: give it two frames to catch up.
      await nextFrame();
      await nextFrame();
      const t3 = performance.now();

      const root = container.current;
      if (!root) throw new Error("The export map went away");
      logo.current ??= logoOf(root);
      return {
        canvases: [...root.querySelectorAll("canvas")],
        logo: await logo.current,
        timings: {
          render: t1 - t0,
          tiles: t2 - t1,
          layers: t3 - t2,
          renders: idle.renders,
          readyFirst: idle.readyFirst,
        },
      };
    },
  }));

  // The picture is drawn at the display's pixel ratio, so the box is the video's size
  // divided by it: the canvases then come out exactly as many pixels as the video needs.
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const playback: Playback = useMemo(
    () => ({
      currentS: seconds,
      playing: true,
      speed: speed as Playback["speed"],
      toggle: noop,
      setSpeed: noop,
      scrubTo: noop,
    }),
    [seconds, speed],
  );

  return (
    <div
      ref={container}
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: -100_000,
        width: size.width / ratio,
        height: size.height / ratio,
        pointerEvents: "none",
      }}
    >
      <Suspense fallback={null}>
        <ActivityMap
          activity={activity}
          colorBy={colorBy}
          playback={playback}
          gaps={gaps}
          cameraMode="flyover"
          satellite={satellite}
          capture
          onMap={onMap}
        />
      </Suspense>
    </div>
  );
});
