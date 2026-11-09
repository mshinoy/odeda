import type { RaceForecast } from "@/api/queries/usePlan";
import type { components } from "@/api/schema";
import { StatusDot } from "@/components/StatusDot";
import { ForecastWorking } from "@/features/today/ForecastWorking";
import { finishRange, morningForm, verdictShort } from "@/features/status/forecast";
import { formatDate, formatDays, formatDuration, formatSigned } from "@/lib/format";

type SummaryRace = components["schemas"]["SummaryRace"];

/** The race: how long, where the finish is likely to land, and how fresh you will be. */
export function RaceCard({ race, forecast }: { race: SummaryRace; forecast?: RaceForecast }) {
  const time = forecast?.time ?? null;
  const form = forecast?.form ?? null;
  const finish = time ? finishRange(time) : null;
  const warn = form?.verdict.level === "warning";

  return (
    <section className="bg-card shadow-card short:gap-2 short:p-5 flex flex-col gap-4 rounded-2xl border p-7">
      <span className="text-muted-foreground text-sm">{race.name}</span>
      <span className="flex items-baseline gap-3">
        <span className="text-3xl leading-tight font-semibold tracking-tight">
          {formatDays(race.days_to_go)}
        </span>
        <span className="text-muted-foreground text-sm">{formatDate(race.date)}</span>
      </span>

      {finish ? (
        <div className="flex flex-col gap-1 border-t pt-4">
          <span className="text-muted-foreground text-xs">Finish, likely range</span>
          <span className="text-2xl font-semibold tracking-tight">{finish.range}</span>
          <span className="text-ink-secondary text-sm">{finish.detail}</span>
        </div>
      ) : (
        race.projection && (
          <div className="flex flex-col gap-1 border-t pt-4">
            <span className="text-muted-foreground text-xs">Projected finish</span>
            <span className="text-2xl font-semibold tracking-tight">
              {formatDuration(race.projection.projected_seconds)}
            </span>
          </div>
        )
      )}

      {form && (
        <div className="mt-auto flex flex-col gap-0.5">
          <span className="text-ink-secondary text-sm">
            Race-morning form{" "}
            <span className="text-foreground font-semibold">
              {formatSigned(morningForm(form), 0)}
            </span>
          </span>
          <span className="text-muted-foreground text-sm">
            <StatusDot tone={warn ? "warning" : "good"} label={verdictShort(form)} />
          </span>
        </div>
      )}
      {forecast && <ForecastWorking forecast={forecast} />}
    </section>
  );
}
