import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Activity, ActivityGap } from "@/api/adapters";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { endCard, titleCard } from "@/features/activity/export/exportCards";
import {
  CROP_LABELS,
  DEFAULT_LENGTH_S,
  EXPORT_CROPS,
  EXPORT_QUALITIES,
  exportBitrate,
  exportFileName,
  exportFrames,
  exportSize,
  lengthsFor,
  mapsFor,
  QUALITY_LABELS,
  speedForLength,
  type ExportCrop,
  type ExportQuality,
} from "@/features/activity/export/exportPlan";
import { ExportStage, type StageHandle } from "@/features/activity/export/ExportStage";
import { drawFrame } from "@/features/activity/export/renderFrame";
import {
  runExport,
  type ExportResult,
  type FrameTimings,
} from "@/features/activity/export/runExport";
import {
  heartRateZone,
  readoutAt,
  readoutLabels,
  type ReadoutSeries,
} from "@/features/activity/readout";
import { formatDuration } from "@/lib/format";
import type { MetricKey } from "@/lib/metrics";
import { cn } from "@/lib/utils";

/** The time left is worked out from this much of the most recent progress. */
const RECENT_MS = 15_000;

type Moment = "opening" | "ride" | "ending";

const MOMENT_LABELS: Record<Moment, string> = {
  opening: "Opening",
  ride: "Mid-ride",
  ending: "Ending",
};

/** The shape of each crop, drawn small: a rectangle of the right proportions. */
const CROP_SHAPE: Record<ExportCrop, string> = {
  vertical: "h-9 w-5",
  square: "h-7 w-7",
  horizontal: "h-5 w-9",
};

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  colorBy: MetricKey;
  gaps: readonly ActivityGap[];
  satellite: boolean;
  readout: ReadoutSeries;
  hrRest?: number | null;
  hrMax?: number | null;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
}

/**
 * Chooses and makes a video of the flyover: the crop (vertical, square, horizontal), how sharp
 * (HD or 2K), how fast; a still preview of the frame it would be, then the MP4 itself.
 */
export function ExportDialog({
  open,
  onOpenChange,
  activity,
  colorBy,
  gaps,
  satellite,
  readout,
  hrRest,
  hrMax,
}: ExportDialogProps) {
  const [crop, setCrop] = useState<ExportCrop>("vertical");
  const [quality, setQuality] = useState<ExportQuality>("hd");
  const durationS = activity.streams.elapsedS[activity.streams.elapsedS.length - 1] ?? 0;
  const lengths = useMemo(() => lengthsFor(durationS), [durationS]);
  const [lengthS, setLengthS] = useState(
    lengths.includes(DEFAULT_LENGTH_S) ? DEFAULT_LENGTH_S : (lengths[lengths.length - 1] ?? 30),
  );
  // The speed follows from how long the video should be: the ride, squeezed into that.
  const speed = speedForLength(durationS, lengthS);
  const [timings, setTimings] = useState<FrameTimings | null>(null);
  const [moment, setMoment] = useState<Moment>("ride");
  // The video is made when "Make video" is pressed, and kept until it is saved or a choice
  // changes. The maps that draw it exist only while it is being made.
  const [making, setMaking] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [made, setMade] = useState<(ExportResult & { key: string }) | null>(null);
  const [renderedS, setRenderedS] = useState<number | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 1, etaS: null as number | null });
  const recent = useRef<{ done: number; at: number }[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);

  // One small map for the preview, and a set of full-size ones that draw the video's frames.
  const stage = useRef<StageHandle>(null);
  const renderStages = useRef<(StageHandle | null)[]>([]);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const job = useRef<AbortController | null>(null);
  const runId = useRef(0);
  // What a render reads but should not restart for when the page hands over a new object.
  const latest = useRef({ activity, readout, hrRest, hrMax });
  useEffect(() => {
    latest.current = { activity, readout, hrRest, hrMax };
  }, [activity, readout, hrRest, hrMax]);

  const frames = useMemo(() => exportFrames(durationS, speed), [durationS, speed]);
  const finalSize = exportSize(crop, quality);
  // Memoised: a new object on every render would restart the preview on every render, and the
  // preview itself causes renders, so it would never finish.
  const draftSize = useMemo(() => exportSize(crop, "draft"), [crop]);
  // What a finished video was made from: change any of it and the video is out of date.
  const settingsKey = [crop, quality, lengthS, colorBy, satellite, activity.summary.id].join("|");
  const result = made?.key === settingsKey ? made : null;
  const draftKey = `${draftSize.width}x${draftSize.height}`;
  const maps = mapsFor(finalSize);
  const finalKey = `${finalSize.width}x${finalSize.height}`;
  const bitrate = exportBitrate(finalSize, frames.fps);

  const title = useMemo(() => titleCard(activity.summary), [activity.summary]);
  const end = useMemo(() => endCard(activity.summary), [activity.summary]);

  // A still of the frame the video would have, redrawn when the choices change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewing(true);
      try {
        const flyFrames = frames.count - Math.round(2.5 * frames.fps);
        const index =
          moment === "opening"
            ? Math.round(1.4 * frames.fps)
            : moment === "ending"
              ? frames.count - 1
              : Math.round(flyFrames * 0.4);
        const frame = frames.at(index);
        const current = stage.current;
        const canvas = previewCanvas.current;
        if (!current || !canvas) return;
        const shot = await current.show(frame.activityS);
        if (cancelled) return;
        canvas.width = draftSize.width;
        canvas.height = draftSize.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const reading = readoutAt(readout, frame.activityS, speed);
        drawFrame(ctx, draftSize, {
          mapCanvases: shot.canvases,
          logo: shot.logo,
          readout: readoutLabels(activity.summary.kind, reading),
          zone: heartRateZone(reading.hr, hrRest, hrMax),
          frame,
          title,
          end,
          crop,
        });
      } catch {
        // A preview that fails leaves the last one up; the export reports its own errors.
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    open,
    crop,
    speed,
    moment,
    draftKey,
    frames,
    readout,
    activity.summary.kind,
    title,
    end,
    hrRest,
    hrMax,
    draftSize,
  ]);

  const render = useCallback(
    async (controller: AbortController) => {
      const id = ++runId.current;
      const started = Date.now();
      recent.current = [];
      setError(null);
      setMade(null);
      setSavedName(null);
      setRenderedS(null);
      setTimings(null);
      setProgress({ done: 0, total: frames.count, etaS: null });
      setRendering(true);
      try {
        const handles = renderStages.current
          .slice(0, maps)
          .filter((handle): handle is StageHandle => handle !== null);
        const done = await runExport({
          stages: handles,
          ...latest.current,
          crop,
          quality,
          speed,
          onProgress: (done, total, perFrame) => {
            if (id !== runId.current) return;
            setTimings(perFrame);
            // The time left comes from the last few seconds, not from the start: the first
            // frames include loading the maps, which says nothing about the pace once going.
            const now = Date.now();
            recent.current.push({ done, at: now });
            while (recent.current.length > 1 && now - (recent.current[0]?.at ?? now) > RECENT_MS) {
              recent.current.shift();
            }
            const first = recent.current[0];
            const framesPerS =
              first && done > first.done ? ((done - first.done) * 1000) / (now - first.at) : 0;
            setProgress({ done, total, etaS: framesPerS > 0 ? (total - done) / framesPerS : null });
          },
          signal: controller.signal,
        });
        if (id !== runId.current) return;
        setMade({ ...done, key: settingsKey });
        setRenderedS((Date.now() - started) / 1000);
      } catch (caught) {
        if (id !== runId.current) return;
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError(caught instanceof Error ? caught.message : "The export failed");
        }
      } finally {
        if (id === runId.current) setRendering(false);
      }
    },
    [crop, quality, speed, maps, frames.count, settingsKey],
  );

  // Makes the video when asked. The maps that draw it are mounted first (flushed, so they
  // exist and their handles are set), and the choices are locked while it runs.
  const make = () => {
    flushSync(() => setMaking(true));
    const controller = new AbortController();
    job.current = controller;
    void render(controller).finally(() => setMaking(false));
  };

  // Closing the dialog stops a video being made.
  useEffect(() => () => job.current?.abort(), []);

  const save = () => {
    if (!result) return;
    const name = exportFileName(activity.summary.name, activity.summary.day, crop);
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    const codecNote =
      result.codec === "avc"
        ? ""
        : ` This browser made ${result.codec.toUpperCase()}, not H.264; Instagram may re-encode it or refuse it. Chrome makes H.264.`;
    setSavedName(`Saved ${name} (${megabytes(result.blob.size)}).${codecNote}`);
  };

  const percent = Math.round((progress.done / progress.total) * 100);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Export video</DialogTitle>
          <DialogDescription>
            An MP4 of the 3D flyover, made in this browser. Pick the shape and sharpness, check the
            preview, then export.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex flex-col items-center gap-3">
            <div className="relative flex min-h-48 w-full items-center justify-center">
              <canvas
                ref={previewCanvas}
                aria-label="Preview of the video frame"
                className="bg-muted max-h-[52vh] w-auto max-w-full rounded-lg border"
                style={{ aspectRatio: `${draftSize.width} / ${draftSize.height}` }}
              />
              {previewing && (
                <span className="bg-background/90 text-muted-foreground absolute rounded-md px-2 py-1 text-xs">
                  Rendering preview…
                </span>
              )}
            </div>
            <div role="group" aria-label="Preview moment" className="flex gap-1">
              {(Object.keys(MOMENT_LABELS) as Moment[]).map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  disabled={making}
                  variant={moment === option ? "secondary" : "ghost"}
                  onClick={() => setMoment(option)}
                >
                  {MOMENT_LABELS[option]}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">Shape</span>
              <div role="radiogroup" aria-label="Shape" className="grid gap-1.5">
                {EXPORT_CROPS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={crop === option}
                    disabled={making}
                      onClick={() => setCrop(option)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      crop === option ? "bg-muted border-foreground/40" : "hover:bg-muted/60",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "border-foreground/60 shrink-0 rounded-[3px] border-2",
                        CROP_SHAPE[option],
                      )}
                    />
                    <span className="flex flex-col">
                      <span className="font-medium">{CROP_LABELS[option].title}</span>
                      <span className="text-muted-foreground text-xs">
                        {CROP_LABELS[option].hint}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground text-xs">Sharpness</span>
              <NativeSelect
                value={quality}
                disabled={making}
                onChange={(event) => setQuality(event.target.value as ExportQuality)}
              >
                {EXPORT_QUALITIES.map((option) => (
                  <option key={option} value={option}>
                    {QUALITY_LABELS[option]}
                  </option>
                ))}
              </NativeSelect>
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-muted-foreground text-xs">Video length</span>
              <NativeSelect
                value={String(lengthS)}
                disabled={making}
                onChange={(event) => setLengthS(Number(event.target.value))}
              >
                {lengths.map((option) => (
                  <option key={option} value={option}>
                    {option} seconds
                  </option>
                ))}
              </NativeSelect>
            </label>

            <p className="text-muted-foreground text-xs tabular-nums">
              {finalSize.width}×{finalSize.height} · {frames.count.toLocaleString()} frames ·{" "}
              {Math.round(speed)}× · about {megabytes((bitrate * frames.videoS) / 8)}
            </p>
          </div>
        </div>

        {rendering && (
          <div className="flex flex-col gap-1.5" role="status">
            <div className="bg-muted h-2 overflow-hidden rounded-full">
              <div
                className="bg-foreground h-full rounded-full transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="text-muted-foreground text-xs tabular-nums">
              Making the video with {maps} maps · {percent}% · frame {progress.done} of{" "}
              {progress.total}
              {progress.etaS !== null &&
                ` · about ${formatDuration(Math.round(progress.etaS))} left`}
            </span>
            {timings && (
              <span className="text-muted-foreground text-xs tabular-nums">
                Per frame on each map, in ms: page {Math.round(timings.render)} · tiles{" "}
                {Math.round(timings.tiles)} · route layer {Math.round(timings.layers)} · drawing{" "}
                {Math.round(timings.draw)} · encoder wait {Math.round(timings.encode)}
              </span>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-delta-bad text-sm">
            {error}
          </p>
        )}
        {result && (
          <p className="text-sm">
            Ready: {megabytes(result.blob.size)}
            {renderedS !== null && `, made in ${formatDuration(Math.round(renderedS))}`} with {maps}{" "}
            maps.
          </p>
        )}
        {savedName && <p className="text-sm">{savedName}</p>}
        {!rendering && timings && (
          <p className="text-muted-foreground text-xs tabular-nums">
            Per frame on each map, in ms: page {Math.round(timings.render)} · tiles{" "}
            {Math.round(timings.tiles)} · route layer {Math.round(timings.layers)} · drawing{" "}
            {Math.round(timings.draw)} · encoder {Math.round(timings.encode)}
          </p>
        )}

        <DialogFooter>
          {rendering ? (
            <Button type="button" variant="outline" onClick={() => job.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              {result ? (
                <Button type="button" onClick={save}>
                  Save MP4
                </Button>
              ) : (
                <Button type="button" onClick={make}>
                  Make video
                </Button>
              )}
            </>
          )}
        </DialogFooter>

        {open && (
          <ExportStage
            key={`preview-${draftKey}`}
            ref={stage}
            activity={activity}
            colorBy={colorBy}
            gaps={gaps}
            satellite={satellite}
            size={draftSize}
            speed={speed}
          />
        )}
        {open &&
          making &&
          Array.from({ length: maps }, (_, k) => (
            <ExportStage
              key={`${finalKey}-${k}`}
              ref={(handle) => {
                renderStages.current[k] = handle;
              }}
              activity={activity}
              colorBy={colorBy}
              gaps={gaps}
              satellite={satellite}
              size={finalSize}
              speed={speed}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}
