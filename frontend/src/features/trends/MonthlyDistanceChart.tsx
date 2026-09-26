import { useMemo } from "react";
import type { PeriodRow } from "@/api/queries/useAggregate";
import { buildMonthlyDistanceOption } from "@/charts/aggregate/buildMonthlyDistanceOption";
import { EChart } from "@/charts/EChart";
import { useTokens } from "@/design/theme";
import { toMonthPoints } from "@/features/trends/monthlySeries";

const CHART_HEIGHT = 200;

/** How far you went each month, with the months you did nothing left empty. */
export function MonthlyDistanceChart({ months }: { months: readonly PeriodRow[] }) {
  const tokens = useTokens();
  const points = useMemo(() => toMonthPoints(months), [months]);
  const option = useMemo(() => buildMonthlyDistanceOption({ points, tokens }), [points, tokens]);

  if (points.length === 0) return null;

  return <EChart option={option} height={CHART_HEIGHT} />;
}
