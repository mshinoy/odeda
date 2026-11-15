import { SectionCard } from "@/components/SectionCard";
import { useState } from "react";
import {
  useClearPlanLink,
  useClearPlanSource,
  usePlan,
  useSetPlanSource,
  useSetPlanStart,
  useSyncPlan,
} from "@/api/queries/usePlan";
import { useAutoSync } from "@/api/queries/useStatus";
import { StatusDot } from "@/components/StatusDot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  decisionLine,
  feedStatus,
  planAutoSyncProblem,
  planSyncSummary,
  unreadableLine,
} from "@/features/settings/planSummary";
import { formatDate } from "@/lib/format";

/**
 * The training calendar: its address, what the parser made of it, and the decisions
 * the owner has made by hand.
 *
 * **The address is a credential.** It grants read access to the whole calendar to
 * anyone holding it, so it goes in and is never shown again: everything here reads the
 * masked form the API returns.
 */
export function PlanPanel() {
  const plan = usePlan();
  const auto = useAutoSync();
  const setSource = useSetPlanSource();
  const clearSource = useClearPlanSource();
  const sync = useSyncPlan();
  const unlink = useClearPlanLink();
  const setStart = useSetPlanStart();
  const [url, setUrl] = useState("");
  const [startDay, setStartDay] = useState<string | null>(null);

  const running = auto.data?.running ?? false;
  const status = plan.data ? feedStatus(plan.data) : null;
  const unreadable = plan.data ? unreadableLine(plan.data) : null;
  const autoProblem = auto.data ? planAutoSyncProblem(auto.data) : null;

  return (
    <SectionCard title="Training plan" question="Where the plan comes from.">
      {plan.isPending && <Skeleton className="h-24 w-full" />}
      {plan.error && <p className="text-delta-bad text-sm">{plan.error.message}</p>}

      {plan.data && !plan.data.subscribed && (
        <div className="flex w-full flex-col gap-3">
          <StatusDot tone="neutral" label="No calendar subscribed. Nothing is prescribed." />
          <p className="text-muted-foreground text-sm">
            In Google Calendar, open the settings for that calendar and copy “Secret address in iCal
            format”. It is a credential: anyone holding it can read the whole calendar.
          </p>
          <SourceForm
            url={url}
            setUrl={setUrl}
            busy={setSource.isPending}
            onSubmit={() => setSource.mutate({ url: url.trim() }, { onSuccess: () => setUrl("") })}
            label="Subscribe"
          />
          {setSource.error && <p className="text-delta-bad text-sm">{setSource.error.message}</p>}
        </div>
      )}

      {plan.data?.subscribed && plan.data.source && status && (
        <div className="flex w-full flex-col gap-3 rounded-lg border p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <StatusDot tone={status.tone} label={status.text} />
              <p className="text-muted-foreground text-xs break-all">
                {plan.data.source.label ?? "Calendar"} · {plan.data.source.url_masked}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={sync.isPending || running}
                onClick={() => sync.mutate()}
              >
                {sync.isPending || running ? "Syncing…" : "Sync now"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={clearSource.isPending}
                onClick={() => clearSource.mutate()}
              >
                Remove
              </Button>
            </div>
          </div>

          {sync.data && (
            <p className="text-muted-foreground text-sm" role="status">
              {planSyncSummary(sync.data)}
            </p>
          )}
          {sync.error && <p className="text-delta-bad text-sm">{sync.error.message}</p>}
          {autoProblem && <StatusDot tone="warning" label={autoProblem} />}

          <div className="flex flex-col gap-2 pt-1">
            <p className="text-muted-foreground text-xs">
              Replace the address — Google issues a new one whenever it is reset.
            </p>
            <SourceForm
              url={url}
              setUrl={setUrl}
              busy={setSource.isPending}
              onSubmit={() =>
                setSource.mutate({ url: url.trim() }, { onSuccess: () => setUrl("") })
              }
              label="Replace"
            />
            {setSource.error && <p className="text-delta-bad text-sm">{setSource.error.message}</p>}
          </div>

          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-sm">Plan starts</p>
            <p className="text-muted-foreground text-xs">
              Sessions before this day are left out of every figure — adherence, weekly kilometres
              and the race targets. Set it when a block begins to start the plan over. Clear it to
              use the whole calendar, which counts any long-standing repeating event as far back as
              it goes.
            </p>
            <div className="flex gap-2">
              <Input
                aria-label="Plan start day"
                type="date"
                value={startDay ?? plan.data.source.start_day ?? ""}
                onChange={(event) => setStartDay(event.target.value)}
              />
              <Button
                size="sm"
                disabled={setStart.isPending || (startDay ?? "") === ""}
                onClick={() => setStart.mutate(startDay ?? null)}
              >
                Set
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={setStart.isPending || plan.data.source.start_day == null}
                onClick={() => setStart.mutate(null, { onSuccess: () => setStartDay(null) })}
              >
                Clear
              </Button>
            </div>
            {setStart.error && <p className="text-delta-bad text-sm">{setStart.error.message}</p>}
          </div>
        </div>
      )}

      {plan.data && plan.data.unreadable.length > 0 && (
        <div className="flex w-full flex-col gap-2 rounded-lg border p-4">
          <StatusDot tone="warning" label={unreadable ?? ""} />
          <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
            {plan.data.unreadable.map((entry) => (
              <li key={entry.id}>
                {formatDate(entry.day)} · {entry.title ?? "untitled"} ·{" "}
                {entry.parse_status === "unsupported_rrule"
                  ? "a repeat rule this cannot expand"
                  : "no distance or sport found in it"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.data && plan.data.decisions.length > 0 && (
        <div className="flex w-full flex-col gap-2 rounded-lg border p-4">
          <p className="text-sm">Matches you set by hand</p>
          <p className="text-muted-foreground text-xs">
            Everything else is recomputed on every read, so a retyped activity moves its match with
            it. These two do not.
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {plan.data.decisions.map((decision) => (
              <li
                key={decision.plan_session_id}
                className="flex items-baseline justify-between gap-4"
              >
                <span className="text-muted-foreground truncate text-xs">
                  {decisionLine(decision)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(decision.plan_session_id)}
                >
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

interface SourceFormProps {
  url: string;
  setUrl: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  label: string;
}

function SourceForm({ url, setUrl, onSubmit, busy, label }: SourceFormProps) {
  return (
    <div className="flex gap-2">
      <Input
        aria-label="Calendar iCal address"
        type="password"
        placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
      />
      <Button size="sm" disabled={busy || url.trim() === ""} onClick={onSubmit}>
        {label}
      </Button>
    </div>
  );
}
