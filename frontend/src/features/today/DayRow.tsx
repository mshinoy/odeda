import { KindDot } from "@/features/today/KindDot";
import { daySummary, type DayView } from "@/features/today/todayView";
import { cn } from "@/lib/utils";

const TONE_TINT = {
  good: "bg-status-good/10",
  warning: "bg-status-warning/10",
  critical: "bg-status-critical/10",
} as const;

const TONE_TEXT = {
  good: "text-delta-good",
  warning: "text-foreground",
  critical: "text-delta-bad",
} as const;

function DayLabel({ day }: { day: DayView }) {
  return (
    <span className="text-muted-foreground text-sm">
      <span className={cn("text-foreground font-semibold")}>{day.weekday}</span> {day.date}
    </span>
  );
}

/**
 * A day of the week as one row: its sessions, and in words what became of each. A day
 * still to come shows only what it asks for; the tint and the word appear once something
 * has happened, so "To come" is not printed on every row.
 */
export function DayRow({ day }: { day: DayView }) {
  const tint = day.tone ? TONE_TINT[day.tone] : "";
  return (
    <div
      className={cn(
        "short:py-0.5 grid flex-1 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-1.5",
        tint,
        day.isToday && "bg-muted",
      )}
      aria-current={day.isToday ? "date" : undefined}
    >
      <DayLabel day={day} />
      {day.sessions.length === 0 ? (
        <span className="text-muted-foreground text-sm">Rest</span>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          {day.sessions.map((s, i) => (
            <div key={`${i}-${s.title}`} className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
                <KindDot kind={s.kind} className="shrink-0 self-center" />
                <span className="truncate" title={s.title}>
                  {s.title}
                </span>
              </span>
              {(s.outcome || s.target) && (
                <span
                  className={cn(
                    "shrink-0 text-xs",
                    day.tone && s.outcome ? TONE_TEXT[day.tone] : "text-muted-foreground",
                  )}
                >
                  {s.outcome || s.target}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A past day in one line: its weekday and what became of it. */
export function DayLine({ day }: { day: DayView }) {
  const tint = day.tone ? TONE_TINT[day.tone] : "";
  return (
    <div
      className={cn(
        "short:py-0.5 grid flex-1 grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-1",
        tint,
      )}
    >
      <DayLabel day={day} />
      <span
        className={cn(
          "text-sm font-medium",
          day.tone ? TONE_TEXT[day.tone] : "text-muted-foreground",
        )}
      >
        {daySummary(day)}
      </span>
    </div>
  );
}
