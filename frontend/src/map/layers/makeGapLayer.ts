// The stretch the watch did not record, drawn dashed where the rider's other activities
// say the path went. Dashed and muted, because it is a guess and the map should look it.
import { PathLayer } from "@deck.gl/layers";
import type { ActivityGap } from "@/api/adapters";
import { hexToRgba } from "@/design/scales";
import type { ColorTokens } from "@/design/tokens";
import { dashPaths } from "@/lib/dashes";

export const GAP_LAYER_ID = "activity-gap";

const GAP_WIDTH_PX = 3;
// Long enough to read as dashes at the zoom a whole ride is seen at.
const DASH_METRES = 140;
const BETWEEN_DASHES_METRES = 100;

export interface GapDash {
  path: [number, number][];
}

/** Every dash of every gap that has an estimated path. A gap with none draws nothing. */
export function gapDashes(gaps: readonly ActivityGap[]): GapDash[] {
  return gaps.flatMap((gap) =>
    gap.estimate === null
      ? []
      : dashPaths(gap.estimate.path, DASH_METRES, BETWEEN_DASHES_METRES).map((path) => ({
          path,
        })),
  );
}

export function makeGapLayer(
  gaps: readonly ActivityGap[],
  tokens: ColorTokens,
): PathLayer<GapDash> | null {
  const data = gapDashes(gaps);
  if (data.length === 0) return null;
  return new PathLayer<GapDash>({
    id: GAP_LAYER_ID,
    data,
    getPath: (dash) => dash.path,
    getColor: hexToRgba(tokens.inkMuted),
    getWidth: GAP_WIDTH_PX,
    widthUnits: "pixels",
    capRounded: true,
    pickable: false,
  });
}
