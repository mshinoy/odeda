import type { ColorTokens } from "@/design/tokens";
import { RampLegend } from "@/map/RampLegend";

/**
 * The heatmap's ramp. The ends carry no number on purpose: the colour comes from
 * deck.gl's aggregation of nearby cells, not from one cell's count, so a figure at
 * either end would claim a precision the picture does not have.
 */
export function DensityLegend({ tokens }: { tokens: ColorTokens }) {
  return <RampLegend low="Less" high="More" label="Visits" tokens={tokens} />;
}
