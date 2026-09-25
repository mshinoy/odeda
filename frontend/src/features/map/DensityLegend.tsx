import type { ColorTokens } from "@/design/tokens";
import { steppedGradient } from "@/map/legend";

/**
 * The heatmap's ramp, sparse on the left. The ends carry no number on purpose: the
 * colour comes from deck.gl's aggregation of nearby cells, not from one cell's count,
 * so a figure at either end would claim a precision the picture does not have.
 */
export function DensityLegend({ tokens }: { tokens: ColorTokens }) {
  return (
    <div
      role="img"
      aria-label="Visits: less to more"
      className="bg-background/90 text-muted-foreground flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs shadow-sm backdrop-blur"
    >
      <span>Less</span>
      <div
        className="h-1.5 w-24 rounded-full"
        style={{ backgroundImage: steppedGradient(tokens.metricRamp) }}
      />
      <span>More</span>
    </div>
  );
}
