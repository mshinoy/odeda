import { useMemo } from "react";
import type { BodySeries } from "@/api/queries/useBody";
import { buildFatPctOption, hasFatPct } from "@/charts/body/buildFatPctOption";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";

/**
 * Body fat as a percentage. Hidden when the scale never reported one — on this account
 * that is every weigh-in before October 2021.
 */
export function FatPctChart({ series }: { series: BodySeries }) {
  const tokens = useTokens();
  const option = useMemo(() => buildFatPctOption({ series, tokens }), [series, tokens]);
  if (!hasFatPct(series)) return null;

  return <HealthChart label="Body fat" option={option} />;
}
