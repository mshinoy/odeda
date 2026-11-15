// Runs work for frames 0..count-1 on several workers at once, and hands the results to one
// consumer strictly in order. A video wants its frames in order; drawing a frame is where the
// time goes (it waits on a map), so several maps can wait at the same time.

export interface OrderedPoolOptions<T> {
  count: number;
  /** How many frames can be in the making at once: one per map. */
  workers: number;
  /**
   * How many consecutive frames a worker takes at a time. A map whose frames are next to each
   * other moves a little each time and reuses what it has loaded; one that is dealt every
   * `workers`-th frame jumps ahead each time and starts afresh. Default 1.
   */
  block?: number;
  /**
   * How far past the frame the consumer is waiting on the workers may run. Finished frames
   * wait in memory, so this is the cap on how many; it must be at least `workers`.
   */
  lookahead: number;
  /** Makes frame `index` on worker `worker`. A worker does one frame at a time. */
  produce(index: number, worker: number): Promise<T>;
  /** Takes frame `index`; called for 0, 1, 2 … in order, one at a time. */
  consume(index: number, value: T): Promise<void>;
  signal?: AbortSignal;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A frame nobody is waiting on yet must not report its failure as unhandled.
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function aborted(): DOMException {
  return new DOMException("Export cancelled", "AbortError");
}

export async function runOrdered<T>(options: OrderedPoolOptions<T>): Promise<void> {
  const { count, workers, produce, consume, signal } = options;
  const block = Math.max(Math.floor(options.block ?? 1), 1);
  const lookahead = Math.max(options.lookahead, workers, block, 1);
  const slots = Array.from({ length: count }, () => deferred<T>());

  let next = 0;
  let consumed = 0;
  let failure: { error: unknown } | null = null;
  let wake: (() => void)[] = [];

  const fail = (error: unknown) => {
    if (failure) return;
    failure = { error };
    for (const slot of slots) slot.reject(error);
    for (const resume of wake) resume();
    wake = [];
  };
  const advanced = () => {
    const resume = wake;
    wake = [];
    for (const fn of resume) fn();
  };
  const room = (index: number) =>
    new Promise<void>((resolve) => {
      if (index - consumed < lookahead || failure) resolve();
      else wake.push(resolve);
    });

  const work = async (worker: number) => {
    while (!failure) {
      if (signal?.aborted) return fail(aborted());
      const first = next;
      next += block;
      if (first >= count) return;
      for (let index = first; index < Math.min(first + block, count); index++) {
        if (signal?.aborted) return fail(aborted());
        while (index - consumed >= lookahead && !failure) await room(index);
        if (failure) return;
        try {
          slots[index]?.resolve(await produce(index, worker));
        } catch (error) {
          fail(error);
          return;
        }
      }
    }
  };

  const running = Array.from({ length: Math.min(workers, Math.max(count, 1)) }, (_, w) =>
    work(w),
  );

  try {
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw aborted();
      const slot = slots[i];
      if (!slot) break;
      const value = await slot.promise;
      await consume(i, value);
      consumed = i + 1;
      advanced();
    }
  } catch (error) {
    // Do not wait for the workers: one may be stuck on a map that has been taken away, and
    // the rest stop at their next frame because `failure` is set.
    fail(error);
    throw error;
  }
  await Promise.all(running);
}
