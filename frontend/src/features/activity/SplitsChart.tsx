import { useMemo } from "react";
import type { Split } from "@/api/adapters";
import { EChart } from "@/charts/EChart";
import { buildSplitsChartOption } from "@/charts/splits/buildSplitsChartOption";
import { useTokens } from "@/design/theme";
import type { ActivityKind } from "@/lib/activityKind";

const SPLITS_CHART_HEIGHT = 150;

export function SplitsChart({ splits, kind }: { splits: readonly Split[]; kind: ActivityKind }) {
  const tokens = useTokens();
  const option = useMemo(
    () => buildSplitsChartOption({ splits, kind, tokens }),
    [splits, kind, tokens],
  );
  return <EChart option={option} height={SPLITS_CHART_HEIGHT} />;
}
