import { useState } from "react";
import { Link } from "react-router-dom";
import { useRacePacing } from "@/api/queries/usePlan";
import { EmptyState } from "@/components/EmptyState";
import { InfoPopover } from "@/components/InfoPopover";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { pacingRows, pacingText, parseTarget } from "@/features/race/pacingView";
import { formatDate, formatDuration, formatPace } from "@/lib/format";

type Strategy = "even" | "negative";

/**
 * The race, run on paper: a target time and a split for every kilometre, with the turns on
 * the course marked on the kilometre they fall in. Choose the finish range's fast, likely
 * or slow end, or type a time. The splits always add up to it.
 */
export function RacePage() {
  const [target, setTarget] = useState<number | null>(null);
  const [strategy, setStrategy] = useState<Strategy>("even");
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState(false);
  const [copied, setCopied] = useState(false);
  const pacing = useRacePacing(target, strategy);

  if (pacing.isPending) return <Skeleton className="mx-auto h-[40rem] max-w-4xl rounded-2xl" />;
  if (pacing.error) return <EmptyState message={pacing.error.message} />;
  const plan = pacing.data;
  if (plan.race === null) {
    return <EmptyState message="No race in the calendar yet. Add one with RACE in its title." />;
  }

  const rows = pacingRows(plan);
  const chosen = plan.target_s;
  const averagePace =
    chosen !== null && plan.race.distance_m ? chosen / (plan.race.distance_m / 1000) : null;

  const submitTyped = () => {
    const seconds = parseTarget(typed);
    setTypedError(seconds === null);
    if (seconds !== null) setTarget(seconds);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pacingText(plan));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link to="/status" className="text-muted-foreground hover:text-foreground w-fit text-sm">
          Back to Today
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Pacing plan</h1>
        <span className="text-muted-foreground text-sm">
          {plan.race.name} · {formatDate(plan.race.date)}
          {plan.race.start_local ? `, ${plan.race.start_local}` : ""}
        </span>
      </div>

      <SectionCard
        title="Target"
        question="What finish time am I running for, and how should the race be shaped?"
      >
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs">Finish</span>
            <ToggleGroup
              type="single"
              size="sm"
              value={plan.presets.find((p) => p.target_s === chosen)?.label ?? ""}
              aria-label="Target finish"
              onValueChange={(label) => {
                const preset = plan.presets.find((p) => p.label === label);
                if (preset) setTarget(preset.target_s);
              }}
            >
              {plan.presets.map((preset) => (
                <ToggleGroupItem key={preset.label} value={preset.label} className="px-3 text-xs">
                  {preset.label} {formatDuration(preset.target_s)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitTyped();
            }}
          >
            <label htmlFor="target" className="text-muted-foreground text-xs">
              Or type a time
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="target"
                value={typed}
                onChange={(event) => {
                  setTyped(event.target.value);
                  setTypedError(false);
                }}
                placeholder="3:30:00"
                inputMode="numeric"
                aria-invalid={typedError}
                className="w-28"
              />
              <Button type="submit" variant="outline" size="sm">
                Set
              </Button>
            </div>
            {typedError && (
              <span className="text-delta-bad text-xs">Use h:mm:ss, like 3:30:00.</span>
            )}
          </form>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground text-xs">Shape</span>
            <ToggleGroup
              type="single"
              size="sm"
              value={strategy}
              aria-label="Pacing shape"
              onValueChange={(next) => {
                if (next === "even" || next === "negative") setStrategy(next);
              }}
            >
              <ToggleGroupItem value="even" className="px-3 text-xs">
                Even
              </ToggleGroupItem>
              <ToggleGroupItem value="negative" className="px-3 text-xs">
                Negative
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </SectionCard>

      {rows.length === 0 ? (
        <EmptyState message="There is not enough running on record to project a finish. Type a target time above." />
      ) : (
        <SectionCard
          title="Kilometre by kilometre"
          question="What should each split be, and where do the turns slow me?"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div className="flex flex-col">
              <span className="text-stat font-semibold tracking-tight">
                {formatDuration(chosen)}
              </span>
              <span className="text-ink-secondary text-sm">
                {formatPace(averagePace)} on average
                {strategy === "negative" ? ", second half faster" : ", even after a gentle start"}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <InfoPopover
                title="How this is worked out"
                trigger={{ kind: "link", label: "How this is worked out" }}
              >
                <p>The splits add up to your target exactly, over the official 21.1 km.</p>
                <p>
                  The first kilometre is about 2% slower: the crowd, and legs that have not warmed
                  up. The rest is even. Choose Negative for a second half about 1% faster than the
                  first.
                </p>
                <p>
                  Each turn on the course costs about 5 seconds of slowing and getting going again,
                  added to the kilometre it falls in.
                </p>
                <p className="text-muted-foreground">
                  The plan is flat: a course file carries no hills, which is right for Doha and
                  wrong for most places. These are rules of thumb, not measurements.
                </p>
                <p className="text-muted-foreground">
                  {plan.course.source === "gpx"
                    ? "The turns come from the course file in your data folder. It was traced from the published map, so it is accurate to tens of metres and not surveyed."
                    : `There is no course file, so no turns are marked. Put a GPX at courses/${plan.race.date}.gpx in your data folder.`}
                </p>
              </InfoPopover>
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? "Copied" : "Copy as text"}
              </Button>
            </div>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left text-xs">
                <th className="py-2 pr-3 font-normal">Km</th>
                <th className="py-2 pr-3 text-right font-normal">Split</th>
                <th className="py-2 pr-3 text-right font-normal">Total</th>
                <th className="py-2 pr-3 text-right font-normal">Pace</th>
                <th className="py-2 font-normal">Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.km} className={row.note ? "bg-muted/50" : undefined}>
                  <td className="py-1.5 pr-3 font-medium tabular-nums">{row.km}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{row.split}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{row.total}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{row.pace}</td>
                  <td className="text-ink-secondary py-1.5">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      )}
    </div>
  );
}
