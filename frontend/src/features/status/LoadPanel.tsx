import { useMemo } from "react";
import type { TrainingLoad } from "@/api/queries/useStatus";
import { EChart } from "@/charts/EChart";
import { buildFitnessChartOption } from "@/charts/load/buildFitnessChartOption";
import { buildWeeklyLoadOption } from "@/charts/load/buildWeeklyLoadOption";
import { SectionCard } from "@/components/SectionCard";
import { StatCard } from "@/components/StatCard";
import { useTokens } from "@/design/theme";
import { formatDecimal, formatSigned } from "@/lib/format";

/** Fitness, fatigue and form now, their last four months, and load per week. */
export function LoadPanel({ load }: { load: TrainingLoad }) {
  const tokens = useTokens();
  const fitnessOption = useMemo(
    () => buildFitnessChartOption({ curve: load.curve, tokens }),
    [load.curve, tokens],
  );
  const weeklyOption = useMemo(
    () => buildWeeklyLoadOption({ weeks: load.weeks, tokens }),
    [load.weeks, tokens],
  );
  const current = load.current;

  return (
    <SectionCard title="Training load" question="How fit am I, how tired, and am I fresh or flat?">
      {current && (
        <div className="grid grid-cols-3 gap-6">
          <StatCard label="Fitness" value={formatDecimal(current.ctl)} />
          <StatCard label="Fatigue" value={formatDecimal(current.atl)} />
          <StatCard label="Form" value={formatSigned(current.tsb)} delta={current.form} />
        </div>
      )}
      <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">Fitness and fatigue</figcaption>
          <EChart option={fitnessOption} height={200} />
        </figure>
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">Weekly load</figcaption>
          <EChart option={weeklyOption} height={200} />
        </figure>
      </div>
    </SectionCard>
  );
}
