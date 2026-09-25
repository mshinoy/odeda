// The compared tracks overlaid, one colour each. Lazily loaded by ComparePage.
import { useMemo } from "react";
import type { LayersList } from "@deck.gl/core";
import type { ComparedAttempt } from "@/api/adapters";
import { useTokens } from "@/design/theme";
import { BaseMap } from "@/map/BaseMap";
import { comparedBounds, comparedTracks, makeCompareLayer } from "@/map/layers/makeCompareLayer";

/** Null when none of the compared activities has GPS; the charts still work. */
export function CompareMap({ attempts }: { attempts: readonly ComparedAttempt[] }) {
  const tokens = useTokens();

  const tracks = useMemo(() => comparedTracks(attempts, tokens), [attempts, tokens]);
  const bounds = useMemo(() => comparedBounds(tracks), [tracks]);
  const layer = useMemo(() => makeCompareLayer(tracks), [tracks]);
  const layers: LayersList = useMemo(() => [layer], [layer]);

  if (bounds === null) return null;

  return <BaseMap layers={layers} initialBounds={bounds} fitBounds={bounds} />;
}
