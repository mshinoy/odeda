import { useMemo } from "react";
import type { components } from "@/api/schema";
import { buildHistogramOption } from "@/charts/aggregate/buildHistogramOption";
import { EChart } from "@/charts/EChart";
import { useTokens } from "@/design/theme";
import { coverageNote, type HistogramSpec } from "@/features/trends/distributions";

type HistogramBucket = components["schemas"]["HistogramBucket"];

const CHART_HEIGHT = 160;

interface HistogramChartProps {
  buckets: readonly HistogramBucket[];
  spec: HistogramSpec;
  /** Everything the filter matched, so the caption can own up to what is not plotted. */
  sampleSize: number;
}

/** One distribution, under its label and the count of what is actually in it. */
export function HistogramChart({ buckets, spec, sampleSize }: HistogramChartProps) {
  const tokens = useTokens();
  const option = useMemo(
    () => buildHistogramOption({ buckets, spec, tokens }),
    [buckets, spec, tokens],
  );

  if (buckets.length === 0) return null;

  return (
    <figure className="flex flex-col gap-1">
      <figcaption className="text-muted-foreground flex items-baseline gap-2 text-xs">
        {spec.label}
        <span className="tabular-nums">{coverageNote(buckets, sampleSize)}</span>
      </figcaption>
      <EChart option={option} height={CHART_HEIGHT} />
    </figure>
  );
}
