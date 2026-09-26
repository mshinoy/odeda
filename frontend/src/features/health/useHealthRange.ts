import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  parseHealthRange,
  serializeHealthRange,
  type HealthRange,
} from "@/features/health/healthRange";

/** The window every chart on the Health page shares, held in the URL and nowhere else. */
export function useHealthRange() {
  const [params, setParams] = useSearchParams();

  const days = useMemo(() => parseHealthRange(params), [params]);
  const setDays = useCallback(
    (next: HealthRange) => setParams(serializeHealthRange(next)),
    [setParams],
  );

  return { days, setDays };
}
