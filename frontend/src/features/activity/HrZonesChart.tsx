import { useMemo } from "react";
import type { HrZoneTime } from "@/api/adapters";
import { EChart } from "@/charts/EChart";
import { buildHrZonesOption, HR_ZONES_CHART_HEIGHT } from "@/charts/hrZones/buildHrZonesOption";
import { useTokens } from "@/design/theme";

export function HrZonesChart({ zones }: { zones: readonly HrZoneTime[] }) {
  const tokens = useTokens();
  const option = useMemo(() => buildHrZonesOption({ zones, tokens }), [zones, tokens]);
  return <EChart option={option} height={HR_ZONES_CHART_HEIGHT} />;
}
