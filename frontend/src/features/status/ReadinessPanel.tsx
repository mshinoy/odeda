import type { components } from "@/api/schema";
import { StatusDot } from "@/components/StatusDot";
import { bandDisplay, readinessParts, scoreWidthPct } from "@/features/status/readiness";
import { formatInteger } from "@/lib/format";

type Readiness = components["schemas"]["Readiness"];

/** Today's readiness: one big number, its band, the recommendation, then its four parts. */
export function ReadinessPanel({ readiness }: { readiness: Readiness }) {
  const band = readiness.band ? bandDisplay[readiness.band] : null;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-muted-foreground text-xs">Readiness</span>
        <div className="flex items-baseline gap-4">
          <span className="text-display font-semibold tracking-tight">
            {formatInteger(readiness.score)}
          </span>
          {band && (
            <span className="text-muted-foreground text-sm">
              <StatusDot tone={band.tone} label={band.label} />
            </span>
          )}
        </div>
        {readiness.recommendation && (
          <p className="text-ink-secondary text-base">{readiness.recommendation}</p>
        )}
      </div>

      <dl className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-x-3 gap-y-2 text-sm">
        {readinessParts(readiness).map((part) => (
          <ReadinessBar key={part.label} label={part.label} score={part.score} />
        ))}
      </dl>
    </section>
  );
}

function ReadinessBar({ label, score }: { label: string; score: number | null }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className="bg-foreground h-full rounded-full"
          style={{ width: `${scoreWidthPct(score)}%` }}
        />
      </dd>
      <dd className="text-right">{formatInteger(score)}</dd>
    </>
  );
}
