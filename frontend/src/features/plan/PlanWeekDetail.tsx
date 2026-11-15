import { Link } from "react-router-dom";
import type {
  PlanSession,
  PlanUnplanned,
  PlanWeekDetail as WeekDetail,
} from "@/api/queries/usePlan";
import { Button } from "@/components/ui/button";
import { AddSession, ChangeSession } from "@/features/plan/PlanEditControls";
import { StatusDot } from "@/components/StatusDot";
import { linkCandidates, sportLabel, VERDICT_DISPLAY } from "@/features/plan/planView";
import { formatDate, formatDistance, formatWeekday } from "@/lib/format";

interface PlanWeekDetailProps {
  week: WeekDetail;
  onLink: (sessionId: number, activityId: string) => void;
  onIgnore: (sessionId: number) => void;
  onClear: (sessionId: number) => void;
  busy: boolean;
}

/** One week opened out: every prescribed day, what fulfilled it, and how to correct that. */
export function PlanWeekDetail({ week, onLink, onIgnore, onClear, busy }: PlanWeekDetailProps) {
  if (week.sessions.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-2 py-3">
        <p className="text-muted-foreground text-sm">Nothing prescribed this week.</p>
        <AddSession weekStart={week.start} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-2 py-3">
      {week.sessions.map((session) => (
        <SessionDetail
          key={session.day}
          session={session}
          unplanned={week.unplanned}
          onLink={onLink}
          onIgnore={onIgnore}
          onClear={onClear}
          busy={busy}
        />
      ))}
      <AddSession weekStart={week.start} />
      {week.unplanned.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Not asked for this week:{" "}
          {week.unplanned.map((a) => `${formatWeekday(a.day)} ${activityLabel(a)}`).join(", ")}
        </p>
      )}
    </div>
  );
}

interface SessionDetailProps {
  session: PlanSession;
  unplanned: readonly PlanUnplanned[];
  onLink: (sessionId: number, activityId: string) => void;
  onIgnore: (sessionId: number) => void;
  onClear: (sessionId: number) => void;
  busy: boolean;
}

function SessionDetail({
  session,
  unplanned,
  onLink,
  onIgnore,
  onClear,
  busy,
}: SessionDetailProps) {
  const verdict = VERDICT_DISPLAY[session.verdict];
  const sessionId = session.session_ids[0];
  const candidates = linkCandidates(session, unplanned);

  return (
    <div className="flex flex-col gap-1 border-l-2 pl-3 text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <span>
          <span className="text-muted-foreground">{formatWeekday(session.day)}</span>{" "}
          {session.title}
        </span>
        <span className="text-muted-foreground text-xs">
          {session.ignored ? "Ignored" : <StatusDot tone={verdict.tone} label={verdict.label} />}
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-baseline gap-x-3 text-xs">
        {session.planned_min_m !== null && (
          <span>asked {formatDistance(session.planned_min_m)}</span>
        )}
        {session.activity_id && (
          <Link to={`/activities/${session.activity_id}`} className="underline underline-offset-4">
            {formatDistance(session.actual_m)} on {formatDate(session.moved_from ?? session.day)}
          </Link>
        )}
        {session.moved_from && <span>not on the day it was asked for</span>}
        {session.original_day && <span>moved by you from {formatDate(session.original_day)}</span>}
        {session.own && <span>added by you</span>}
        {session.actual_sport && session.actual_sport !== session.sport && (
          <span>swapped for a {sportLabel(session.actual_sport)}</span>
        )}
      </div>

      <ChangeSession session={session} />

      {sessionId !== undefined && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {session.ignored ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onClear(sessionId)}>
              Count it again
            </Button>
          ) : (
            <>
              {candidates.map((activity) => (
                <Button
                  key={activity.activity_id}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => onLink(sessionId, activity.activity_id)}
                >
                  Link {formatWeekday(activity.day)} {activityLabel(activity)}
                </Button>
              ))}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onIgnore(sessionId)}>
                Ignore
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => onClear(sessionId)}>
                Let the matcher decide
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function activityLabel(activity: PlanUnplanned): string {
  return activity.distance_m ? formatDistance(activity.distance_m) : activity.activity_type;
}
