// Renders a whole export. Several hidden maps each draw their own frames at the same time (a
// frame is mostly waiting, on tiles and on the screen, so the waits overlap), the frames are
// put in order, and an encoder in the browser (WebCodecs) turns them into an MP4. Nothing is
// uploaded, and it does not depend on how fast the page can play in real time.
import {
  BufferTarget,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  VideoSample,
  VideoSampleSource,
  type VideoCodec,
} from "mediabunny";
import type { Activity } from "@/api/adapters";
import { endCard, titleCard } from "@/features/activity/export/exportCards";
import {
  exportBitrate,
  exportFrames,
  exportSize,
  type ExportCrop,
  type ExportQuality,
} from "@/features/activity/export/exportPlan";
import { runOrdered } from "@/features/activity/export/orderedPool";
import { drawFrame } from "@/features/activity/export/renderFrame";
import type { StageHandle, StageShot } from "@/features/activity/export/ExportStage";
import {
  heartRateZone,
  readoutAt,
  readoutLabels,
  type ReadoutSeries,
} from "@/features/activity/readout";

/** H.264 first: it is what Instagram and YouTube want. The rest are for browsers without it. */
const CODEC_PREFERENCE: VideoCodec[] = ["avc", "hevc", "vp9", "av1"];

export interface ExportJob {
  /** One hidden map each; they draw different frames at the same time. */
  stages: readonly StageHandle[];
  activity: Activity;
  crop: ExportCrop;
  quality: ExportQuality;
  /** The replay speed the flyover is flown at. */
  speed: number;
  readout: ReadoutSeries;
  hrRest?: number | null;
  hrMax?: number | null;
  /** Called after every frame with how many are done, of how many, and where the time went. */
  onProgress: (done: number, total: number, perFrame: FrameTimings) => void;
  signal: AbortSignal;
}

/** The average time per frame in each stage, in milliseconds, over the frames so far. For the
 * map stages it is one map's time for one frame: with several maps, frames come faster than
 * this. */
export interface FrameTimings {
  render: number;
  tiles: number;
  layers: number;
  draw: number;
  /** The encoder taking a frame: near zero when it keeps up. */
  encode: number;
}

export interface ExportResult {
  blob: Blob;
  codec: VideoCodec;
}

/** True where the browser can encode video at all. */
export function canEncodeVideo(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not make a canvas to draw the video on");
  return [canvas, ctx];
}

export async function runExport(job: ExportJob): Promise<ExportResult> {
  const { activity, crop, quality, speed, stages, signal } = job;
  if (stages.length === 0) throw new Error("The export has no map to draw with");
  const size = exportSize(crop, quality);
  const durationS = activity.streams.elapsedS[activity.streams.elapsedS.length - 1] ?? 0;
  const frames = exportFrames(durationS, speed);
  const bitrate = exportBitrate(size, frames.fps);

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const codec = await getFirstEncodableVideoCodec(CODEC_PREFERENCE, {
    width: size.width,
    height: size.height,
    bitrate,
  });
  if (!codec) throw new Error("This browser cannot encode video. Try Chrome, Edge or Safari.");

  // One canvas for each map to draw its frame on, so frames made at the same time do not
  // overwrite each other before the encoder has taken a snapshot.
  const canvases = stages.map(() => canvasOf(size.width, size.height));
  await document.fonts.load('650 54px "Geist"');
  await document.fonts.load('700 92px "Geist"');

  const source = new VideoSampleSource({ codec, bitrate });
  output.addVideoTrack(source, { frameRate: frames.fps });
  await output.start();

  const title = titleCard(activity.summary);
  const end = endCard(activity.summary);

  // From some frame on the flyover has reached the end and the closing card just holds: the
  // map is the same picture, so it is drawn once and the rest are drawn from it.
  let lastFlying = frames.count - 1;
  for (let i = 0; i < frames.count; i++) {
    if (frames.at(i).activityS >= durationS) {
      lastFlying = i;
      break;
    }
  }

  const sum = { render: 0, tiles: 0, layers: 0, draw: 0, encode: 0 };
  let rendered = 0;
  let encoded = 0;
  let holdShot: StageShot | null = null;

  const drawOne = (
    index: number,
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    shot: StageShot,
  ): VideoSample => {
    const frame = frames.at(index);
    const reading = readoutAt(job.readout, frame.activityS, speed);
    const started = performance.now();
    drawFrame(ctx, size, {
      mapCanvases: shot.canvases,
      logo: shot.logo,
      readout: readoutLabels(activity.summary.kind, reading),
      zone: heartRateZone(reading.hr, job.hrRest, job.hrMax),
      frame,
      title,
      end,
      crop,
    });
    // A snapshot of the canvas as it is now, so it can be drawn on again straight away.
    const sample = new VideoSample(canvas, { timestamp: index / frames.fps, duration: 1 / frames.fps });
    sum.draw += performance.now() - started;
    return sample;
  };

  const add = async (index: number, sample: VideoSample) => {
    const started = performance.now();
    try {
      await source.add(sample);
    } finally {
      sample.close();
    }
    sum.encode += performance.now() - started;
    encoded += 1;
    const n = Math.max(rendered, 1);
    job.onProgress(index + 1, frames.count, {
      render: sum.render / n,
      tiles: sum.tiles / n,
      layers: sum.layers / n,
      draw: sum.draw / encoded,
      encode: sum.encode / encoded,
    });
  };

  try {
    await runOrdered<VideoSample>({
      count: lastFlying + 1,
      workers: stages.length,
      lookahead: stages.length * 2,
      signal,
      produce: async (index, worker) => {
        const stage = stages[worker];
        const target = canvases[worker];
        if (!stage || !target) throw new Error("The export lost a map");
        const shot = await stage.show(frames.at(index).activityS);
        sum.render += shot.timings.render;
        sum.tiles += shot.timings.tiles;
        sum.layers += shot.timings.layers;
        rendered += 1;
        if (index === lastFlying) holdShot = shot;
        return drawOne(index, target[1], target[0], shot);
      },
      consume: add,
    });

    // The closing card holds on the last picture; that map has not been drawn on since.
    const last = holdShot as StageShot | null;
    const first = canvases[0];
    for (let i = lastFlying + 1; i < frames.count; i++) {
      if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      if (!last || !first) break;
      await add(i, drawOne(i, first[1], first[0], last));
    }
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The video had no data");
  return { blob: new Blob([buffer], { type: "video/mp4" }), codec };
}
