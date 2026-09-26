import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseTrendsFilters,
  serializeTrendsFilters,
  type TrendsFilters,
} from "@/features/trends/trendsFilters";

/** The filters every aggregate block on the page shares, held in the URL and nowhere else. */
export function useTrendsFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => parseTrendsFilters(params), [params]);
  const update = useCallback(
    (next: TrendsFilters) => setParams(serializeTrendsFilters(next)),
    [setParams],
  );

  return { filters, update };
}
