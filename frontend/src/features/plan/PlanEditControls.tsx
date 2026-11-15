import { useState } from "react";
import {
  useAddPlanSession,
  useClearPlanEdit,
  useEditPlanSession,
  useRemovePlanSession,
  type PlanSession,
} from "@/api/queries/usePlan";
import { NativeSelect } from "@/components/NativeSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OWN_SPORTS, parseKm, weekDays } from "@/features/plan/planEdit";
import { formatDate, formatWeekday } from "@/lib/format";

/**
 * Change one session: move it to another day or ask for a different distance, undo that,
 * or (for a session you added) take it away. The calendar is never written to: the
 * change is kept here, on top of it, and a sync leaves it alone.
 */
export function ChangeSession({ session }: { session: PlanSession }) {
  const sessionId = session.session_ids[0];
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(session.day);
  const [km, setKm] = useState(
    session.planned_min_m === null ? "" : String(session.planned_min_m / 1000),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const edit = useEditPlanSession();
  const clear = useClearPlanEdit();
  const remove = useRemovePlanSession();
  const busy = edit.isPending || clear.isPending || remove.isPending;
  if (sessionId === undefined) return null;

  const save = () => {
    const parsed = parseKm(km);
    if ("error" in parsed) return setProblem(parsed.error);
    setProblem(null);
    edit.mutate({ sessionId, day, distanceM: parsed.metres }, { onSuccess: () => setOpen(false) });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {session.own ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => remove.mutate(sessionId)}
          >
            Remove my session
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Move or change"}
          </Button>
        )}
        {session.edited && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => clear.mutate(sessionId)}>
            Undo my change
          </Button>
        )}
      </div>
      {open && !session.own && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Day</span>
            <Input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="w-auto"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Distance, km</span>
            <Input
              inputMode="decimal"
              value={km}
              onChange={(e) => setKm(e.target.value)}
              className="w-24"
              placeholder="as planned"
            />
          </label>
          <Button size="sm" disabled={busy} onClick={save}>
            Save
          </Button>
        </div>
      )}
      {(problem || edit.error) && (
        <p className="text-destructive text-xs">{problem ?? edit.error?.message}</p>
      )}
    </div>
  );
}

/** Add a session of your own to the opened week. */
export function AddSession({ weekStart }: { weekStart: string }) {
  const days = weekDays(weekStart);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(days[0] ?? weekStart);
  const [sport, setSport] = useState("running");
  const [km, setKm] = useState("");
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = useAddPlanSession();

  if (!open) {
    return (
      <Button size="sm" variant="outline" className="self-start" onClick={() => setOpen(true)}>
        Add a session
      </Button>
    );
  }

  const submit = () => {
    const parsed = parseKm(km);
    if ("error" in parsed) return setProblem(parsed.error);
    setProblem(null);
    add.mutate(
      { day, sport, distance_m: parsed.metres, title: title.trim() || null },
      {
        onSuccess: () => {
          setOpen(false);
          setKm("");
          setTitle("");
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Day</span>
          <NativeSelect value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>
                {formatWeekday(d)} {formatDate(d)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">What</span>
          <NativeSelect value={sport} onChange={(e) => setSport(e.target.value)}>
            {OWN_SPORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Distance, km</span>
          <Input
            inputMode="decimal"
            value={km}
            onChange={(e) => setKm(e.target.value)}
            className="w-24"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">Name (optional)</span>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="w-44" />
        </label>
        <Button size="sm" disabled={add.isPending} onClick={submit}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {(problem || add.error) && (
        <p className="text-destructive text-xs">{problem ?? add.error?.message}</p>
      )}
    </div>
  );
}
