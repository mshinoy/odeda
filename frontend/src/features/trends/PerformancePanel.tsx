import { useMemo } from "react";
import type { Performance } from "@/api/queries/usePerformance";
import { EChart } from "@/charts/EChart";
import { buildSessionTrendOption } from "@/charts/performance/buildSessionTrendOption";
import { buildVo2maxOption } from "@/charts/performance/buildVo2maxOption";
import { decouplingPoints, efficiencyPoints } from "@/charts/performance/performancePoints";
import { EmptyState } from "@/components/EmptyState";
import { useTokens } from "@/design/theme";
import { PersonalBestTable } from "@/features/trends/PersonalBestTable";
import { toPersonalBestRows } from "@/features/trends/personalBestRow";
import {
  formatDecimal,
  formatEfficiencyFactor,
  formatPercent,
  formatSigned,
  formatSignedPercent,
} from "@/lib/format";

const CHART_HEIGHT = 200;

/** Friel: past 5 % drift the aerobic base is not holding that intensity for that long. */
const DECOUPLING_LIMIT_PCT = 5;

/**
 * How you are running: your records, whether long runs hold together, how far each
 * heartbeat carries you, and Garmin's own estimate of the engine behind it.
 */
export function PerformancePanel({ performance }: { performance: Performance }) {
  const tokens = useTokens();

  const bestRows = useMemo(
    () => toPersonalBestRows(performance.personal_bests, performance.recent_bests_90d),
    [performance.personal_bests, performance.recent_bests_90d],
  );

  const decoupling = useMemo(
    () => decouplingPoints(performance.decoupling),
    [performance.decoupling],
  );
  const efficiency = useMemo(
    () => efficiencyPoints(performance.efficiency_trend, performance.decoupling),
    [performance.efficiency_trend, performance.decoupling],
  );

  const decouplingOption = useMemo(
    () =>
      buildSessionTrendOption({
        points: decoupling,
        tokens,
        formatValue: (value) => formatSignedPercent(value),
        formatTick: (value, isTopTick) =>
          isTopTick ? formatPercent(value) : formatSigned(value, 0),
        threshold: {
          value: DECOUPLING_LIMIT_PCT,
          label: formatPercent(DECOUPLING_LIMIT_PCT),
        },
      }),
    [decoupling, tokens],
  );

  const efficiencyOption = useMemo(
    () =>
      buildSessionTrendOption({
        points: efficiency,
        tokens,
        formatValue: formatEfficiencyFactor,
        formatTick: (value) => formatDecimal(value, 2),
      }),
    [efficiency, tokens],
  );

  const vo2maxOption = useMemo(
    () => buildVo2maxOption({ series: performance.vo2max, tokens }),
    [performance.vo2max, tokens],
  );

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-2">
        <h2 className="text-muted-foreground text-xs">Records</h2>
        {bestRows.length > 0 ? (
          <PersonalBestTable rows={bestRows} />
        ) : (
          <EmptyState message="No sample streams to take best efforts from." />
        )}
      </section>

      {decoupling.length > 0 && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">Aerobic decoupling</figcaption>
          <EChart option={decouplingOption} height={CHART_HEIGHT} />
        </figure>
      )}

      {efficiency.length > 0 && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">Efficiency factor</figcaption>
          <EChart option={efficiencyOption} height={CHART_HEIGHT} />
        </figure>
      )}

      {performance.vo2max.length > 0 && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">VO&#8322;max</figcaption>
          <EChart option={vo2maxOption} height={CHART_HEIGHT} />
        </figure>
      )}
    </div>
  );
}
