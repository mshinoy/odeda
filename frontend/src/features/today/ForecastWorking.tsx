import type { RaceForecast } from "@/api/queries/usePlan";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { adjustmentNote } from "@/features/status/forecast";
import { formatDuration } from "@/lib/format";

/**
 * How the finish range and the race-morning form were worked out, behind a toggle: the
 * answer is on the card, and the working is here for whoever wants to check it.
 */
export function ForecastWorking({ forecast }: { forecast: RaceForecast }) {
  const { form, time } = forecast;
  if (!form && !time) return null;
  const note = time ? adjustmentNote(time) : null;

  return (
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
              {time.widened ? " The range is widened by the exponent band." : ""}
            </span>
            {note && <span>{note}</span>}
          </>
        )}
        {form && (
          <span>
            {Math.round(form.planned_km_remaining)} km still planned, priced at{" "}
            {form.load_per_km.toFixed(1)} load per km
            {form.km_done_pct !== null
              ? `, the likely line at your recent ${Math.round(form.km_done_pct)}% of the plan's kilometres`
              : ""}
            .
          </span>
        )}
        {[...(time?.caveats ?? []), ...(form?.caveats ?? [])].map((c) => (
          <span key={c}>{c}</span>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
