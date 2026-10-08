import { Link } from "react-router-dom";
import { KindBadge } from "@/components/KindBadge";
import type { ActivityCardView, CardStat } from "@/features/activities/cardView";
import { CardVisual } from "@/features/activities/CardVisual";

interface ActivityCardProps {
  card: ActivityCardView;
  /** Ticked for comparison. */
  selected: boolean;
  onSelect: (id: string) => void;
}

/**
 * One activity, landscape: its picture on the left, its numbers on the right. The whole
 * card opens it; the name is the link, stretched over the card.
 */
export function ActivityCard({ card, selected, onSelect }: ActivityCardProps) {
  return (
    <article className="bg-card hover:border-foreground/25 relative flex flex-col overflow-hidden rounded-xl border transition-colors sm:flex-row">
      <div className="bg-muted aspect-[4/3] w-full shrink-0 sm:aspect-auto sm:min-h-[180px] sm:w-[240px]">
        <CardVisual visual={card.visual} kind={card.kind} />
      </div>
      <div className="@container flex min-w-0 flex-1 flex-col gap-3 p-4">
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <Link
                to={card.href}
                className="focus-visible:after:ring-ring truncate font-medium after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset"
              >
                {card.name}
              </Link>
              {card.race && (
                <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-xs">
                  Race
                </span>
              )}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
              <KindBadge kind={card.kind} label={card.typeLabel} />
              <span aria-hidden>·</span>
              <span>{card.when}</span>
            </div>
          </div>
          {/* Above the card-wide link, so ticking a card does not open it. */}
          <input
            type="checkbox"
            className="accent-foreground relative z-10 mt-1 size-4 shrink-0"
            aria-label={`Compare ${card.name}`}
            checked={selected}
            onChange={() => onSelect(card.id)}
          />
        </header>
        {card.hero.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-4">
            {card.hero.map((stat) => (
              <HeroStat key={stat.label} stat={stat} />
            ))}
          </dl>
        )}
        {card.exercises.length > 0 && (
          <p className="truncate text-sm">{card.exercises.join(" · ")}</p>
        )}
        {card.details.length > 0 && (
          <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {card.details.map((stat) => (
              <div key={stat.label} className="flex gap-1">
                <dt>{stat.label}</dt>
                <dd className="text-foreground tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {card.notes && (
          <p className="text-muted-foreground line-clamp-1 text-xs italic">{card.notes}</p>
        )}
      </div>
    </article>
  );
}

function HeroStat({ stat }: { stat: CardStat }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-muted-foreground text-xs">{stat.label}</dt>
      <dd className="truncate text-lg font-semibold tracking-tight tabular-nums">{stat.value}</dd>
    </div>
  );
}
