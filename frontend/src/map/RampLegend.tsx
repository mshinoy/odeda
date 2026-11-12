import type { ColorTokens } from "@/design/tokens";
import { steppedGradient } from "@/map/legend";

interface RampLegendProps {
  /** What the low end of the ramp reads, already formatted. */
  low: string;
  high: string;
  /** Read out with the two ends for screen readers, e.g. "Pace". */
  label: string;
  tokens: ColorTokens;
  /** The colours to draw; the route ramp unless a map says otherwise. */
  ramp?: readonly string[];
}

/** The magnitude ramp with a value at each end, low on the left. Every map's legend. */
export function RampLegend({ low, high, label, tokens, ramp }: RampLegendProps) {
  return (
    <div
      role="img"
      aria-label={`${label}: ${low} to ${high}`}
      className="bg-background/90 text-muted-foreground flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur"
    >
      <span>{low}</span>
      <div
        className="h-1.5 w-24 rounded-full"
        style={{ backgroundImage: steppedGradient(ramp ?? tokens.routeRamp) }}
      />
      <span>{high}</span>
    </div>
  );
}
