import { useMemo } from "react";
import type { RaceForecast } from "@/api/queries/usePlan";
import { EChart } from "@/charts/EChart";
import { buildFormForecastOption } from "@/charts/load/buildFormForecastOption";
import { StatCard } from "@/components/StatCard";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTokens } from "@/design/theme";
import { adjustmentNote, finishRange, morningForm, verdictShort } from "@/features/status/forecast";
import { formatDate, formatDuration, formatSigned } from "@/lib/format";

interface ForecastPanelProps {
  forecast: RaceForecast;
}

/**
 * The race, looked at from the other end: the finish range it points to, and how fresh
 * the remaining plan leaves you. Two numbers and one line; the working is behind a
 * toggle, because the answer is what is wanted.
 */
export function ForecastPanel({ forecast }: ForecastPanelProps) {
  const tokens = useTokens();
  const { form, time } = forecast;
  const option = useMemo(
    () => (form ? buildFormForecastOption({ curve: form.curve, tokens }) : null),
    [form, tokens],
  );
  if (!form && !time) return null;

  const finish = time ? finishRange(time) : null;
  const note = time ? adjustmentNote(time) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-6">
        {finish && <StatCard label="Finish" value={finish.range} delta={finish.detail} />}
        {form && (
          <StatCard
            label="Form on race morning"
            value={formatSigned(morningForm(form), 0)}
            delta={verdictShort(form)}
            deltaTone={form.verdict.level === "good" ? "good" : "bad"}
          />
        )}
      </div>
      {form && option && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">
            Form to {formatDate(form.race_morning.day)}
            {form.basis === "followed" ? " · dashed, every session as written" : ""}
          </figcaption>
          <EChart option={option} height={140} />
        </figure>
      )}
      <Collapsible>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground text-xs underline-offset-4 hover:underline">
          How this is worked out
        </CollapsibleTrigger>
        <CollapsibleContent className="text-muted-foreground flex flex-col gap-2 pt-3 text-xs">
          {form && <span>{form.verdict.text}</span>}
          {time && (
            <>
              <span>
                Projected from {time.sources.length === 1 ? "one effort" : "your recent efforts"}:{" "}
                {time.sources
                  .map((s) => `${s.label ?? ""} ${formatDuration(s.seconds)}`.trim())
                  .join(", ")}
                . Unadjusted {formatDuration(time.raw.fast)} – {formatDuration(time.raw.slow)}.
                {time.widened
                  ? " Efforts agree closely, so the range is widened to allow for it."
                  : ""}
              </span>
              {note && <span>{note}</span>}
            </>
          )}
          {form && (
            <span>
              {Math.round(form.planned_km_remaining)} km still planned, priced at{" "}
              {form.load_per_km.toFixed(1)} load per km
              {form.km_done_pct !== null
                ? `, the solid line at your recent ${Math.round(form.km_done_pct)}% of the plan's kilometres`
                : ""}
              .
            </span>
          )}
          {[...(time?.caveats ?? []), ...(form?.caveats ?? [])].map((c) => (
            <span key={c}>{c}</span>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
