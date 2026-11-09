import { useTokens } from "@/design/theme";
import type { EffortAnswer, PlanAnswer, Pill, RouteAnswer } from "@/features/activity/answers";
import type { ActivityKind } from "@/lib/activityKind";
import { cn } from "@/lib/utils";

const PILL_TONE: Record<Pill["tone"], string> = {
  good: "bg-status-good/15",
  warning: "bg-status-warning/20",
  serious: "bg-status-serious/20",
  critical: "bg-status-critical/15",
  neutral: "bg-muted",
};

// Static class names so Tailwind sees them; the colours themselves are tokens.
const FILL: Record<ActivityKind, string> = {
  run: "bg-kind-run",
  ride: "bg-kind-ride",
  swim: "bg-kind-swim",
  walk: "bg-kind-walk",
  strength: "bg-kind-strength",
  other: "bg-kind-other",
};

/** A verdict as a word in a tinted pill: the word always carries it, colour only helps. */
function PillTag({ pill }: { pill: Pill }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", PILL_TONE[pill.tone])}>
      {pill.text}
    </span>
  );
}

function Shell({
  label,
  pill,
  big,
  children,
}: {
  label: string;
  pill: Pill | null;
  big: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-card shadow-card flex min-w-0 flex-col gap-3 rounded-2xl border p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground text-xs">{label}</span>
        {pill && <PillTag pill={pill} />}
      </div>
      <span className="text-stat leading-tight font-semibold tracking-tight">{big}</span>
      {children}
    </section>
  );
}

/** How the activity went against the session the plan asked for. */
export function PlanCard({ answer, kind }: { answer: PlanAnswer; kind: ActivityKind }) {
  return (
    <Shell label={answer.label} pill={answer.pill} big={answer.big}>
      {answer.bar && (
        <div
          className="bg-muted relative h-2 rounded-full"
          role="img"
          aria-label={`${Math.round(answer.bar.fraction * 100)}% of the longest the plan asked`}
        >
          <div
            className={cn("h-full rounded-full", FILL[kind])}
            style={{ width: `${answer.bar.fraction * 100}%` }}
          />
          {answer.bar.marker !== null && (
            <div
              className="bg-foreground absolute -top-1 h-4 w-0.5"
              style={{ left: `${answer.bar.marker * 100}%` }}
            />
          )}
        </div>
      )}
      <p className="text-ink-secondary text-sm">{answer.detail}</p>
    </Shell>
  );
}

/** How this attempt did against the others on its route. */
export function RouteCard({ answer }: { answer: RouteAnswer }) {
  return (
    <Shell label={answer.label} pill={answer.pill} big={answer.big}>
      <ol className="flex items-start justify-between gap-2" aria-label="Attempts on this route">
        {answer.dots.map((dot) => (
          <li
            key={dot.label}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
          >
            <span
              className={cn(
                "rounded-full",
                dot.current ? "bg-kind-run size-3" : "bg-muted-foreground/50 size-2.5",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "text-xs",
                dot.current ? "text-foreground font-medium" : "text-muted-foreground",
              )}
            >
              {dot.label}
            </span>
            <span className={cn("text-sm tabular-nums", dot.current && "font-medium")}>
              {dot.time}
            </span>
          </li>
        ))}
      </ol>
    </Shell>
  );
}

/** How hard it was, by where the heart rate spent the time. */
export function EffortCard({ answer }: { answer: EffortAnswer }) {
  const tokens = useTokens();
  return (
    <Shell label={answer.label} pill={answer.pill} big={answer.big}>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label="Time in each heart-rate zone"
      >
        {answer.zones.map((share, i) =>
          share > 0 ? (
            <div
              key={i}
              style={{ width: `${share * 100}%`, background: tokens.hrZones[i] }}
              title={`Zone ${i + 1}: ${Math.round(share * 100)}%`}
            />
          ) : null,
        )}
      </div>
      <p className="text-ink-secondary text-sm">{answer.detail}</p>
    </Shell>
  );
}
