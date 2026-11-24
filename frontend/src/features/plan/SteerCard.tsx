import type { Plan, PlanSteer } from "@/api/queries/usePlan";
import { NamedPlanBadge } from "@/features/plan/NamedPlanBadge";
import { StatCard } from "@/components/StatCard";
import {
  keySessionLine,
  raceLine,
  riskText,
  standingLine,
  standingTitle,
  standingTone,
  type StandingTone,
} from "@/features/plan/steerView";
import { formatDecimal, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE_DOT: Record<StandingTone, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  neutral: "bg-muted-foreground",
};

/**
 * The page's answer: will this plan get me to the race in shape, and what is at risk.
 * The standing is a word beside a dot, never colour alone; red is reserved for "well
 * behind", which is a fact about kilometres and not a verdict on the owner.
 */
export function SteerCard({ steer, plan }: { steer: PlanSteer; plan: Plan }) {
  const tone = standingTone(steer.standing);
  const race = raceLine(steer.race);
  const key = keySessionLine(steer.key_session);
  const peak = plan.targets.peak_weekly_km;

  return (
    <section className="bg-card shadow-card flex flex-col gap-6 rounded-2xl border p-7">
      {plan.named_plan && <NamedPlanBadge plan={plan.named_plan} plain />}
      <div className="flex flex-col gap-2">
        {race && <span className="text-muted-foreground text-sm">{race}</span>}
        <h1 className="flex items-center gap-3 text-3xl leading-tight font-semibold tracking-tight">
          <span className={cn("size-3 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
          {standingTitle(steer.standing)}
        </h1>
        <p className="text-ink-secondary max-w-xl text-base">{standingLine(steer)}</p>
      </div>

      {steer.risks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {steer.risks.map((risk) => (
            <li key={risk.code} className="bg-muted/60 rounded-xl px-4 py-3 text-sm">
              {riskText(risk)}
            </li>
          ))}
        </ul>
      )}

      {key && (
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">The session that matters this week</span>
          <span className="text-base font-medium">{key}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <StatCard label="Adherence, 4 weeks" value={formatPercent(plan.adherence_4wk)} />
        <StatCard label="Peak week" value={peak === null ? "—" : `${formatDecimal(peak)} km`} />
        <StatCard
          label="Fitness it implies"
          value={plan.targets.ctl_target === null ? "—" : formatDecimal(plan.targets.ctl_target)}
          delta={plan.targets.ctl_target === null ? undefined : "derived from your own pace"}
        />
      </div>
    </section>
  );
}
