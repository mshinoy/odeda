import type { PlanSession } from "@/api/queries/usePlan";
import { StatusDot } from "@/components/StatusDot";
import type { CalendarDay } from "@/features/plan/planView";
import { sessionLabel, VERDICT_DISPLAY } from "@/features/plan/planView";
import { formatDistance } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The tint behind a cell. Always paired with the verdict's word — never colour alone. */
const TONE_TINT: Record<string, string> = {
  good: "bg-status-good/10",
  warning: "bg-status-warning/10",
  serious: "bg-status-serious/10",
  critical: "bg-status-critical/10",
  neutral: "",
};

interface PlanDayCellProps {
  day: CalendarDay;
  onOpen: () => void;
}

/**
 * One day of the block: what was asked for, what happened, and the verdict in words.
 *
 * A day still to come shows its prescription and no verdict. Printing "To come" on
 * every future cell says nothing fourteen times a fortnight, and the grey would read as
 * a judgement rather than an absence of one.
 */
export function PlanDayCell({ day, onOpen }: PlanDayCellProps) {
  const empty = day.sessions.length === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={empty}
      aria-label={day.date}
      className={cn(
        "flex min-h-24 flex-col gap-1 rounded-md border p-2 text-left transition-colors",
        empty ? "border-dashed" : "hover:bg-muted/50",
        day.isToday && "ring-ring ring-2",
      )}
    >
      {/* The weekday lives in the sticky header, not repeated 147 times down the page. */}
      <span
        className={cn(
          "text-muted-foreground text-right text-[0.65rem] tabular-nums",
          day.isToday && "text-foreground font-medium",
        )}
      >
        {Number(day.date.slice(8, 10))}
      </span>

      {empty ? (
        <span className="text-muted-foreground/50 grow text-center text-sm">—</span>
      ) : (
        day.sessions.map((session) => (
          <DaySession key={session.session_ids[0] ?? session.title} session={session} />
        ))
      )}
    </button>
  );
}

function DaySession({ session }: { session: PlanSession }) {
  const verdict = VERDICT_DISPLAY[session.verdict];
  const prescribed = describePrescription(session);
  // A future day carries no verdict, so it carries no tint either.
  const tint = session.verdict === "upcoming" ? "" : TONE_TINT[verdict.tone];

  return (
    <span className={cn("flex flex-col gap-0.5 rounded px-1 py-0.5 text-xs", tint)}>
      {/* Wrapped, not truncated: "Katara Hills - ..." and "Lusail Track - ..." are the
          same ellipsis, and which one a Tuesday asks for is the point of the cell. */}
      <span className="line-clamp-2 font-medium" title={session.title}>
        {session.title.trim() || sessionLabel(session)}
      </span>
      {prescribed && <span className="text-muted-foreground">{prescribed}</span>}

      {session.ignored ? (
        <span className="text-muted-foreground">Ignored</span>
      ) : session.verdict === "upcoming" ? null : (
        <StatusDot tone={verdict.tone} label={verdict.label} />
      )}

      {session.actual_m !== null && (
        <span className="text-muted-foreground">
          {formatDistance(session.actual_m)}
          {/* The data knows a session was moved and the old table never said so. */}
          {session.moved_from && " · moved"}
        </span>
      )}
    </span>
  );
}

/** "16 km", "8–10 km", or nothing at all for a session measured in neither. */
function describePrescription(session: PlanSession): string | null {
  const { planned_min_m: lo, planned_max_m: hi } = session;
  if (lo === null) return null;
  if (hi !== null && hi !== lo) return `${formatDistance(lo)}–${formatDistance(hi)}`;
  return formatDistance(lo);
}
