import { useMemo } from "react";
import type { ReadinessPoint } from "@/api/queries/useHealth";
import { buildReadinessOption } from "@/charts/health/buildReadinessOption";
import { resolutionFor, resolveReadiness } from "@/charts/health/resolution";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";

/** The composite score behind the Status page, over the window. */
export function ReadinessChart({ series }: { series: readonly ReadinessPoint[] }) {
  const tokens = useTokens();
  const option = useMemo(() => {
    const resolution = resolutionFor(series.length);
    return buildReadinessOption({
      series: resolveReadiness(series, resolution),
      tokens,
      resolution,
    });
  }, [series, tokens]);

  if (series.every((point) => point.score === null)) return null;

  return <HealthChart label="Readiness" option={option} />;
}
