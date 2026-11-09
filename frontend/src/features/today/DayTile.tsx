import { KindDot } from "@/features/today/KindDot";
import type { DayView } from "@/features/today/todayView";
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

/**
 * One day of a week: what it asked for, and in words what became of it. A day still to
 * come shows only its sessions; the tint and the word appear once something has happened,
 * so a grey "To come" is not printed seven times.
 */
export function DayTile({ day }: { day: DayView }) {
  const tint = day.tone ? TONE_TINT[day.tone] : "";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border border-transparent p-3",
        tint,
        day.isToday && "bg-muted border-border",
      )}
      aria-current={day.isToday ? "date" : undefined}
    >
      <div className="text-muted-foreground flex justify-between text-xs">
        <span className={cn(day.isToday && "text-foreground font-medium")}>{day.weekday}</span>
        <span className="tabular-nums">{day.date}</span>
      </div>
      {day.sessions.length === 0 ? (
        <span className="text-muted-foreground text-sm">Rest</span>
      ) : (
        day.sessions.map((s) => (
          <div key={s.title} className="flex flex-col gap-0.5">
            <span className="flex items-start gap-1.5 text-sm leading-snug font-medium">
              <KindDot kind={s.kind} className="mt-1.5" />
              <span className="line-clamp-2" title={s.title}>
                {s.title}
              </span>
            </span>
            {s.outcome && (
              <span
                className={cn(
                  "pl-3.5 text-xs",
                  day.tone ? TONE_TEXT[day.tone] : "text-muted-foreground",
                )}
              >
                {s.outcome}
              </span>
            )}
          </div>
        ))
      )}
    </div>
  );
}
