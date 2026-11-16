import { useState, type FormEvent } from "react";
import {
  useBasics,
  useChangePassword,
  useSaveBasics,
  useSetup,
  type Basics,
} from "@/api/queries/useBasics";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  browserTimeZone,
  knownTimeZones,
  parseHeartRates,
  passwordProblem,
  savedLine,
} from "@/features/settings/basicsSummary";

/**
 * The few settings every install has to get right, so nobody edits `.env` for them.
 * Heart rate drives every training-load number and the time zone decides what "today"
 * is; both used to be environment variables only, and a wrong one showed up later as
 * numbers that looked slightly off.
 */
export function BasicsPanel() {
  const basics = useBasics();
  return (
    <SectionCard title="Basics" question="What do the numbers assume?">
      {basics.isPending && <Skeleton className="h-32 w-full" />}
      {basics.error && <p className="text-delta-bad text-sm">{basics.error.message}</p>}
      {/* Keyed on the saved values so the form restarts from them after a save. */}
      {basics.data && (
        <BasicsForm
          key={`${basics.data.timezone}|${basics.data.hr_rest}|${basics.data.hr_max}`}
          basics={basics.data}
        />
      )}
    </SectionCard>
  );
}

function BasicsForm({ basics }: { basics: Basics }) {
  const save = useSaveBasics();
  const [timezone, setTimezone] = useState(basics.timezone);
  const [rest, setRest] = useState(String(basics.hr_rest));
  const [max, setMax] = useState(String(basics.hr_max));
  const [problem, setProblem] = useState<string | null>(null);
  const zones = knownTimeZones();
  const browserZone = browserTimeZone();

  function submit(event: FormEvent) {
    event.preventDefault();
    const rates = parseHeartRates(rest, max);
    if ("error" in rates) {
      setProblem(rates.error);
      return;
    }
    setProblem(null);
    save.mutate({ timezone: timezone.trim(), hr_rest: rates.rest, hr_max: rates.max });
  }

  const atDefaults =
    timezone === basics.timezone_default &&
    rest === String(basics.hr_rest_default) &&
    max === String(basics.hr_max_default);

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="basics-tz">Time zone</Label>
        <Input
          id="basics-tz"
          list="basics-tz-list"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          autoComplete="off"
        />
        <datalist id="basics-tz-list">
          {zones.map((zone) => (
            <option key={zone} value={zone} />
          ))}
        </datalist>
        <p className="text-muted-foreground text-xs">
          Decides what “today” is: the countdown, the streak, this week.
          {browserZone && browserZone !== timezone && (
            <>
              {" "}
              <button
                type="button"
                className="text-foreground underline"
                onClick={() => setTimezone(browserZone)}
              >
                Use this browser’s ({browserZone})
              </button>
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="basics-rest">Resting heart rate</Label>
          <Input
            id="basics-rest"
            inputMode="numeric"
            value={rest}
            onChange={(e) => setRest(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="basics-max">Maximum heart rate</Label>
          <Input
            id="basics-max"
            inputMode="numeric"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </div>
      </div>
      <p className="text-muted-foreground -mt-2 text-xs">
        Every training-load number is worked out from these. Changing them recomputes the stored
        load for all your activities.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {!atDefaults && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setTimezone(basics.timezone_default);
              setRest(String(basics.hr_rest_default));
              setMax(String(basics.hr_max_default));
            }}
          >
            Back to the defaults
          </Button>
        )}
      </div>
      {problem && <p className="text-delta-bad text-sm">{problem}</p>}
      {save.error && <p className="text-delta-bad text-sm">{save.error.message}</p>}
      {save.data && <p className="text-sm">{savedLine(save.data)}</p>}
    </form>
  );
}

/** Choose or change the password. The current one is asked for whenever one exists. */
export function PasswordPanel() {
  const setup = useSetup();
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const hasPassword = setup.data?.password_set === true;
  const problem = next === "" ? null : passwordProblem(next, confirm);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (passwordProblem(next, confirm) !== null) return;
    change.mutate(
      { current, new: next },
      {
        // None of the three is needed again, whichever way it went.
        onSettled: () => {
          setCurrent("");
          setNext("");
          setConfirm("");
        },
        onSuccess: () => setDone(true),
      },
    );
  }

  return (
    <SectionCard title="Password" question="Who can open this?">
      {setup.isPending && <Skeleton className="h-24 w-full" />}
      {setup.data && (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
          {!hasPassword && (
            <p className="text-delta-bad text-sm">
              No password is set, so anyone who can reach this page can read your data. Choose one
              before you expose the port.
            </p>
          )}
          {hasPassword && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-new">{hasPassword ? "New password" : "Password"}</Label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => {
                setNext(e.target.value);
                setDone(false);
              }}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pw-confirm">Again</Label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={change.isPending || next === "" || problem !== null}>
              {hasPassword ? "Change password" : "Set password"}
            </Button>
          </div>
          {problem && <p className="text-muted-foreground text-xs">{problem}</p>}
          {change.error && <p className="text-delta-bad text-sm">{change.error.message}</p>}
          {done && (
            <p className="text-sm">
              Saved. Other browsers are signed out; this one stays signed in.
            </p>
          )}
        </form>
      )}
    </SectionCard>
  );
}
