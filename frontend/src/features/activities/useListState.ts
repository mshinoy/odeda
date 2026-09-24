import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseListState,
  serializeListState,
  type ListState,
} from "@/features/activities/listState";
import { useUiStore } from "@/store/ui";

interface NavigateOptions {
  /** Replace the history entry rather than add one (for typing in the search). */
  replace?: boolean;
}

/** The list state held in the URL; the store's time range fills in a missing date range. */
export function useListState() {
  const [params, setParams] = useSearchParams();
  const defaultRange = useUiStore((s) => s.timeRange);

  const state = useMemo(() => parseListState(params, defaultRange), [params, defaultRange]);
  const update = useCallback(
    (next: ListState, options?: NavigateOptions) =>
      setParams(serializeListState(next, defaultRange), options),
    [setParams, defaultRange],
  );

  return { state, update };
}
