import { useCallback, useEffect, useRef } from "react";
import { debounce, type Debounced } from "@/lib/debounce";

/**
 * A stable function that calls the latest `fn` once calls have stopped for `ms`
 * (see `debounce`). A call still waiting when the component unmounts is dropped.
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  // The latest `fn`, so a call that fires late sees current props, not the ones it was scheduled with.
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });

  // Made in an effect, not during render, so render never touches the refs. The returned
  // function is only called from event handlers, which run after this effect.
  const debounced = useRef<Debounced<A> | null>(null);
  useEffect(() => {
    const instance = debounce((...args: A) => latest.current(...args), ms);
    debounced.current = instance;
    return instance.cancel;
  }, [ms]);

  return useCallback((...args: A) => debounced.current?.call(...args), []);
}
