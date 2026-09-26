import { useMemo } from "react";
import type { BodyComposition } from "@/api/queries/useBody";
import { EChart } from "@/charts/EChart";
import { buildPowerToWeightOption } from "@/charts/body/buildPowerToWeightOption";
import {
  buildSpeedWeightOption,
  indexColors,
  INDEX_SERIES,
} from "@/charts/body/buildSpeedWeightOption";
import { buildWeightAgainstLoadOptions } from "@/charts/body/buildWeightAgainstLoadOptions";
import { useTokens } from "@/design/theme";

const CHART_HEIGHT = 160;

/** Speed and weight are two percentages of the same starting week; say which is which. */
function IndexLegend() {
  const colors = indexColors(useTokens());

  return (
    <span className="flex items-center gap-2">
      {INDEX_SERIES.map(({ label }) => (
        <span key={label} className="flex items-center gap-1">
          <span className="size-2 rounded-full" style={{ backgroundColor: colors[label] }} />
          {label}
        </span>
      ))}
    </span>
  );
}

/**
 * What bodyweight did to the training, and what the training did to bodyweight.
 *
 * Here rather than on Health because both of these need the activity data, and it is on
 * this page (D6). Each chart hides itself when it has nothing: no weigh-ins, no rides
 * with a power meter, or fewer than two weeks of runs to index against.
 */
export function BodyPerformancePanel({ body }: { body: BodyComposition }) {
  const tokens = useTokens();

  const load = useMemo(
    () => buildWeightAgainstLoadOptions({ points: body.against_load, tokens }),
    [body.against_load, tokens],
  );
  const speed = useMemo(
    () => buildSpeedWeightOption({ points: body.speed_vs_weight, tokens }),
    [body.speed_vs_weight, tokens],
  );
  const power = useMemo(
    () => buildPowerToWeightOption({ points: body.power_to_weight, tokens }),
    [body.power_to_weight, tokens],
  );

  if (!body.has_data) return null;

  return (
    <div className="flex flex-col gap-12">
      {/*
        Two panels over one day axis rather than two lines on one chart: kilograms and
        CTL are not the same quantity, and the only way to draw them together is a
        second axis nobody can see. Each panel is captioned above its own chart, so
        neither label can be read as belonging to the other.
      */}
      {body.against_load.length > 0 && (
        <div className="flex flex-col gap-4">
          <figure className="flex flex-col gap-1">
            <figcaption className="text-muted-foreground text-xs">
              Weight trend through the block
            </figcaption>
            <EChart option={load.weight} height={CHART_HEIGHT} />
          </figure>
          <figure className="flex flex-col gap-1">
            <figcaption className="text-muted-foreground text-xs">Fitness (CTL)</figcaption>
            <EChart option={load.load} height={CHART_HEIGHT} />
          </figure>
        </div>
      )}

      {body.speed_vs_weight.length > 0 && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground flex items-center gap-3 text-xs">
            Run speed and weight, % of the first week
            <IndexLegend />
          </figcaption>
          <EChart option={speed} height={CHART_HEIGHT} />
        </figure>
      )}

      {body.power_to_weight.length > 0 && (
        <figure className="flex flex-col gap-1">
          <figcaption className="text-muted-foreground text-xs">
            Watts per kilogram, one point a ride
          </figcaption>
          <EChart option={power} height={CHART_HEIGHT} />
        </figure>
      )}
    </div>
  );
}
