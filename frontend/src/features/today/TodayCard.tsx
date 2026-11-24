import type { components } from "@/api/schema";
import { StatusDot } from "@/components/StatusDot";
import { bandDisplay } from "@/features/status/readiness";
import type { Headline, SleepNight } from "@/features/today/todayView";
import { longRunNote, type LongRun } from "@/features/today/longRun";
import { recordedNights, sleepAverage, sleepBarHeights } from "@/features/today/todayView";
import { formatLongDate, formatWeekday, formatWithUnit } from "@/lib/format";

type Readiness = components["schemas"]["Readiness"];

interface TodayCardProps {
  day: string;
  headline: Headline;
  readiness: Readiness;
  nights: readonly SleepNight[];
  /** The last long run, when it was missed or cut short. */
  longRun?: LongRun | null;
  /** What the published plan calls for today, when one is on. */
  planCall?: string | null;
}

/** The page's answer: what to do today, how ready you are, and how you slept. */
export function TodayCard({
  day,
  headline,
  readiness,
  nights,
  longRun = null,
  planCall = null,
}: TodayCardProps) {
  const band = readiness.band ? bandDisplay[readiness.band] : null;
  const last = nights.at(-1);
  const heights = sleepBarHeights(nights);
  const average = sleepAverage(nights);
  const recorded = recordedNights(nights);

  return (
    <section className="bg-card shadow-card short:gap-3 short:p-5 flex flex-col gap-6 rounded-2xl border p-7">
      <span className="text-muted-foreground text-sm">{formatLongDate(day)}</span>
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">{headline.label}</span>
        <h1 className="text-3xl leading-tight font-semibold tracking-tight">{headline.title}</h1>
        {planCall && <p className="text-sm font-medium">{planCall}</p>}
        {readiness.recommendation && (
          <p className="text-ink-secondary max-w-md text-base">{readiness.recommendation}</p>
        )}
      </div>

      {longRun && <LongRunLine run={longRun} />}

      <div className="mt-auto flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Readiness</span>
          <span className="flex items-baseline gap-3">
            <span className="text-stat font-semibold">{Math.round(readiness.score ?? 0)}</span>
            {band && (
              <span className="text-muted-foreground text-sm">
                <StatusDot tone={band.tone} label={band.label} />
              </span>
            )}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">
            {last?.hours != null ? (
              <>
                Slept{" "}
                <span className="text-foreground font-medium">
                  {formatWithUnit(last.hours, "h", 1)}
                </span>
              </>
            ) : (
              "No sleep recorded"
            )}
            {average !== null && <> · average {formatWithUnit(average, "h", 1)}</>}
            {recorded < nights.length && (
              <>
                {" "}
                · {recorded} of {nights.length} nights recorded
              </>
            )}
          </span>
          <ul className="flex h-10 items-end gap-1.5" aria-label="Sleep, last seven nights">
            {nights.map((n, i) => {
              const h = heights[i];
              return (
                <li
                  key={n.day}
                  title={`${formatWeekday(n.day)} · ${n.hours === null ? "no sleep recorded" : formatWithUnit(n.hours, "h", 1)}`}
                  className="flex h-full w-3 items-end"
                >
                  {h === null ? (
                    <span className="border-border h-1 w-full rounded-sm border-t border-dashed" />
                  ) : (
                    <span
                      className="bg-foreground/70 w-full rounded-sm"
                      style={{ height: `${h}%` }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** The last long run, when it was missed or cut short: what it was, and what it costs. */
function LongRunLine({ run }: { run: LongRun }) {
  const note = longRunNote(run);
  return (
    <div className="flex flex-col gap-0.5 border-t pt-4 text-sm">
      <span className="font-medium">
        <StatusDot tone={note.tone} label={note.heading} />
      </span>
      <span className="text-ink-secondary">{note.detail}</span>
    </div>
  );
}
