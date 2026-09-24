import { useTokens } from "@/design/theme";
import { metricColor } from "@/design/scales";
import {
  BODY_OUTLINE,
  BODY_VIEW_BOX,
  BODY_VIEW_LABELS,
  BODY_VIEWS,
  HEAD,
  MUSCLE_PATHS,
  type BodyView,
} from "@/features/activity/gym/bodyPaths";
import { MUSCLE_LABELS, type Muscle, type MuscleLoad } from "@/lib/muscles";

interface BodyDiagramProps {
  load: MuscleLoad;
  /** The busiest muscle's load; the shading is relative to it. */
  maxLoad: number;
  /** Muscles to outline, from the hovered exercise row or the hovered muscle. */
  highlighted: ReadonlySet<Muscle>;
  onHover: (muscle: Muscle | null) => void;
}

/**
 * Front and back, one path per muscle, shaded from the blue magnitude ramp by how much
 * of the session's work it took. A muscle the session never touched stays the body's
 * own neutral, so what stands out is what was trained.
 */
export function BodyDiagram({ load, maxLoad, highlighted, onHover }: BodyDiagramProps) {
  return (
    <div className="flex h-full items-center justify-center gap-6">
      {BODY_VIEWS.map((view) => (
        <BodyView
          key={view}
          view={view}
          load={load}
          maxLoad={maxLoad}
          highlighted={highlighted}
          onHover={onHover}
        />
      ))}
    </div>
  );
}

function BodyView({
  view,
  load,
  maxLoad,
  highlighted,
  onHover,
}: BodyDiagramProps & { view: BodyView }) {
  const tokens = useTokens();
  const muscles = Object.entries(MUSCLE_PATHS[view]) as [Muscle, string][];

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg
        viewBox={BODY_VIEW_BOX}
        className="h-[330px] w-auto"
        role="img"
        aria-label={`Muscles trained, ${BODY_VIEW_LABELS[view].toLowerCase()} view`}
      >
        <g fill={tokens.surfaceMuted} stroke={tokens.axis} strokeWidth={0.8} strokeLinejoin="round">
          <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} />
          {BODY_OUTLINE.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        {muscles.map(([muscle, d]) => {
          const value = load[muscle] ?? 0;
          const marked = highlighted.has(muscle);
          return (
            <path
              key={muscle}
              d={d}
              fill={
                value > 0 && maxLoad > 0
                  ? metricColor(tokens, value / maxLoad)
                  : tokens.surfaceMuted
              }
              stroke={marked ? tokens.ink : tokens.axis}
              strokeWidth={marked ? 1.8 : 0.8}
              strokeLinejoin="round"
              className="transition-[stroke,stroke-width] duration-150"
              onPointerEnter={() => onHover(muscle)}
              onPointerLeave={() => onHover(null)}
            >
              <title>{MUSCLE_LABELS[muscle]}</title>
            </path>
          );
        })}
      </svg>
      <figcaption className="text-muted-foreground text-xs">{BODY_VIEW_LABELS[view]}</figcaption>
    </figure>
  );
}
