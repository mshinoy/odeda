import { useMemo } from "react";
import type { BodySeries } from "@/api/queries/useBody";
import {
  buildMassSplitOption,
  hasSplit,
  MASS_SERIES,
  massColors,
} from "@/charts/body/buildMassSplitOption";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";

/** Two lines in the same unit are not self-explanatory, so they carry a legend. */
function MassLegend() {
  const colors = massColors(useTokens());

  return (
    <span className="flex items-center gap-2">
      {MASS_SERIES.map(({ label }) => (
        <span key={label} className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ backgroundColor: colors[label] }} />
          {label}
        </span>
      ))}
    </span>
  );
}

/**
 * Fat mass against lean mass. Hidden when the scale never measured body fat, because
 * without it there is no split — only the weight line again, drawn twice.
 */
export function MassSplitChart({ series }: { series: BodySeries }) {
  const tokens = useTokens();
  const option = useMemo(() => buildMassSplitOption({ series, tokens }), [series, tokens]);
  if (!hasSplit(series)) return null;

  return <HealthChart label="Fat and lean mass, change" option={option} legend={<MassLegend />} />;
}
