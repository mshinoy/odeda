// Renders a whole export: for every frame, the hidden map is put on its moment, copied into
// a canvas with the readout and credit drawn over it, and handed to the encoder. The file is
// made in the browser with WebCodecs, so nothing is uploaded and it does not depend on how
// fast the page can play in real time.
import {
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
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
import { drawFrame } from "@/features/activity/export/renderFrame";
import type { StageHandle } from "@/features/activity/export/ExportStage";
import {
  heartRateZone,
  readoutAt,
  readoutLabels,
  type ReadoutSeries,
} from "@/features/activity/readout";

/** H.264 first: it is what Instagram and YouTube want. The rest are for browsers without it. */
const CODEC_PREFERENCE: VideoCodec[] = ["avc", "hevc", "vp9", "av1"];

export interface ExportJob {
  stage: StageHandle;
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

/** The average time per frame spent in each stage, in milliseconds, over the frames so far. */
export interface FrameTimings {
  render: number;
  tiles: number;
  layers: number;
  draw: number;
  /** Waiting for the encoder to take the previous frame: near zero when it keeps up. */
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

export async function runExport(job: ExportJob): Promise<ExportResult> {
  const { activity, crop, quality, speed, stage, signal } = job;
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

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not make a canvas to draw the video on");
  await document.fonts.load('650 54px "Geist"');
  await document.fonts.load('700 92px "Geist"');

  const source = new CanvasSource(canvas, { codec, bitrate });
  output.addVideoTrack(source, { frameRate: frames.fps });
  await output.start();

  const title = titleCard(activity.summary);
  const end = endCard(activity.summary);
  let shot: Awaited<ReturnType<StageHandle["show"]>> | null = null;
  let shownAt = Number.NaN;
  const sum = { render: 0, tiles: 0, layers: 0, draw: 0, encode: 0 };
  let rendered = 0;
  // The encoder takes a snapshot of the canvas when `add` is called, so the next frame can be
  // drawn while this one is still being encoded. Only one frame is allowed to be in flight.
  let pending: Promise<void> = Promise.resolve();
  try {
    for (let i = 0; i < frames.count; i++) {
      if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
      const frame = frames.at(i);
      // The closing card holds on one picture: the map does not need drawing again.
      if (shot === null || frame.activityS !== shownAt) {
        shot = await stage.show(frame.activityS);
        shownAt = frame.activityS;
        sum.render += shot.timings.render;
        sum.tiles += shot.timings.tiles;
        sum.layers += shot.timings.layers;
        rendered += 1;
      }
      const drawStart = performance.now();
      const readout = readoutAt(job.readout, frame.activityS, speed);
      drawFrame(ctx, size, {
        mapCanvases: shot.canvases,
        logo: shot.logo,
        readout: readoutLabels(activity.summary.kind, readout),
        zone: heartRateZone(readout.hr, job.hrRest, job.hrMax),
        frame,
        title,
        end,
        crop,
      });
      sum.draw += performance.now() - drawStart;
      const waitStart = performance.now();
      await pending;
      sum.encode += performance.now() - waitStart;
      pending = source.add(i / frames.fps, 1 / frames.fps);
      // A failure here is reported when it is awaited, not as an unhandled rejection first.
      pending.catch(() => undefined);
      const n = Math.max(rendered, 1);
      job.onProgress(i + 1, frames.count, {
        render: sum.render / n,
        tiles: sum.tiles / n,
        layers: sum.layers / n,
        draw: sum.draw / (i + 1),
        encode: sum.encode / (i + 1),
      });
    }
    await pending;
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
