import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { parseMapState, serializeMapState, type MapState } from "@/features/map/mapState";

/** The heatmap's filters, held in the URL and nowhere else. */
export function useMapState() {
  const [params, setParams] = useSearchParams();

  const state = useMemo(() => parseMapState(params), [params]);
  const update = useCallback((next: MapState) => setParams(serializeMapState(next)), [setParams]);

  return { state, update };
}
