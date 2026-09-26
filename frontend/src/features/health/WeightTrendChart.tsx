import { useMemo } from "react";
import type { BodySeries } from "@/api/queries/useBody";
import { buildWeightTrendOption } from "@/charts/body/buildWeightTrendOption";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";

/** The trend, with the mornings it came from scattered faintly behind it. */
export function WeightTrendChart({ series }: { series: BodySeries }) {
  const tokens = useTokens();
  const option = useMemo(() => buildWeightTrendOption({ series, tokens }), [series, tokens]);

  return <HealthChart label="Weight" option={option} />;
}
