export interface Debounced<A extends unknown[]> {
  /** Schedules `fn` with these arguments, replacing any call still waiting. */
  call: (...args: A) => void;
  /** Drops the waiting call, if any. */
  cancel: () => void;
}

/** Runs `fn` once calls have stopped for `ms`, with the arguments of the last call. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const call = (...args: A) => {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };

  return { call, cancel };
}
