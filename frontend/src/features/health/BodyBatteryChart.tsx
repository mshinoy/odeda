import { useMemo } from "react";
import type { DailyRow } from "@/api/queries/useHealth";
import { bodyBatteryDays, buildBodyBatteryOption } from "@/charts/health/buildBodyBatteryOption";
import { resolutionFor, resolveRows } from "@/charts/health/resolution";
import { useTokens } from "@/design/theme";
import { HealthChart } from "@/features/health/HealthChart";

/** How far the battery charged and how far it ran down, each day. */
export function BodyBatteryChart({ rows }: { rows: readonly DailyRow[] }) {
  const tokens = useTokens();
  const option = useMemo(() => {
    const resolution = resolutionFor(rows.length);
    return buildBodyBatteryOption({ rows: resolveRows(rows, resolution), tokens, resolution });
  }, [rows, tokens]);

  if (!bodyBatteryDays(rows)) return null;

  return <HealthChart label="Body Battery" option={option} />;
}
