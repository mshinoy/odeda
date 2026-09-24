import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "@/lib/debounce";

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once, with the last arguments, after calls stop for the wait", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 250);

    debounced.call("t");
    vi.advanceTimersByTime(200);
    debounced.call("te");
    vi.advanceTimersByTime(200);
    debounced.call("tempo");
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(249);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("tempo");
  });

  it("runs again for calls after the first one fired", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced.call(1);
    vi.advanceTimersByTime(100);
    debounced.call(2);
    vi.advanceTimersByTime(100);
    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  it("drops a waiting call on cancel", () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced.call("x");
    debounced.cancel();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
