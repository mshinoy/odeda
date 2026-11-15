// One frame of an exported video, drawn onto a 2D canvas: the map as the browser drew it,
// then everything the page's own overlays would be (readout, credit), then the opening and
// closing cards. Drawn by hand because the page's HTML cannot be copied into a canvas.
import { colorTokens } from "@/design/tokens";
import { frameLayout, type FrameLayout } from "@/features/activity/export/exportLayout";
import type { EndCard, TitleCard } from "@/features/activity/export/exportCards";
import type { ExportCrop, ExportFrame, ExportSize } from "@/features/activity/export/exportPlan";
import type { ReadoutLabels } from "@/features/activity/readout";

const FONT = 'Geist, "Geist Variable", system-ui, sans-serif';
const CREDIT = "© Mapbox © OpenStreetMap";

export interface FrameInput {
  /** The map's canvases in the order the page stacks them: the map, then the route layer. */
  mapCanvases: readonly CanvasImageSource[];
  /** Mapbox's own logo, which its terms ask to stay on a map shown anywhere. */
  logo: CanvasImageSource | null;
  readout: ReadoutLabels | null;
  /** The heart-rate zone (1 to 5) for the dot beside the heart rate, if known. */
  zone: number | null;
  frame: ExportFrame;
  title: TitleCard | null;
  end: EndCard | null;
  crop: ExportCrop;
}

function font(weight: number, px: number): string {
  return `${weight} ${px}px ${FONT}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawReadout(ctx: CanvasRenderingContext2D, layout: FrameLayout, input: FrameInput) {
  const { readout } = input;
  if (!readout) return;
  const { x, y, w, h } = layout.readout;
  const u = layout.unit;

  ctx.fillStyle = "rgba(18, 18, 17, 0.68)";
  roundRect(ctx, x, y, w, h, 28 * u);
  ctx.fill();

  const figures: { label: string; value: string; dot?: string }[] = [
    { label: "Distance", value: readout.distance },
    { label: readout.speed.label, value: readout.speed.value },
    {
      label: "Heart rate",
      value: readout.heartRate,
      dot:
        input.zone === null
          ? undefined
          : (colorTokens.dark.hrZones[Math.min(Math.max(input.zone, 1), 5) - 1] ?? undefined),
    },
  ];
  const column = w / figures.length;
  ctx.textBaseline = "alphabetic";
  figures.forEach((figure, i) => {
    const cx = x + column * i + column / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = "#c3c2b7";
    ctx.font = font(500, 27 * u);
    ctx.fillText(figure.label, cx, y + 54 * u);

    ctx.font = font(650, 54 * u);
    const textW = ctx.measureText(figure.value).width;
    const dotW = figure.dot ? 22 * u : 0;
    const start = cx - (textW + dotW) / 2;
    if (figure.dot) {
      ctx.fillStyle = figure.dot;
      ctx.beginPath();
      ctx.arc(start + 8 * u, y + 118 * u - 17 * u, 8 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(figure.value, start + dotW, y + 118 * u);
  });
}

function drawCredit(ctx: CanvasRenderingContext2D, layout: FrameLayout, input: FrameInput) {
  const u = layout.unit;
  const { right, baseline } = layout.credit;
  ctx.font = font(400, 21 * u);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
  ctx.shadowBlur = 4 * u;
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.fillText(CREDIT, right, baseline);
  const textW = ctx.measureText(CREDIT).width;
  if (input.logo) {
    const h = 26 * u;
    const w = h * (88 / 23);
    ctx.drawImage(input.logo, right - textW - 16 * u - w, baseline - h + 3 * u, w, h);
  } else {
    ctx.textAlign = "right";
    ctx.fillText("mapbox", right - textW - 16 * u, baseline);
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
}

function drawTitle(
  ctx: CanvasRenderingContext2D,
  size: ExportSize,
  layout: FrameLayout,
  input: FrameInput,
) {
  const { title } = input;
  const alpha = input.frame.titleAlpha;
  if (!title || alpha <= 0) return;
  const u = layout.unit;

  const shade = ctx.createLinearGradient(0, 0, 0, size.height * 0.6);
  shade.addColorStop(0, `rgba(0, 0, 0, ${0.55 * alpha})`);
  shade.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size.width, size.height * 0.6);

  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 12 * u;
  ctx.fillStyle = "#ffffff";
  ctx.font = font(700, 92 * u);
  ctx.fillText(title.title, size.width / 2, layout.titleY, size.width - 2 * layout.margin);
  ctx.font = font(500, 42 * u);
  ctx.fillStyle = "#e1e0d9";
  ctx.fillText(title.subtitle, size.width / 2, layout.titleY + 70 * u);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.globalAlpha = 1;
}

function drawEnd(
  ctx: CanvasRenderingContext2D,
  size: ExportSize,
  layout: FrameLayout,
  input: FrameInput,
) {
  const { end } = input;
  const alpha = input.frame.endAlpha;
  if (!end || alpha <= 0) return;
  const u = layout.unit;

  ctx.fillStyle = `rgba(10, 10, 10, ${0.62 * alpha})`;
  ctx.fillRect(0, 0, size.width, size.height);

  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(700, 80 * u);
  ctx.fillText(
    end.title,
    size.width / 2,
    layout.endStatsY - 150 * u,
    size.width - 2 * layout.margin,
  );

  const perRow = input.crop === "vertical" ? 2 : Math.min(end.stats.length, 4);
  const cellW = Math.min((size.width - 2 * layout.margin) / perRow, 420 * u);
  const rowH = 150 * u;
  end.stats.forEach((stat, i) => {
    const row = Math.floor(i / perRow);
    const inRow = Math.min(perRow, end.stats.length - row * perRow);
    const col = i % perRow;
    const cx = size.width / 2 + (col - (inRow - 1) / 2) * cellW;
    const cy = layout.endStatsY + row * rowH;
    ctx.fillStyle = "#c3c2b7";
    ctx.font = font(500, 32 * u);
    ctx.fillText(stat.label, cx, cy);
    ctx.fillStyle = "#ffffff";
    ctx.font = font(650, 64 * u);
    ctx.fillText(stat.value, cx, cy + 68 * u);
  });
  ctx.globalAlpha = 1;
}

/** Draws one frame of the export onto `ctx`, a canvas of exactly `size`. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  size: ExportSize,
  input: FrameInput,
): void {
  const layout = frameLayout(size, input.crop);
  ctx.clearRect(0, 0, size.width, size.height);
  ctx.fillStyle = "#101010";
  ctx.fillRect(0, 0, size.width, size.height);
  for (const canvas of input.mapCanvases) ctx.drawImage(canvas, 0, 0, size.width, size.height);

  drawReadout(ctx, layout, input);
  drawCredit(ctx, layout, input);
  drawTitle(ctx, size, layout, input);
  drawEnd(ctx, size, layout, input);
}
